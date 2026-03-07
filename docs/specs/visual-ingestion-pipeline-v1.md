# Visual Ingestion Pipeline v1 (Spec)

Status: Draft for approval (no runtime changes yet)
Owner: FigJam Console MCP
Date: 2026-03-07

## 1) Objective

Enable deterministic ingestion of external visual references into FigJam:

- Agent captures a target web image (Playwright-driven).
- MCP inserts that local image into the board as a structured artifact.
- MCP preserves traceable metadata/alias for retrieval and organization.

This milestone is additive and does not change existing tool contracts.

## 2) Source of Truth Validation

Validated against current repository architecture and MCP style:

- Tool registration: `src/server/register-figjam-tools.ts`
- Tool response envelope helpers: `src/server/figjam-tooling.ts` (`ok`, `fail`)
- Existing deterministic FigJam tools:
  - `src/tools/links.ts`
  - `src/tools/workflows.ts`
  - `src/tools/research-workspace.ts`
- Guard infrastructure and capability model remain unchanged.

Upstream compatibility constraint:

- Keep MCP success/error envelope style identical.
- Do not modify existing upstream-derived tool contracts.
- Add new tools only.

## 3) Scope (v1)

In scope:

- `captureWebImage` (deterministic capture contract)
- `insertLocalImage` (deterministic FigJam insertion contract)
- `createImageReference` (composition contract for image + metadata/alias)

Out of scope:

- AI/semantic classification
- autonomous search strategy
- OCR/summarization
- replacing DBI v1 indexing

## 4) Determinism Rules

Mandatory v1 behavior:

- No semantic inference inside tools.
- No automatic “best guess” element selection unless explicitly provided selectors list.
- Stable operation ordering and deterministic IDs in returned arrays.
- Explicit failure when required conditions are not met.
- Optional fallback modes must be explicitly requested in input.

## 5) Tool Contracts (Implementation-Ready)

### 5.1 `captureWebImage`

Purpose:

- Capture a web image deterministically and save it as a local file for later insertion.

MCP signature:

```ts
server.tool(
  "captureWebImage",
  "Capture a deterministic web image screenshot to local disk for FigJam insertion.",
  inputSchema,
  handler
)
```

Input schema (zod):

```ts
const CaptureWebImageInput = z.object({
  url: z.string().url(),
  selector: z.string().optional(),
  selectors: z.array(z.string()).min(1).max(10).optional(),
  x: z.number().int().nonnegative().optional(),
  y: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  outputDir: z.string().optional().default("/tmp/figjam-captures"),
  filenamePrefix: z.string().optional().default("capture"),
  format: z.enum(["png", "jpeg"]).optional().default("png"),
  timeoutMs: z.number().int().positive().max(30000).optional().default(10000),
  strict: z.boolean().optional().default(true)
});
```

Deterministic selection semantics:

- If `selector` provided: use it only.
- Else if `selectors` provided: try in order, use first visible match.
- Else if crop (`x`,`y`,`width`,`height`) provided: capture fixed viewport region.
- Else:
  - `strict=true`: fail (`NO_CAPTURE_TARGET`)
  - `strict=false`: full-page screenshot.

Success output shape:

```json
{
  "capture": {
    "localPath": "/tmp/figjam-captures/capture-20260307-120000.png",
    "url": "https://example.com/page",
    "sourceUrl": "https://example.com/page",
    "selectorUsed": ".hero img",
    "mode": "selector",
    "format": "png",
    "width": 1200,
    "height": 630,
    "capturedAt": "2026-03-07T12:00:00.000Z"
  }
}
```

Failure contract:

- `isError: true`
- payload keys:
  - `errorCode` in:
    - `NO_CAPTURE_TARGET`
    - `NAVIGATION_FAILED`
    - `ELEMENT_NOT_VISIBLE`
    - `SCREENSHOT_FAILED`
    - `INVALID_INPUT`
  - `message`
  - `details` (optional)

### 5.2 `insertLocalImage`

Purpose:

- Insert a local image file into FigJam as a deterministic image artifact.

MCP signature:

```ts
server.tool(
  "insertLocalImage",
  "Insert a local image file into FigJam with deterministic metadata and alias support.",
  inputSchema,
  handler
)
```

Input schema (zod):

