# AGENTS.md

Repository-local operating rules for Codex or any repo-local coding agent.

## Scope
- Applies to all work in this repository.
- These rules govern process, validation, and reporting.
- Product specs still come from active task requests.

## Core Operating Principles
- Source-of-truth-first: validate assumptions against the canonical implementation/source before proposing or changing code.
- Upstream parity first: when this repo mirrors upstream behavior/contracts, verify against upstream before modifying behavior.
- Deterministic over implicit: prefer explicit inputs and deterministic logic; avoid hidden inference.
- No silent contract drift: do not change existing tool contracts unless explicitly approved.

## Notion Roadmap Context (Required)
- Default Notion context page for this repository:
  - Title: `FigJam Console MCP — Product Roadmap`
  - Page ID: `31b2c914-8640-80dc-9124-f5fa64c5bf43`
- At task start:
  - read/use this page as project-state context when planning milestone work.
- After every successful `git push`:
  - append a short milestone update to this page (what changed, validation result, blockers/risks).
- If Notion API is unavailable:
  - report the exact error and provide a ready-to-paste update block in the final response.

## Required Phase Order
Follow this order unless the user explicitly asks otherwise:
1. Validate
2. Analyze
3. Specify
4. Plan
5. Implement
6. Validate

## Spec Gate (Hard Rule)
- Do not implement before spec approval.
- “Spec approved” means the user explicitly accepted inputs/outputs/error semantics and implementation scope.
- If scope is ambiguous or conflicts with existing contracts, stop and ask.

## Baseline Safety Rule
Before risky infra/runtime changes (registration paths, transport, guard layers, bridge semantics, broad refactors):
- ensure clean branch state,
- create baseline commit,
- create annotated baseline tag,
- create a dedicated feature branch.

## Upstream Validation Rule
When behavior should align with upstream:
- validate where the behavior is defined upstream,
- cite the upstream module(s) examined,
- state whether proposed change preserves or intentionally diverges from upstream.

## Autonomy vs Stop Conditions

### Agent may continue autonomously when
- spec is approved,
- required context is available locally,
- changes are within approved scope,
- no contract drift is introduced.

### Agent must stop and ask when
- contract change is required,
- behavior conflicts with upstream source-of-truth,
- runtime/source data contradicts assumptions,
- destructive action is needed,
- security/privacy-sensitive behavior is unclear,
- requested scope expands beyond approved milestone.

## Validation Expectations
For each implemented milestone, run:
- targeted contract/unit tests,
- relevant integration/smoke validation,
- connected runtime validation when bridge/runtime behavior is part of scope.

Prefer deterministic test fixtures and explicit assertions over snapshot-only checks.

## Milestone Completion Report (Required)
After each milestone, report:
- files changed,
- concise diff summary,
- test commands + results,
- smoke validation outputs,
- remaining risks/limitations,
- recommended next step.

## Playbook References
Use the templates in:
- `docs/agent-playbooks/spec-driven-workflow.md`
- `docs/agent-playbooks/milestone-template.md`
- `docs/agent-playbooks/validation-template.md`
- `docs/agent-playbooks/change-request-template.md`
