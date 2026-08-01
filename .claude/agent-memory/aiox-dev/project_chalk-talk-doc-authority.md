---
name: chalk-talk-doc-authority
description: For Chalk Talk, the architecture doc overrides the implementation plan wherever they conflict
metadata:
  type: project
---

Chalk Talk has three spec documents, in this precedence order:

1. `docs/architecture/chalk-talk-architecture.md` — **authoritative**
2. `chalk-talk-plan.md` — implementation plan
3. `prompt-claude-code-chalk-talk.md` — original product spec

**Why:** the architect (@architect / Aria) validated the plan against current
Gemini and Rails 8 documentation and found 4 blockers plus a list of high/medium
findings, catalogued in §10 of the architecture doc. The plan was written before
that validation and still contains facts that were true at planning time but are
not true now (e.g. a retired model name). Section 11 of the architecture doc is
the agreed execution order.

**How to apply:** when the plan and the architecture disagree on anything —
model name, API version, column type, directory location, cache key — follow the
architecture. The original prompt is useful for product intent (what the tutor
should say, what the UI should show), not for stack decisions: it names Rails 7,
SQLite and Anthropic, all of which were deliberately superseded.

Related: [[chalk-talk-local-services]]
