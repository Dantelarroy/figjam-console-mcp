# Research Board V2 (Spec-Driven)

## 1. Context

This spec defines a deterministic, recoverable, and non-overlapping workflow for creating large FigJam research boards (up to 500 references) through MCP tools.

Incident classes this spec addresses:

- Partial writes after client timeout.
- Overlapping cards due to unsafe spacing assumptions.
- Runtime incompatibilities (`createSection` availability differences).
- Non-idempotent re-runs causing duplicates.

## 2. Scope

In scope:

- `generateResearchBoard`
- `figjam_render_reference_set`
- Link fallback policy and preview behavior
- Job lifecycle and resumability
- Deterministic layout guards
- Validation and observability

Out of scope:

- Web search quality/ranking logic
- Non-FigJam file types

## 3. Terminology

- Run: one workflow execution identified by `runId`.
- Item key: deterministic key per reference item (default: normalized URL).
- Card footprint: effective 2D area occupied by a rendered reference card including note/connector spacing.
- Partial write: nodes created while caller reports timeout/error.

## 4. Product Requirements

### R1. Job-based execution for long workflows

- `generateResearchBoard` MUST return `jobId`, `runId`, and immediate phase status.
- Job phases MUST be resumable and queryable.
- A timed-out client call MUST NOT hide progress state.

Required tools:

- `figjam_get_job_status`
- `figjam_cancel_job`
- `figjam_resume_job`

### R2. Idempotency and dedupe

- Every created artifact MUST store `figjam.runId` and `figjam.itemKey`.
- Re-running same `runId` MUST upsert existing artifacts, not duplicate.
- Dedupe policy MUST be configurable:
  - `by_url` (default)
  - `by_title`
  - `strict` (`url + title + theme`)

### R3. Deterministic safe layout

- `figjam_render_reference_set` MUST pre-compute `cardFootprint` per item mode:
  - native unfurl
  - fallback link+image card
  - text-only link
- If requested `gapX/gapY` is smaller than required footprint, behavior MUST be explicit:
  - `auto_expand` (default): expand gaps and report applied values
  - `strict`: fail with `LAYOUT_GAP_TOO_SMALL`

### R4. Section compatibility contract

- A capability handshake MUST expose:
  - `supportsSections`
  - `supportsRichUnfurl`
- If `supportsSections=false`, all section creates MUST degrade consistently to container shapes.
- Tool outputs MUST include whether fallback container mode was used.

### R5. Link policy contract

- Supported values:
  - `native_preferred` (default)
  - `native_only`
  - `fallback_if_unfurl_fails`
  - `fallback_force_card`
- A poor/unrich unfurl SHOULD remain native unless policy forces fallback.
- Every item MUST report `renderMode` and `fallbackReason` when applicable.

### R6. Validation contract

- Every batch/run MUST return:
  - `createdCount`, `failedCount`
  - `nativeCount`, `fallbackCount`
  - `overlapCount`
  - `orphanNoteCount`
- Validation screenshot MUST target created run region (or provided validation node IDs), not unrelated page root.

### R7. Cleanup and rollback safety

- Provide deletion/archival by deterministic selectors and bounding region:
  - `figjam_delete_by_bbox`
  - `figjam_archive_by_bbox`
  - `figjam_delete_by_run`
- Cleanup MUST support dry-run and report exact node IDs targeted.

## 5. API/Tool Contract Changes

### 5.1 `generateResearchBoard` (v2)

Input additions:

- `runId: string` (optional; auto-generated when omitted)
- `executionMode: "sync_small" | "job"` (default `job` when references > 20)
- `dedupePolicy`
- `layoutPolicy: "auto_expand" | "strict"`

Output:

- `jobId`
- `runId`
- `phase`
- `progress` (`totalItems`, `processedItems`)
- `summary` (stable schema)

### 5.2 `figjam_render_reference_set` (v2)

Input additions:

- `runId`
- `layoutPolicy`
- `maxItemsPerBatch` (default 20)

Output additions:

- `appliedGapX`, `appliedGapY`
- `footprintMaxWidth`, `footprintMaxHeight`
- `overlapCheck` result

## 6. Error Taxonomy

Standardized codes:

- `TIMEOUT_PARTIAL_WRITE`
- `LAYOUT_GAP_TOO_SMALL`
- `SECTION_UNSUPPORTED`
- `UNFURL_METADATA_INSUFFICIENT`
- `JOB_NOT_FOUND`
- `RUN_ALREADY_CANCELLED`

All errors MUST include:

- `code`
- `message`
- `tool`
- `details`

## 7. Acceptance Criteria

### AC1. 100 references, no overlap

- Given 100 references across 5 themes,
- When run in `job` mode,
- Then `overlapCount=0` and `failedCount=0` (or bounded failures with explicit item IDs).

### AC2. Idempotent rerun

- Given same `runId`,
- When executed twice,
- Then total node count for run remains stable (no duplicates).

### AC3. Timeout recovery

- Given client timeout at phase N,
- When `figjam_get_job_status(jobId)` is called,
- Then partial progress is visible and resumable/cancelable.

### AC4. Runtime compatibility

- Given `supportsSections=false`,
- Then all section operations degrade to shape containers and workflow still completes.

## 8. Observability

Run telemetry fields:

- `runId`, `jobId`
- `startedAt`, `endedAt`, `durationMs`
- `phaseDurations`
- `nativeCount`, `fallbackCount`
- `overlapCount`, `orphanNoteCount`
- `failedItems[]`

## 9. Security and Safety

- Do not perform global layout over entire page by default.
- Restrict move/delete actions to current run selectors unless explicitly overridden.
- All destructive actions MUST expose dry-run preview.

## 10. Mapping to Current Code

Primary files in this fork:

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/tools/link-fallback.ts`
- `src/figjam-api/figjamClient.ts`
- `tests/figjam-tools.contract.test.ts`

Upstream status note:

- `southleft/figma-console-mcp` does not currently include this research-workspace workflow surface, so this spec applies to this fork's custom tools.

