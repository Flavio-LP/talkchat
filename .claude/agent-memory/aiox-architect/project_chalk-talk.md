---
name: project-chalk-talk
description: Chalk Talk (Rails 8 + React English tutor app) — the Gemini model ID rotates every ~6 months, so it must stay in ENV and be re-verified each session
metadata:
  type: project
---

Chalk Talk is a greenfield English conversation-practice app being built inside
`/home/flavio/Documents/speakproject/englishspeaker/` (Rails 8 API + React/Vite,
Postgres on port 5433, Redis via Docker, Google Gemini free tier).

The load-bearing fragile fact: **the Gemini model ID is a moving target.**
`gemini-2.0-flash` (chosen in `chalk-talk-plan.md`) was hard-shut-down
2026-06-01; `gemini-2.5-flash` has a 2026-10-16 shutdown date. Architecture
decision was to put the model in `GEMINI_MODEL` env var rather than a Ruby
constant, precisely because of this ~6-month churn cycle.

**Why:** the plan was written before the 2.0 shutdown and silently went stale —
implementing it verbatim would have produced HTTP 502 on every single request.

**How to apply:** Any time this project's Gemini integration comes up, re-check
https://ai.google.dev/gemini-api/docs/deprecations against the current date
before recommending a model ID. Never trust a model name recalled from memory
or read from `chalk-talk-plan.md`. Full analysis lives in
`docs/architecture/chalk-talk-architecture.md` (§9.2, §10.1).
Related: [[user-language-preference]]
