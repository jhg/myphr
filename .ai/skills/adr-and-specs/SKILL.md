---
name: adr-and-specs
description: Create and maintain Architecture Decision Records (docs/adr/) and implementation Specs (docs/specs/). Trigger proactively when adding a core model or domain, integrating an external service, changing an established architectural pattern, doing cross-domain schema changes, or when a previously recorded decision changes (update the existing ADR in place, do not create a superseding one). Also use when the user asks to create or review an ADR or a spec, or to write up a feature's implementation detail or user stories.
user-invocable: true
---

# Architecture Decision Records (ADRs) and Specs

ADRs document architectural decisions with their context and trade-offs. Each ADR lives in `docs/adr/` as
a standalone Markdown file. Specs complement ADRs with implementation-level detail (user stories, scope,
acceptance criteria) and live in `docs/specs/`; see "Specs" below. All paths in this skill are relative to
the repo root. This is a Laravel application (PHP), so frame decisions in Laravel terms: models,
migrations, services/actions, jobs, Filament resources, etc.

Reference: https://adr.github.io/ (methodology, templates, tooling). Our template is a variant of Michael Nygard's original format (2011) with an added Rationale section. For an alternative approach that emphasizes considered options with pros/cons, see MADR: https://adr.github.io/madr/

## A living document, not a chain of replacements

These ADRs exist to be read by AI agents as working context, not just by humans. That changes what
"keeping them up to date" means. If a decision changes and the response is to create a new ADR that
supersedes the old one, an agent investigating "why did we do this?" has to open both files and
reconstruct the current decision from two documents, and over time those chains grow longer. So when a
decision genuinely changes, **update the existing ADR in place**: rewrite Context/Decision/Rationale/
Consequences to reflect what is current, and move the previous decision into the Decision History section
(see the template below), with the date and the reason it changed. The document stays a single source of
truth with its own internal history, instead of a graph of files that reference each other by
"superseded by".

This does not mean cramming unrelated concerns into one file. A genuinely new and distinct concern still
gets its own ADR (see "Reconcile with existing ADRs" below). The line is: same decision evolving over
time stays in one file; a new concern gets a new file.

## When to create an ADR

- New core Eloquent model or domain
- New external integration (Stripe, a mail/queue driver, Sentry, etc.)
- Changing an established pattern (e.g. moving business logic from controllers into dedicated action/service classes, or changing how a domain is queried)
- Database schema changes that affect multiple domains or models
- New infrastructure or deployment decisions
- Any decision where "why did we do it this way?" will come up later

## When NOT to create an ADR

Not every change is an architectural decision. Skip the ADR if:

- Adding a field to an existing model without changing the data model's structure
- Bug fixes, even complex ones
- Routine refactors that don't change the approach (renaming, moving files, extracting a method)
- Adding a new serializer or view that follows an existing pattern
- UI-only changes with no backend or architectural impact
- Performance optimizations that don't change the public API or data model

The test: if the decision is easily reversible and nobody will wonder "why did we do it this way?" in six months, it does not need an ADR. If what you need is implementation-level detail rather than a decision, see "Specs" below instead.

## Before creating

1. List existing ADRs to avoid duplicates:

```
Glob docs/adr/[0-9]*.md
```

