# Research Board UI V1 Implementation Plan (FigJam)

## Objective

Implement `docs/specs/research-board-ui-v1-spec.md` end-to-end with deterministic visual quality guarantees while preserving existing runtime behavior and backward compatibility.

## Execution Order

`analyze -> specify -> implement -> validate`

This plan assumes the reliability baseline from Research Board V2 is already in place.

## Phase 0. Baseline Snapshot and Drift Guard

### Tasks

1. Capture baseline outputs for:
   - `generateResearchBoard`
   - `figjam_render_reference_set`
   - `figjam_render_reference_card`
2. Add schema/runtime parity checks for `linkPolicy` and newly introduced UI params.
3. Add an internal `SCHEMA_RUNTIME_DRIFT` guard path for validation errors.

### Files

- `src/tools/visual-state.ts`
- `src/tools/research-workspace.ts`
- `tests/figjam-tools.contract.test.ts`

### Exit Criteria

- Existing payloads remain valid.
- Drift path exists and is covered by tests.

## Phase 1. UI Token Layer (S1)

### Tasks

1. Introduce shared UI token resolver:
   - `resolveUiPresetTokens(uiPreset)`
   - `resolveThemePalette(themeName, mode)`
2. Return `ui.paletteVersion` and resolved layout tokens in run summary.
3. Ensure no dependency on Figma Design styles/variables.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`

### Tests

- Unit/contract test for deterministic token outputs per preset.

### Exit Criteria

- All render paths consume centralized tokens.

## Phase 2. Board Header + Theme Header Bars (S2, S3, S6)

### Tasks

1. Add global board header creation at scaffold step.
2. Add theme header bars in both:
   - `createReferenceWallInternal`
   - `figjam_render_reference_set` theme-grouped usage
3. Colorize header/background using palette map.
4. Add metadata roles:
   - `board_header`
   - `theme_header`

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/figjam-api/figjamClient.ts` (optional helper for shape styling)

### Tests

- Contract assertions that header roles exist in output collections.
- Theme header count equals requested themes count.

### Exit Criteria

- Header always present.
- Theme columns visibly differentiated.

## Phase 3. Compact Card Variants (S4)

### Tasks

1. Add compact footprint profiles by preset and render mode.
2. Extend fallback card creation:
   - support preset-based width/height
   - preserve clickable URL text
3. Replace fixed note offset (`+260`) with computed offset from primary node dimensions.

### Files

- `src/tools/visual-state.ts`
- `src/tools/link-fallback.ts`
- `src/figjam-api/figjamClient.ts`

### Tests

- Contract test for card size ranges in `dense` and `comfortable`.
- Contract test for computed note positioning.

### Exit Criteria

- Dense cards are materially smaller and still readable/clickable.

## Phase 4. Rhythm and Layout Cohesion (S5)

### Tasks

1. Centralize spacing constants in one token source.
2. Enforce same spacing across:
   - scaffold sections
   - reference walls
   - render set
3. Keep `layoutPolicy` behavior from V2 while applying new tokens.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`

### Tests

- Overlap and spacing consistency checks in deterministic fixtures.

### Exit Criteria

- Uniform vertical rhythm across themes.
- `overlapCount=0` on benchmark fixtures.

## Phase 5. Region-Based Validation (S7)

### Tasks

1. Implement run region aggregation from created node IDs.
2. Extend validation response with:
   - `regionBounds`
   - `targetNodeIds`
   - `nodeCountInRegion`
3. Ensure screenshot target is a run-representative region candidate.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/figjam-api/figjamClient.ts` (if helper needed)

### Tests

- Contract tests for non-empty region metadata when nodes are created.

### Exit Criteria

- Validation output reliably reflects generated area.

## Phase 6. Public API Additions and Backward Compatibility (S8)

### Tasks

1. Add optional params:
   - `uiPreset`
   - `headerMode`
   - `themeColorMode`
2. Maintain defaults so old clients keep current behavior.
3. Document new fields in README/tool docs.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `README.md`

### Tests

- Backward compatibility contract tests with omitted fields.
- New-field tests with explicit values.

### Exit Criteria

- Existing scripts run unchanged.
- New UI controls available.

## Phase 7. QA, Smoke, and Demo Script Hardening (S9)

### Tasks

1. Upgrade demo script to use new UI params and structured sections.
2. Add 100-reference smoke script assertions for:
   - header presence
   - theme header count
   - overlap metrics
   - fallback/native ratio output
3. Add visual sanity checks from `renderValidation`.

### Files

- `tmp_figjam_ordered_demo.mjs`
- `tmp_figjam_research_smoke.mjs` (or equivalent smoke entrypoint)
- `tests/figjam-research-workspace.contract.test.ts`

### Exit Criteria

- Repeatable ordered demo with readable structure.

## Milestone Mapping to 9 Specs

1. S1 -> Phase 1
2. S2 -> Phase 2
3. S3 -> Phase 2
4. S4 -> Phase 3
5. S5 -> Phase 4
6. S6 -> Phase 2
7. S7 -> Phase 5
8. S8 -> Phase 0 + Phase 6
9. S9 -> Phase 7

## Risks and Mitigations

1. Runtime capability variance in FigJam.
- Mitigation: capability guards and explicit fallback roles already present; preserve contract-level reporting.

2. Board expansion due to safer spacing.
- Mitigation: `uiPreset=dense` default and deterministic tokenized spacing.

3. Visual regressions in fallback card path.
- Mitigation: contract tests around dimensions + clickable link behavior.

4. Schema/runtime divergence.
- Mitigation: parity checks in Phase 0 and CI contract tests.

## Definition of Done

1. All 9 specs marked implemented or explicitly deferred.
2. `npm test` green.
3. Ordered demo run produces:
   - visible global header
   - color-differentiated theme columns
   - compact card rhythm
   - no overlaps in reported metrics
4. Validation payload includes region metadata.
