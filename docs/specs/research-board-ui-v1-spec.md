# Research Board UI V1 (FigJam) Spec

## 1. Context

This spec defines a visual quality contract for the FigJam research board workflow.
It extends the existing Research Board V2 reliability spec with deterministic UI standards.

This is **FigJam-specific** and must only rely on FigJam-capable primitives:

- `SECTION`, `SHAPE_WITH_TEXT`, `STICKY`, `TEXT`, `LINK_UNFURL`, `CONNECTOR`

No Figma Design-only assumptions (component sets, auto-layout frames, design tokens API) are allowed in the runtime path.

## 2. Scope

In scope:

- `generateResearchBoard`
- `createReferenceWall`
- `figjam_render_reference_card`
- `figjam_render_reference_set`
- `figjamClient` create/update primitives used by the research workflow
- visual validation output fields

Out of scope:

- search/research quality
- non-FigJam editor workflows

## 3. Goals

1. Always produce a readable board header.
2. Ensure compact and consistent card rhythm.
3. Ensure thematic visual separation (color-coded columns).
4. Guarantee deterministic spacing without overlap.
5. Produce validation artifacts that represent the full run region.

## 4. Non-Goals

1. Full design-system parity with Figma Design files.
2. Automatic conversion to auto-layout.
3. Dependence on external paint styles or variables.

## 5. Terminology

- **Run region**: bounding rectangle that includes all nodes created/updated by a run.
- **Theme column**: one visual cluster for one research theme.
- **Section header bar**: color strip + title + count row at top of each theme column.
- **Card compactness**: constrained card dimensions and stable internal spacing.
- **UI preset**: deterministic visual density preset (`dense` or `comfortable`).

## 6. Product Requirements

### S1. Visual Tokens Contract (FigJam-safe)

- The workflow MUST use a local UI palette map (hex/rgba constants) per theme.
- Theme palette MUST define:
  - `sectionBg`
  - `sectionStroke`
  - `headerBg`
  - `headerText`
  - `cardStroke`
- Palettes MUST be serializable and included in run summary under `ui.paletteVersion`.
- No dependency on Figma Design styles/variables at runtime.

### S2. Global Board Header

- `generateResearchBoard` MUST create a global header at run start:
  - title
  - run timestamp
  - summary chips (`themes`, `references`, `notes`)
- Header MUST be represented by at least:
  - one background shape
  - one main title text
- Header metadata MUST include:
  - `figjam.role=board_header`
  - `figjam.runId`

### S3. Theme Section Header Bars

- Each theme column MUST create a dedicated header bar node set:
  - background shape
  - title text
  - optional count text
- Header bar MUST be colorized from that theme palette.
- Header nodes MUST use metadata:
  - `figjam.role=theme_header`
  - `figjam.groupId=theme:<slug>`

### S4. Compact Card Variants

- Card variants MUST have explicit dimensions:
  - native link target footprint
  - fallback image card footprint
  - fallback text-only footprint
- `createFallbackLinkCard` MUST support compact presets:
  - dense: default `360x240`
  - comfortable: default `400x280`
- Note sticky Y placement MUST be computed from primary card height (`primaryY + primaryHeight + noteGap`), never fixed constants.

### S5. Deterministic Vertical Rhythm

- Spacing tokens MUST be centralized:
  - `columnGapX`
  - `rowGapY`
  - `sectionPadding`
  - `headerToFirstCardGap`
  - `noteGap`
- All render paths MUST consume the same spacing token source.
- `overlapCount` MUST remain `0` in accepted fixtures.

### S6. Theme Color Differentiation

- Theme columns MUST be visually distinguishable by background/stroke or header bar.
- Fallback section containers MUST preserve theme coloration.
- If runtime lacks section support, shape fallback MUST still render theme color and heading.

### S7. Run-Region Validation Contract

- Validation screenshot MUST target run region, not a random single node.
- Output MUST include:
  - `renderValidation.regionBounds`
  - `renderValidation.nodeCountInRegion`
  - `renderValidation.targetNodeIds`
- If region capture fails, error MUST be explicit and include candidate IDs.

### S8. Contract Parity and Presets

- Tool schema/runtime MUST be aligned for `linkPolicy` and new UI params.
- Add input params:
  - `uiPreset: "dense" | "comfortable"` (default `dense`)
  - `headerMode: "full" | "minimal"` (default `full`)
  - `themeColorMode: "auto" | "explicit"` (default `auto`)
- Legacy clients MUST remain backward-compatible.

### S9. QA and Smoke Guarantees

- Add contract + smoke coverage for:
  - header presence
  - per-theme colorized headers
  - compact card dimensions
  - zero overlap for benchmark set
- Minimum benchmark:
  - 100 references, 5 themes, `layoutPolicy=auto_expand`, `uiPreset=dense`

## 7. API Contract Changes

### 7.1 `generateResearchBoard` input additions

- `uiPreset?: "dense" | "comfortable"`
- `headerMode?: "full" | "minimal"`
- `themeColorMode?: "auto" | "explicit"`

### 7.2 `generateResearchBoard` output additions

- `ui: { preset, headerMode, themeColorMode, paletteVersion }`
- `layoutTokens: { columnGapX, rowGapY, sectionPadding, headerToFirstCardGap, noteGap }`
- `headers: { boardHeaderNodeId, themeHeaderNodeIds[] }`

### 7.3 `figjam_render_reference_set` output additions

- `uiPreset`
- `cardVariantCounts`
- `measuredCardHeights`

### 7.4 `renderValidation` output extensions

- `regionBounds`
- `targetNodeIds`
- `nodeCountInRegion`

## 8. Error Taxonomy Additions

- `HEADER_CREATION_FAILED`
- `THEME_COLOR_APPLY_FAILED`
- `CARD_DIMENSION_INVALID`
- `VALIDATION_REGION_EMPTY`
- `SCHEMA_RUNTIME_DRIFT`

All error payloads MUST include:

- `code`
- `tool`
- `message`
- `details`

## 9. Acceptance Criteria

### AC-UI-1 Header Presence

- Given a generated board,
- then at least one `board_header` node exists with run metadata.

### AC-UI-2 Theme Differentiation

- Given 5 themes,
- then each theme has a `theme_header` and at least one color token differs from other themes.

### AC-UI-3 Compactness

- Given `uiPreset=dense`,
- fallback card height MUST be <= 240 and width <= 360 by default contract.

### AC-UI-4 No Overlap

- Given 100 references and auto-expand layout,
- reported `overlapCount` MUST be `0`.

### AC-UI-5 Region Validation

- `renderValidation.regionBounds` MUST include all created primary reference nodes for the run.

## 10. Implementation Targets

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/tools/link-fallback.ts`
- `src/figjam-api/figjamClient.ts`
- `tests/figjam-tools.contract.test.ts`
- `tests/figjam-research-workspace.contract.test.ts`

## 11. Compatibility Notes

- This spec is additive to `research-board-v2-spec.md`.
- Existing callers without UI params MUST continue to work.
- Runtime remains FigJam-only.