2. Read any ADR that covers a related topic. If the existing ADR still applies, do not create a new one.
   If the decision it documents has evolved or changed, whether the ADR is Proposed or Accepted, update
   that same ADR in place: revise it to reflect the current decision and move the previous one into its
   Decision History section (see the template's "Step 3"). Only create a new ADR when the topic is a
   genuinely distinct concern, not a change to this one (see "Reconcile with existing ADRs" below).

3. Search the repo's own `docs/` first for related context: meeting notes, reference material, and prior decisions often hold the background behind a decision. Note the `docs/extras/` rule: read it for context only, never copy its content into the ADR (or any versioned file).

4. If the repo already has ADRs, read at least one to calibrate tone and level of detail before writing. If `docs/adr/` is still empty, you are writing `0001`: the template and style rules in this skill are your calibration.

## Creating an ADR

Steps 1-3 below are for a **new** ADR. If you are instead documenting how an existing decision changed,
skip them: you don't generate a new number, you edit the existing file in place (see "Updating an
existing ADR" after Step 7).

### Step 1: Determine the next number

Glob `docs/adr/[0-9]*.md`, find the highest number, add 1. Zero-pad to 4 digits.

### Step 2: Choose the filename

Format: `NNNN-kebab-case-title.md`. The title in the filename is always in English, regardless of the language used inside.

Example: `0007-stripe-payment-intents.md`

The title must name what the ADR actually decides, nothing more. Do not oversell the scope (titling it
`tax-model` when it only fixes naming conventions, for example). If the scope shifts while you draft,
revisit both the title and the filename so they still match the content.

### Step 3: Create the file

Use the Write tool to create `docs/adr/NNNN-title.md` with this structure:

```markdown
# ADR NNNN: Short and descriptive title

* **Status**: Proposed
* **Date**: YYYY-MM-DD (today)
* **Decider**: [ask the user if unknown; use `Development Team` when the whole technical team decided collectively]
* **Consulted**: [anyone consulted, or remove this line]

## Context

What problem are we solving? Why now? What triggered this decision?

## Decision

What is the proposed solution?
* **Tool/Library**: [if applicable, omit if not relevant]
* **Implementation**: How does it fit into the project?

## Rationale

Why this option and not the alternatives? What did we consider?
* **Pros**: ...
* **Cons**: ...

## Consequences

What changes after this is applied? Migrations, new dependencies, breaking changes, files affected.
```

The Tool/Library and Implementation bullets under Decision are optional. Use them when the decision involves a specific library or integration. For decisions about internal patterns or data modeling, write Decision as fluid paragraphs instead.

The metadata block also accepts an optional `* **Updated**: YYYY-MM-DD` line, added the first time the
ADR is revised after its initial `Date`. Omit it entirely on an ADR that has never changed.

When you update an existing ADR because the decision evolved, append a `## Decision History` section
after `## Consequences` (create it the first time this happens; it does not exist in a fresh ADR):

```markdown
## Decision History

### YYYY-MM-DD — [what changed, one line]
Previously decided: [prior decision, summarized].
Changed because: [what motivated the change].
```

Newest entry on top. This is where a previously chosen approach that got replaced belongs, along with
the reason, per "A living document, not a chain of replacements" above. It is not for alternatives
considered when the decision was first made; those stay in Rationale. It is specifically for how the
decision evolved over time.

### Step 4: Gather missing context

Before writing, review what you know from the conversation and identify gaps. Ask the user about anything you cannot confidently answer. Common questions to consider:

- **Alternatives**: What other options were evaluated? Why were they discarded? (An ADR without alternatives considered is incomplete.)
- **Scope**: Does this affect the data model, the API contract (consumed by the separate frontend), the Filament admin panel, or several at once? Which models or domains are touched?
- **Trigger**: What motivated this decision now? A bug, a new feature, a scaling problem, tech debt?
- **Constraints**: Are there deadlines, compliance requirements, or dependencies on external services that shaped the decision?
- **Consulted**: Was anyone else involved in the discussion? Should they be listed?
- **Trade-offs the user sees**: The user often knows downsides that are not obvious from the code. Ask explicitly: "What downsides or risks do you see with this approach?"
- **Migration path**: Are there breaking changes? Do existing data or APIs need migration?
- **Reversibility**: How hard would it be to undo this decision later?

Do not ask all of these mechanically. Filter by relevance to the specific decision and ask only what you genuinely cannot infer from the conversation or the codebase.

### Step 5: Fill in the content

Use the conversation context and the answers from Step 4 to write the ADR. Ask the user to review and complete anything still missing.

### Step 6: Surface the ADR from the project guidelines if relevant

If the decision affects an area covered by the project guidelines, add a one-line pointer to the new
ADR in the relevant `.ai/guidelines/*.md` file, then run `php artisan boost:update` to regenerate
`CLAUDE.md` / `AGENTS.md`. Example pointer:

```
- See ADR `docs/adr/0007-stripe-payment-intents.md` for full decision rationale.
```

Adding that pointer is business-as-usual housekeeping: it lives in the guideline and points back at the
ADR. Do not narrate the housekeeping inside the ADR ("we added a pointer in the guidelines", "we ran
`boost:update`", "we mirrored this into guideline X"); an ADR's Consequences describe what changes in the
system, and that narration is process residue that reads as machine-generated. The exception is when the
decision is partly to set a new working rule that the guidelines will enforce: then state the rule itself
as a consequence (e.g. "every UI string must be translatable"), not the file edit.

Never edit `CLAUDE.md` or `AGENTS.md` directly: they are generated by Laravel Boost from
`.ai/guidelines/*.md` and any manual change is overwritten on the next `boost:update`.

### Step 7: Reconcile with the existing ADRs and guidelines

A new ADR rarely lives alone. It usually refines a deferred item, changes an assumption, or builds on a
prior decision, so after drafting reconcile it with what is already on disk. This is what keeps the set
maintainable instead of a pile of docs that quietly disagree, and it pays off both long-term and right
now, when someone implements against them.

- Same decision, evolved: if what you are documenting is a change to a decision an existing ADR already
  covers, this is not a "new ADR that contradicts an old one" situation, it is the update case: edit that
  ADR in place per "Updating an existing ADR" below, instead of creating a second file.
- Distinct concern, resolves an open item: if an older ADR left an open item or a forward-looking
  "this gets decided in its own ADR", and your new ADR resolves that as a genuinely separate decision,
  update the older ADR so it no longer disagrees: mark the open item "resolved in ADR NNNN" and point to
  it. This is a legitimate cross-reference between two distinct decisions, not the superseding pattern.
- Cross-reference both ways: when two ADRs relate (one builds on or diverges from the other), each
  should mention the other, so a reader landing on either finds the rest.
- Guidelines too: if the new ADR changes how a domain entity is named or modeled, update the relevant
  `.ai/guidelines/*.md` (naming tables, the ADR index) and run `boost:update`. A guideline still
  describing the old model is a silent contradiction.
- Justified exceptions: if the new ADR deliberately breaks a rule from another ADR, say so in the new
  ADR ("this is the exception to X, because Y"), so a future reader does not read it as an accident.
- A cheap way to catch what you missed: grep the repo for the entity or term you changed. A stale
  mention in another ADR or guideline is the contradiction you overlooked.

### Updating an existing ADR

This is the common path when a decision changes, whether the ADR is Proposed or Accepted: edit the file
in place, you do not create a new number or a new file for the same decision.

1. Rewrite Context, Decision, Rationale and Consequences so they describe the decision that is current
   now. Do not leave stale content in the body for the sake of "history": history belongs in Decision
   History, the main sections describe what is true today.
2. Add or update the `**Updated**: YYYY-MM-DD` metadata line.
3. Add an entry to `## Decision History` (create the section if this is the first update) with what was
   decided before and why it changed. See the template in Step 3.
4. If the change affects `.ai/guidelines/*.md`, update it and run `boost:update`, same as Step 6.
5. Grep the repo for the term or entity you changed, same as the "cheap way to catch what you missed"
   above: a stale mention elsewhere is a contradiction you introduced.

The only case a new ADR is warranted despite touching the same area is when the new concern is genuinely
distinct from the original decision, see "Distinct concern" above.

## Writing style

The style rules below (language, tone, brevity, formatting) apply equally to ADRs and to Specs.

### Language choice (Spanish vs English)

Default to the language the user is using in the conversation, but override based on the decision's
domain:

- **Spanish** only when the concept is intrinsically local: it belongs to a Spanish legal, fiscal, or
  administrative system with no equivalent in English-speaking countries, so a translation would be
  inaccurate or misleading, not merely awkward. `procurador` names a legal role that does not exist in
  Anglo-Saxon systems; `IVA`, `IRPF`, `retenciones` are Spanish tax mechanics with no clean English
  counterpart. The test is not "is this about taxes or law", it is "does translating this term lose or
  distort the meaning". If the answer is no, it does not qualify.
- **English** for everything else, including topics that sound domain-specific but are actually general
  and translate cleanly: a generic invoicing concept, a subscription billing model, a legal concept that
  exists across jurisdictions, caching strategy, queue design, API versioning, schema patterns. Default
  to English unless a specific term genuinely fails the Spanish test above.

When in doubt, ask the user.

### Tone and level

Write at a B2 level. Technical but accessible. The ADR should read like a developer
wrote it for their team, not like documentation generated by a tool.

If the repo already has ADRs, calibrate against the most recent one written in the same language as
yours: read it all the way through before drafting and match its length, paragraph rhythm, and use
of technical terms. Do not pad: if siblings are 80-100 lines, yours should land in that range unless
the decision genuinely needs more. If there are no ADRs yet, aim for that same 80-100 line target as
a sensible default.

Brevity is the default, not a finishing pass. The fewer words you spend on an idea, the easier it is
for a human to read, review, and follow. After the first draft, cut every sentence that does not change
the decision or its rationale, then ask whether each surviving paragraph could be a single sentence.
Expect to cut, often by half. If the user asks you to make it shorter more than once, you started too long.

When writing in Spanish, use full accents and diacritics: `implementación`, `patrón`,
`días`, `está`, `así`, `también`, `después`, `migración`, `validación`, etc. The first
draft of an ADR without accents reads like a translation, not like a developer's notes.

### Reuse what the user already wrote

When the user has already explained the decision in their own words (in chat, a note, or a pasted
block), that explanation is your draft. Adapt it into the ADR sections: keep its structure, its
examples, and its voice. Your job is to organize and tighten what they wrote, not to re-author it from
scratch or lift it to a more formal register. Re-inflating a clear explanation is the fastest way to
make an ADR read as machine-written. If they gave you a worked example with real numbers and real field
names, keep it: a concrete example survives better than an abstraction.

### Spanish-specific anti-patterns

Avoid Spanglish and English calques. They read as machine-translated and break the
"a developer wrote this for their team" tone.

| Avoid (English calque) | Use instead (natural Spanish) |
|------------------------|-------------------------------|
| `popular` (campos)     | `rellenar`                    |
| `bypasear` / `bypasea` | `saltarse` / `no pasa por`    |
| `trackear`             | `registrar` / `rastrear`      |
| `setear`               | `asignar` / `establecer`      |
| `deprecar` (informal)  | `marcar como obsoleto`        |
| `mockear`              | `simular`                     |

Avoid AI-sounding constructions in Spanish. They pattern-match LLM output even when
the surrounding text is correct:

- "Esto deja la puerta abierta a…" → "Esto deja sitio para…" / "Permite…"
- "Cabe destacar que…" / "Es importante mencionar que…" → just say the thing
- "En este sentido…" / "Por su parte…" → drop the connector, the sentence works without it
- "Resulta crucial…" → "Es necesario…" / cut the adjective

Some technical jargon stays in English even when a Spanish equivalent exists, because the English
form is the established term among developers and sounds more natural: `commit`, `socket`,
`cherry-pick`, `hash`, `salt`, `populate`, `deploy`, `rollback`, `merge`. Prefer these over forced
translations like "confirmar cambios" or "fusionar ramas".

Code identifiers (model names, fields, methods, English-only terms like `snapshot`,
`junction`, `inline`, `partial UNIQUE`, `bulk_create`) stay in English in code spans.
The surrounding prose is Spanish.

### Level of detail

An ADR is a conversation with a future developer (Nygard, 2011). The whole document
should fit in 1-2 pages. Focus on the decision and its reasoning, not on implementation
minutiae.

The right level is **model and component names, not method signatures**. Mention the
`ChatMessage` model's `message_type` column or `POST /api/proposals` when they clarify the
decision, but do not list every method, every line changed, or every file touched.
That belongs in the commit history or the PR description.

Good: "We extended `ChatMessage` with a `message_type` column and a nullable `object_id`
to link messages to domain objects like proposals."

Too detailed: "We added `netToGross(int $net, float $feeRate)` in `app/Support/Money.php`
at line 42 that takes a Money value and returns..."

Too abstract: "We changed the message model to support different types."

When in doubt, ask: would a new team member understand *why* we made this choice and
*what* it affects, without needing to read the actual code? If yes, the detail level
is right.

### Line length

Break lines at ~120 characters, like a human would in a text editor. Do not write
entire paragraphs as a single long line. Insert line breaks at natural phrase boundaries
so the text reads well in any editor without horizontal scrolling.

### Final check

As a last pass, fix typos, missing punctuation, run-on sentences and repeated words, and split any
sentence that needs a second read. The target is one-pass reading: the reader follows the decision
without backtracking, which is what lets them vet the foundations.

### Do

- Write short, fluid paragraphs. A paragraph that explains a decision clearly is better than a bullet list.
- Go straight to the point with concrete examples from the codebase.
- Use real names: models, fields, endpoints, files.
- Use active voice and clear subjects ("We created a Location model" not "A Location model was created").
- Include the trade-offs honestly. Every decision has downsides.
- Attribute the sources you lean on (a law, a spec, a package, a competitor's approach) with a name or link, so a reader can verify the claim instead of trusting it.

### Do not

- Use emojis.
- Use em dashes (`—`) or the `§` section sign, or other markers typical of AI-generated text. Replace an em dash with a comma, colon, parentheses or a separate sentence; write section references in full ("section 3", not "§3").
- Use filler phrases: "Es importante destacar que...", "Cabe mencionar...", "It's worth noting...", "Let's explore...".
- Over-explain obvious things. The reader is a developer.
- Use grandiose or overly formal language.
- Create excessive bullet lists where a paragraph works better.
- Reach for a table or diagram by default. Prose is the default; use a table, a short schema block, or a small diagram only when it shows structure faster than a sentence would (a column layout, a relationship map), never for decoration.
- Overuse bold. Bold belongs on the fixed structural labels only (the metadata block, `Pros`/`Cons`, and the optional `Tool/Library`/`Implementation`), and almost nothing else. Never put a bold label at the head of every bullet in a content list, the decisions list of a long ADR is the usual trap: if everything is bold, nothing stands out, and a page of bold leads reads as machine-written. Leave those leads as plain text, the key term still starts the line and stays scannable.
- Pull in adjacent concerns the user has not decided. Stick to the decision in front of you; a related but separate topic gets its own ADR or is left out. Padding with nearby-but-undecided detail is the most common way an ADR balloons.
- Include function signatures, line numbers, or file-level diffs. That is commit-level detail, not ADR-level.
- Make the ADR depend on sibling docs to be understood. It should be self-contained: a reader who knows the codebase but has never opened any feature-level operational doc must still grasp the decision and its trade-offs from the ADR alone. Cross-references for *more detail* are fine; cross-references that are *required reading* are not. A Spec may depend on its ADR (that dependency is expected, see "Specs" below), but an ADR must never require reading a Spec to be understood.
- Use Spanglish: `popula`, `bypasea`, `trackea`, `setear`, `mockear`. See "Spanish-specific anti-patterns" above for natural Spanish equivalents.

## ADR lifecycle

- **Proposed**: Initial status. The decision is under discussion. Can be edited freely as the discussion evolves.
- **Accepted**: The team agreed. Implementation can proceed. This does not freeze the file: if the decision
  later evolves, update it in place per "Updating an existing ADR" above. What must not happen is a
  silent change, what was decided and when it changed must stay traceable through `**Updated**` and
  `## Decision History`.
- **Deprecated**: The decision no longer applies and has no replacement (e.g. the feature it covered was
  removed). Add a short note at the top explaining why it was retired. This is the only case of an ADR
  that goes out of use.

There is no "Superseded" status. Superseding is exactly the file-to-file chain this skill avoids: an
Accepted decision that changes is handled in the same file, through Decision History, not by pointing
at a different one.

When a related but distinct concern comes up, prefer creating a new ADR that references the
original instead of extending the old one. Editing is appropriate for status changes, corrections,
updates to a decision that evolved, or filling gaps within the original scope. Creating a new ADR is
appropriate only when the new concern has its own life: even if related, it deserves its own context,
rationale, and consequences. This keeps each ADR focused and searchable, while an evolving decision
stays a single document.

## Specs (docs/specs/)

An ADR captures a decision and why it was made: high level, 1-2 pages. A Spec captures the how:
implementation-level detail, user stories, concrete scope, acceptance criteria. An ADR answers "why did
we do this?"; a Spec answers "what exactly are we building?". Not every feature needs a Spec; most only
need an ADR, or nothing.

Create a Spec when implementing a feature needs a detailed, shared plan that goes beyond what an ADR
should hold. The "Writing style" and "Level of detail" rules above deliberately keep ADRs high level, so
implementation detail that does not fit there goes into a Spec instead of bloating the ADR.

A Spec may reference the ADR(s) that govern it; that dependency is expected (see the "Do not" bullet on
sibling docs above), and unlike ADRs, a Spec is allowed to require its ADR as background reading. The ADR
stays high level and does not depend on the Spec.

`docs/specs/` does not exist yet in this repo, and this skill has only one signal to go on so far ("user
stories" and "implementation detail"). Rather than lock in a full template before a real Spec exists, use
this as a starting skeleton and treat it as provisional, revisit it once the first real Spec is written:

```markdown
# Spec: [title]

* Related ADR(s): docs/adr/NNNN-...

## User stories

## Scope / out of scope

## Acceptance criteria

## Open questions
```

File naming and numbering for Specs are also left open for now; deciding them ahead of a real use case
risks a scheme the first Spec immediately contradicts. The same living-document principle from "A living
document, not a chain of replacements" applies to Specs too: update a Spec in place as implementation
detail firms up, rather than replacing it with a new file.
