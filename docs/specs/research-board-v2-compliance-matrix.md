# Research Board V2 Compliance Matrix

This document maps the requirements in `research-board-v2-spec.md` to the current implementation state.

## Requirement Mapping

| Spec | Status | Implementation | Evidence |
|---|---|---|---|
| R1 Job-based execution | Implemented | `generateResearchBoard` supports job mode and returns `jobId/runId/phase/progress`; tools `figjam_get_job_status`, `figjam_cancel_job`, `figjam_resume_job` | `src/tools/research-workspace.ts` |
| R2 Idempotency + dedupe | Implemented | `runId/itemKey` metadata on workflow artifacts; dedupe policies `by_url/by_title/strict`; upsert behavior by `runId+itemKey` | `src/tools/research-workspace.ts`, `src/tools/visual-state.ts`, `src/figjam-api/figjamClient.ts` |
| R3 Safe deterministic layout | Implemented | Footprint estimation + `layoutPolicy` (`auto_expand/strict`) + `LAYOUT_GAP_TOO_SMALL`; applied gaps returned | `src/tools/visual-state.ts` |
| R4 Section capability compatibility | Implemented | Runtime capabilities exposed (`supportsSections`, `supportsRichUnfurl`, `supportsImageInsert`); section fallback shape containers used and reported | `src/figjam-api/figjamClient.ts`, `src/figjam-local.ts`, `src/tools/research-workspace.ts` |
| R5 Link policy contract | Implemented (with legacy compatibility) | New policy values (`native_preferred`, `native_only`, `fallback_if_unfurl_fails`, `fallback_force_card`) plus legacy aliases; per-item `mode/fallbackReason` | `src/tools/visual-state.ts`, `src/tools/link-fallback.ts`, `src/tools/links.ts` |
| R6 Validation contract | Implemented | Batch/run metrics include `created/failed/native/fallback/overlap/orphan`; render validation screenshot attached | `src/tools/visual-state.ts`, `src/tools/research-workspace.ts` |
| R7 Cleanup/rollback safety | Implemented | `figjam_delete_by_bbox`, `figjam_archive_by_bbox`, `figjam_delete_by_run`; all support `dryRun` | `src/tools/visual-state.ts` |

## API Contract Mapping

| API Contract | Status | Notes |
|---|---|---|
| `generateResearchBoard` input additions (`runId`, `executionMode`, `dedupePolicy`, `layoutPolicy`) | Implemented | Added as optional/typed inputs for backward compatibility |
| `generateResearchBoard` output additions (`jobId`, `runId`, `phase`, `progress`) | Implemented | Returned in job mode immediately; persisted in job registry |
| `figjam_render_reference_set` additions (`runId`, `layoutPolicy`, `maxItemsPerBatch`) | Implemented | Also returns applied footprint/gap metadata and overlap metrics |

## Error Taxonomy Coverage

| Error code | Status | Where |
|---|---|---|
| `TIMEOUT_PARTIAL_WRITE` | Implemented | Job execution failure path |
| `LAYOUT_GAP_TOO_SMALL` | Implemented | Layout strict mode guard |
| `JOB_NOT_FOUND` | Implemented | `figjam_get_job_status`, `figjam_cancel_job`, `figjam_resume_job` |
| `RUN_ALREADY_CANCELLED` | Implemented | `figjam_cancel_job` |
| `SECTION_UNSUPPORTED` | Partial | Behavior implemented via fallback; explicit code is not emitted yet |
| `UNFURL_METADATA_INSUFFICIENT` | Partial | Unfurl fallback behavior exists; explicit standardized code not yet emitted |

## Acceptance Criteria Traceability

| AC | Status | Validation path |
|---|---|---|
| AC1 100 refs no overlap | Ready to validate on real board | Tooling now exposes overlap metrics and safe layout controls |
| AC2 Idempotent rerun | Implemented | Deterministic keying by `runId+itemKey` |
| AC3 Timeout recovery | Implemented | Job status/cancel/resume tools with persisted in-memory state |
| AC4 Runtime compatibility | Implemented | Runtime capability handshake + section fallback containers |

## Test Coverage

- Contract tests include tool registration and schema/behavior checks:
  - `tests/figjam-tools.contract.test.ts`
  - `tests/figjam-research-workspace.contract.test.ts`
- Full suite runs green (`npm test`).

## Remaining Hardening Work (Non-blocking)

1. Emit explicit `SECTION_UNSUPPORTED` and `UNFURL_METADATA_INSUFFICIENT` codes in fallback responses.
2. Add an end-to-end smoke test for 100-link workload asserting overlap metrics under `layoutPolicy=auto_expand`.
3. Optionally persist job registry beyond process lifecycle if restart resilience is required.
