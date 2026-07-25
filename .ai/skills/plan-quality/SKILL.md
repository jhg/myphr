---
name: plan-quality
description: Quality standards for plan mode. This skill MUST be invoked proactively whenever the AI enters plan mode or is asked to create an implementation plan — do not wait for the user to invoke it manually. It defines detail requirements, multi-perspective review protocol, iterative refinement, and mandatory verification for all plans.
allowed-tools: Agent, Read, Grep, Glob
---

## Plan Quality Standards

These standards apply to any implementation plan, regardless of domain or platform. Some sections require specific capabilities (sub-agents, project access) — use them when available, adapt or skip when not.

---

## Core Standards

### When NOT to Apply Full Standards

Not every change needs a full plan. For trivial changes (typo fixes, single-item renames, minor config tweaks), skip the multi-perspective review and just do the work. Use judgment: if the change is small, isolated, and has no side effects, a brief description is enough. These standards are for changes with meaningful scope, risk, or cross-cutting impact.

### Before Planning

- **Investigate before proposing**: understand the current state before suggesting changes. Read relevant sources, documents, or context. Never propose changes to things you haven't examined.
- **Find what already exists**: search for reusable work, patterns, or conventions already in place. Don't reinvent what's already there.
- **Assess scope early**: is this a small targeted change or a cross-cutting concern? If it's bigger than it appears, communicate that before diving into detail.

### Plan Detail Requirements

- Start with context: why this change is needed, what problem it solves, what prompted it
- List every artifact to be modified, with its full path or identifier
- For each, specify the sections affected and what changes
- Include before and after for non-trivial changes
- Be precise enough that someone could execute the plan without ambiguity or guesswork
- Explain the reasoning behind each change, not just what changes
- Call out side effects: structural or data changes, cross-component effects, tests or validations to update, dependencies to add
- Base every claim on evidence — cite specific locations, quote actual content, reference real identifiers. Never assume or guess when you can look it up.

### Decomposition and Order

- Break the work into discrete steps with clear boundaries
- Identify dependencies between steps — what must happen before what
- Identify what can be parallelized
- Put the riskiest or most uncertain steps first — fail fast
- Each step should be independently verifiable when possible

### Simplicity and Scope Discipline

Before accepting a plan as final, pressure-test it for unnecessary complexity and scope creep:

- **Prefer the simplest solution that meets the requirement.** When two approaches both satisfy
  the ask, pick the one with less surface area. A focused plan is easier to review, test, and
  revert than an elaborate one.
- **YAGNI**: do not design for hypothetical future needs. If a hook, abstraction, or configuration
  point isn't used by the current requirement, cut it. Add it when the need is real.
- **Don't fix what wasn't asked.** If the current behaviour has a known bug unrelated to the task,
  replicate the behaviour and note the bug separately — do not expand the plan to "also fix X
  while we're here". Scope creep inflates review time and delays delivery.
- **The "and we could also…" signal**: if you catch yourself adding speculative extensions to the
  plan, stop. Propose them as separate follow-up tasks, not as part of the current plan.

### Risk Identification

- Flag irreversible actions (destructive operations, permanent data changes, interface removals, external service calls)
- Identify what could break: existing tests or validations, other features, integrations, downstream consumers
- Note assumptions that haven't been verified yet
- If the plan depends on something uncertain, call it out explicitly

### Verification Section (Mandatory)

Every plan must end with a concrete verification section. This is not optional.

- Describe how to verify the changes end-to-end with specific steps, commands, or checks — not vague "verify it works"
- Cover both the expected outcome and key failure cases
- Include the specific validation steps or commands to run
- For structural or data changes, include the steps to create and apply them

### What Disqualifies a Plan

- Factual errors: references to artifacts, functions, or locations that don't exist
- Missing affected artifacts (e.g., changing an interface without planning the consumer update)
- No verification section
- Vague steps like "update the component" without specifying what changes
- Proposing changes to things you haven't examined
- Claims not grounded in evidence (guessing instead of looking it up)

---

## Enhanced: Multi-Perspective Review Protocol

> **Requires**: ability to launch independent sub-agents or sub-tasks that can work in parallel and access the project context.

Before finalizing a plan, review it from at least 4 perspectives (launch all in parallel for speed):

1. **Verification review (with context)** — Review the plan with full conversation context. Verify each factual claim against the actual source: read the referenced artifacts, check that locations and content match, confirm that identifiers and references exist as stated. This reviewer has the conversation history and can check whether the plan accurately reflects what was discussed and decided.
2. **Adversarial review (Tenth Man / Red Team)** — Defend the contrary thesis on every conclusion. Stress-test the plan against improbable-but-possible failure modes:
   - If the plan says X is the best approach, argue it is the worst or will make things worse.
   - If a solution was discarded, argue it was actually the right one.
   - If something is deemed impossible, demonstrate it is possible — and vice versa.
   - If something is deemed irrelevant, argue it is critical — and vice versa.
   - Challenge every assumption with evidence from the actual project, not just theory.
   - Also check for concrete errors: wrong locations, incorrect references, misunderstood behavior, missing edge cases.
3. **Scope review (completeness + pruning)** — Check the plan's scope from both directions:
   - **Missing**: Look for artifacts that need changes but aren't listed, forgotten test/validation updates, unhandled error paths, cross-component sync issues.
   - **Excess**: Look for unnecessary steps, over-engineering, content unrelated to the task, redundant changes, or things that add complexity without value. If a step can be removed without affecting the outcome, flag it.
4. **Fresh-eyes review** — Launch a reviewer WITHOUT the prior conversation context. Give it only the plan text and ask it to review for coherence, feasibility, and gaps. This catches assumptions that seem obvious in context but are actually wrong.

At least one reviewer must have no prior context (fresh-eyes). The others can share context but must each have a distinct adversarial goal.

> **Without sub-agents**: Apply these 4 perspectives sequentially yourself. Be aware that self-review has inherent bias — you will tend to confirm your own reasoning. The fresh-eyes perspective in particular cannot be truly replicated without an independent reviewer, since you cannot forget your own context. Despite these limitations, structured self-review from multiple angles is still significantly better than no review.

### Iterative Refinement

The 4 reviews above are mandatory for the first pass. After that, if issues with real merit are found, iterate:

1. Apply corrections to the plan.
2. Re-review — full round (all 4) or partial (only affected reviewers), at your discretion.
3. **Stop condition**: When reviews converge (no new issues with real merit), or when a 3-reviewer consensus vote (odd number, no ties) determines remaining findings are diminishing returns. If consensus is unclear, default to stopping — the burden of proof is on continuing, not on stopping.

**What counts as "real merit" (iterate)**:
- Factual errors: locations, references, or behavior are wrong
- Missing critical artifacts, tests/validations, or cross-component sync updates
- Impossible or contradictory steps
- Missing verification steps

**What does NOT count (stop)**:
- Stylistic improvements ("could be more concise")
- Hypothetical edge cases outside the task scope
- Suggestions for future refactoring
- Matters of taste or preference

The goal is to present the user with a polished plan — the user is the slowest element in the chain and should not be asked to approve intermediate iterations.

---

## Enhanced: Plan File Hygiene

> **Requires**: a persistent plan file that is reused across tasks (e.g., plan mode in a CLI tool).

When reusing a plan file from a previous task that is already completed (not a mid-task pause or amendment), the old plan content must be fully replaced. Never leave residual content from a completed plan when starting a new one — overwrite the entire file, do not append or partially edit.