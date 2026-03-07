# Spec-Driven Workflow

This document defines the default delivery workflow for repository agents.

## 1) Validate
- Confirm repo integrity and branch context.
- Confirm source of truth (local canonical module, upstream module, runtime signal).
- Record assumptions and unstable points.
- Load Notion roadmap DB context from:
  - `FigJam Console MCP — Product Roadmap` (`31b2c914-8640-8127-a4f6-cb425e1a3f2c`).
  - Read current items/status before planning.

## 2) Analyze
- Map the relevant architecture paths (registration, execution, runtime transport, data source).
- Identify contract boundaries and compatibility risks.

## 3) Specify
- Define exact tool/function contracts before coding:
  - input schema,
  - output shape,
  - error semantics,
  - deterministic behavior constraints,
  - partial-failure behavior (if any).

## 4) Plan
- File-level patch plan with minimal change surface.
- Validation plan (tests + smoke/runtime checks).
- Explicitly call out what will not change.

## 5) Implement
- Apply minimal, scoped changes.
- Preserve existing contracts unless explicitly approved to change.
- Keep behavior deterministic and observable.

## 6) Validate
- Run required tests.
- Run smoke/runtime validation for affected paths.
- Compare observed behavior to approved spec.
- If changes are pushed, update corresponding roadmap DB item(s) status + milestone note.

## Source-of-Truth Rules
- Runtime truth beats assumptions.
- Upstream truth must be checked when parity is a goal.
- Screenshots are validation artifacts, not data truth.

## Contract Drift Rule
Any contract change requires explicit approval and must include:
- migration notes,
- compatibility impact,
- updated tests.