```ts
const InsertLocalImageInput = z.object({
  localPath: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  title: z.string().optional(),
  alias: z.string().optional(),
  containerId: z.string().optional(),
  groupId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
});
```

Insertion semantics:

- Preferred: native image node creation in FigJam runtime.
- If runtime lacks direct image insertion API:
  - deterministic fallback requires explicit mode only (future flag, not implicit in v1).
  - default v1 behavior: fail with `IMAGE_INSERT_NOT_SUPPORTED`.

Success output shape:

```json
{
  "artifact": {
    "nodeId": "123:456",
    "type": "IMAGE",
    "x": 320,
    "y": 180,
    "width": 360,
    "height": 240,
    "alias": "bear-illustration-1",
    "containerId": "123:100",
    "groupId": "references-bears",
    "sourceUrl": "https://example.com/bear",
    "updatedAt": "2026-03-07T12:05:00.000Z"
  }
}
```

Failure contract:

- `isError: true`
- payload keys:
  - `errorCode` in:
    - `FILE_NOT_FOUND`
    - `UNSUPPORTED_IMAGE_FORMAT`
    - `IMAGE_INSERT_NOT_SUPPORTED`
    - `BRIDGE_NOT_CONNECTED`
    - `INVALID_INPUT`
  - `message`
  - `details` (optional)

### 5.3 `createImageReference`

Purpose:

- Compose image insertion with deterministic metadata/alias attachment for research use.

MCP signature:

```ts
server.tool(
  "createImageReference",
  "Create a structured image reference artifact in FigJam from a local image path.",
  inputSchema,
  handler
)
```

Input schema (zod):

```ts
const CreateImageReferenceInput = z.object({
  localPath: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  alias: z.string().optional(),
  tags: z.array(z.string()).max(20).optional().default([]),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  containerId: z.string().optional(),
  groupId: z.string().optional()
});
```

Composition plan:

- Calls `insertLocalImage` path internally.
- Writes normalized pluginData metadata (`role=image_reference`, alias, sourceUrl, tags, updatedAt).
- Optional secondary text node for `title`/`summary` only when explicitly requested in input (v1 default: no extra node).

Success output shape:

```json
{
  "reference": {
    "artifactNodeId": "123:456",
    "alias": "bear-ref-01",
    "type": "image_reference",
    "sourceUrl": "https://example.com/bear-illust",
    "containerId": "123:100",
    "groupId": "animal-illustrations",
    "metadata": {
      "title": "Bear illustration",
      "summary": "Flat vector style",
      "tags": ["bear", "illustration", "vector"]
    },
    "updatedAt": "2026-03-07T12:07:00.000Z"
  }
}
```

Failure semantics:

- Full failure if image insertion fails.
- No partial success response in v1.

## 6) Metadata / DBI Compatibility

New artifacts must be DBI-compatible and additive:

- `role`: `image_reference`
- `alias`: optional but unique if provided
- `containerId`: structural parent context
- `groupId`: logical grouping
- `sourceUrl`: provenance
- `updatedAt`: operational timestamp (not used for resolution logic)
- `version`: metadata schema version (`v1`)

## 7) Integration with Existing Layers

Workflow/research tools interaction:

- `createReferenceWall` can use `createImageReference` for image entries.
- `organizeByTheme` can reorganize image artifacts via `groupId` and `containerId`.
- `linkByRelation` can connect image references with notes/links.
- `summarizeBoard` remains deterministic and reads resulting nodes/metadata.

No contract changes to existing tools; only additive optional integration.

## 8) Validation Plan (Post-Implementation)

Contract tests:

- `captureWebImage` deterministic selection and failure modes.
- `insertLocalImage` file validation and bridge/runtime failures.
- `createImageReference` metadata/alias propagation.

Integration smoke:

- End-to-end:
  - search/capture target image
  - insert into connected FigJam board
  - retrieve via board read/index tool
- Validate returned metadata and node placement.

Regression checks:

- Existing tool contracts unchanged.
- Guard/capability behavior unchanged.

## 9) Rollout Order

1. Implement `captureWebImage`
2. Implement `insertLocalImage`
3. Implement `createImageReference`
4. Add contract tests
5. Run connected smoke validation
6. Update roadmap + README after push
