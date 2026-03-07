# Research Board V2 Implementation Plan

## Objective

Implement `research-board-v2-spec.md` with incremental, testable milestones that eliminate partial writes, overlaps, and runtime fragility.

## Phase 0. Baseline and Guardrails

### Tasks

- Add a single source of truth type for run/job status.
- Add feature flags:
  - `RESEARCH_WORKFLOW_V2`
  - `STRICT_LAYOUT_GUARDS`
  - `LINK_POLICY_V2`
- Add structured log helpers for run metrics.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/server/register-figjam-tools.ts`

### Done criteria

- Flags default to existing behavior.
- No breaking API changes yet.

## Phase 1. Job Lifecycle (timeout-proof)

### Tasks

- Introduce in-memory job registry keyed by `jobId`.
- Refactor `generateResearchBoard` to job state machine:
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `cancelled`
- Expose tools:
  - `figjam_get_job_status`
  - `figjam_cancel_job`
  - `figjam_resume_job`

### Files

- `src/tools/research-workspace.ts`
- `src/server/register-figjam-tools.ts`
- `src/tools/visual-state.ts` (shared response helpers if needed)

### Tests

- Contract test: timeout simulation still exposes job progress.
- Contract test: cancelled job stops future phases.

### Done criteria

- Caller can recover state after timeout with `jobId`.

## Phase 2. Idempotency and Dedupe

### Tasks

- Add `runId` and `itemKey` plugin metadata on all created artifacts.
- Implement `dedupePolicy` in reference render path:
  - `by_url`
  - `by_title`
  - `strict`
- Upsert behavior for rerun with same `runId`.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `src/figjam-api/figjamClient.ts` (metadata helpers)

### Tests

- Run same payload twice with same `runId`, assert no duplicate cards.
- Run with different `runId`, assert isolated artifact sets.

### Done criteria

- Repeated runs are deterministic and duplicate-free.

## Phase 3. Layout Safety Engine

### Tasks

- Implement `estimateCardFootprint(renderMode)` utility.
- Validate requested `gapX/gapY` before rendering.
- Add `layoutPolicy`:
  - `auto_expand`
  - `strict`
- Emit applied layout values in response.

### Files

- `src/tools/visual-state.ts`
- `src/tools/link-fallback.ts` (if render mode influences footprint)

### Tests

- Unit tests for footprint calculations.
- Contract tests for overlap-free output in 25/100/250 items.

### Done criteria

- `overlapCount=0` in acceptance fixtures.

## Phase 4. Runtime Capability Compatibility

### Tasks

- Add capability handshake per connection:
  - `supportsSections`
  - `supportsRichUnfurl`
- Normalize fallback behavior:
  - section fallback shape container
  - richer link policy behavior without forced fallback on weak metadata

### Files

- `src/figjam-api/figjamClient.ts`
- `src/tools/research-workspace.ts`
- `src/tools/link-fallback.ts`

### Tests

- Simulated environment with `createSection` unavailable.
- Link unfurl metadata sparse scenario.

### Done criteria

- Same workflow works in both capability modes.

## Phase 5. Cleanup and Rollback Tools

### Tasks

- Add targeted cleanup tools:
  - `figjam_delete_by_bbox`
  - `figjam_archive_by_bbox`
  - `figjam_delete_by_run`
- Ensure all support `dryRun=true`.

### Files

- `src/tools/visual-state.ts`
- `src/server/register-figjam-tools.ts`

### Tests

- Contract test: dry-run returns deterministic node IDs.
- Contract test: delete-by-run only removes that run’s artifacts.

### Done criteria

- Incident recovery is safe and fast without global deletes.

## Phase 6. Validation and Telemetry

### Tasks

- Add unified validation payload:
  - created/failed/native/fallback counts
  - overlap/orphan counts
  - validation node IDs and screenshot result
- Emit per-phase duration metrics and stable error codes.

### Files

- `src/tools/research-workspace.ts`
- `src/tools/visual-state.ts`
- `tests/figjam-tools.contract.test.ts`

### Tests

- Snapshot contract test for summary payload schema.

### Done criteria

- Incident diagnostics possible from a single run summary.

## Suggested PR breakdown

- PR1: Phase 0 + Phase 1
- PR2: Phase 2
- PR3: Phase 3
- PR4: Phase 4
- PR5: Phase 5 + Phase 6 + docs refresh

## Migration notes

- Keep old tool params backward-compatible for one release cycle.
- Mark new fields as optional initially and warn when missing (`runId`, `layoutPolicy`).

## Risks and mitigations

- Risk: job registry memory growth.
  - Mitigation: TTL eviction + max jobs cap.
- Risk: bigger gaps increase board size.
  - Mitigation: `fitToContainer` option and theme-specific column control.
- Risk: plugin runtime differences.
  - Mitigation: capability-driven behavior with explicit response metadata.

## Definition of Done (global)

- 100-reference board creation succeeds in CI and local Desktop Bridge.
- No overlap in acceptance board fixtures.
- Rerun with same `runId` is idempotent.
- Timeout does not hide partial progress.
- Cleanup by run/bbox works with dry-run safety.

