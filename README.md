# PRISM

**Status:** Public repository, active development. Live app: [narviai.com](https://narviai.com) links to current deployments.

An AI-native life-and-finance interface: a single orb-shaped hub — a C60
Buckminsterfullerene mesh — that a supervising AI routes commands through,
with every financially consequential action stopped behind an explicit
permission gate before it executes.

This document exists because the source is a small number of dense files —
`PRISM.jsx` alone is tens of thousands of lines — and reading it top to
bottom won't surface the actual architecture as fast as this will.

---

## The interface: a real geodesic sphere, not a decorative one

The hub is built as an actual C60 Buckminsterfullerene structure: vertices
placed via golden-ratio construction, rendered as a hex-node mesh with dual
bonds between them, drawn live on canvas rather than as a static asset. The
UI's own diagnostic readout (`MESH: C60 Buckminsterfullerene`) states the
geometry it's built from because it's true, not for flavor — the shape
carries real structure, not just a look.

Panel transitions run through an explicit phase machine —
`IDLE → TRAVEL → BORDER → FILL → SCAN → OPEN` — each phase timed
independently (a 380ms travel, a 440ms border draw, a 220ms fill and scan).
Nothing snaps into place; every panel earns its way open through the same
sequence, which is what gives the interface its considered, mechanical feel
rather than a generic slide-and-fade.

## Routing: a 5-organ classification system

User input is classified into one of five "organs" before anything happens
with it — `computeORC` scores the input, `computeIRV` computes a per-organ
relevance value, and the highest-scoring organ receives the request. This is
the system deciding *what kind of thing* it's being asked to do before it
decides *what to do about it* — a routing layer, not a single do-everything
handler. The routing decision and its confidence score are surfaced directly
in the UI (`→ organ name · IRV: 0.xx`), not hidden behind the response.

## The permission gate: real UI, not a confirmation dialog

Any action with financial consequence — the clearest example is adding
income — does not execute on the AI's decision alone. It's captured as a
pending action, surfaced to the user explicitly, and only proceeds on
explicit confirmation. There is exactly one path by which a gated action
reaches its effect, and that path runs through the gate every time; there's
no second route that skips it. The AI can *propose* a financial change. It
cannot *make* one.

## Nano-AI diagnostic log: bounded, visible, honest about its own limits

Every Nano-AI action — attempted or completed — is logged to a diagnostic
panel the user can open, capped at 30 entries. The cap is deliberate: an
uncapped log that silently drops old entries misrepresents itself as
complete when it isn't, so the system caps visibly instead, and the panel is
built to be read by the person using the app, not just for internal
debugging.

## Data layer: demo mode and authenticated mode, genuinely separate

PRISM runs in two real modes — a demo mode with seeded example data, and an
authenticated mode backed by Supabase — switched through the same data hook
rather than two divergent codepaths that could quietly drift apart. A user
in demo mode is never shown live data dressed up as an example, and the
distinction is structural, not a label.

## API key handling

The app's AI calls route through a server-side proxy rather than calling the
model provider directly from the client. The API key never reaches the
browser — this isn't a hardening pass added after the fact, it's how the
request path was built from the start.

---

## Design principles behind the above

- **Classify before you act.** The organ-routing layer exists so the system
  knows what kind of request it's handling before it decides what to do — a
  separate step, not folded into a single handler that has to guess.
- **Gate what has consequence.** Anything with a real financial effect stops
  at an explicit, single-path permission gate. Anything without one doesn't
  need to.
- **Show your own limits.** The diagnostic log is capped and says so, rather
  than pretending to be a complete record it isn't.
- **Keep secrets server-side, structurally.** The API key's absence from the
  client isn't a rule the client honors — it's a request path the client was
  never given the key to make.

---

*This document describes the app's architecture as of September 2026. The
source in this repository is the documentation of record — this README is a
guide to reading it, not a substitute for it.*
