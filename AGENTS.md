<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

<!-- BEGIN:karpathy-coding-guidelines -->
# Behavioral Guidelines (Andrej Karpathy)

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
<!-- END:karpathy-coding-guidelines -->

---

<!-- BEGIN:frontend-architect-principles -->
# High-Agency Frontend Architect Principles

Core principles for production-quality frontend decisions on this project.

## Architecture

- **Route structure is URL structure.** Flat paths (`/candidate/dashboard`) not route groups for namespacing.
- **Server Components by default.** Only add `'use client'` when you need state, events, or browser APIs.
- **Data at the edge.** Fetch in Server Components, pass down as props. Never fetch in client components unless real-time.
- **CSS variables over Tailwind tokens** for any themeable value — colors, fonts, radius, shadows.

## Component Design

- **No premature abstraction.** Three similar components is better than one wrong abstraction.
- **Props over context** for component-local state. Context for cross-tree global state (auth, theme).
- **Forms via Server Actions.** No client-side fetch for mutations — use `useTransition` + server action.
- **Loading states always.** Every async action has a pending state. Never leave the user guessing.

## TypeScript

- **Strict mode.** No `any`, no non-null assertions without a comment explaining why.
- **Union types for variants.** `type Status = 'pending' | 'ok' | 'error'` not magic strings scattered in the code.
- **Interface for external shapes** (API responses, Appwrite documents). Type for internal unions/compositions.

## Design System (MyBestConsultant specific)

- **Anthracite #2C2C2E + Orange #F97316** = brand identity (changed from Navy #0B1D51 + Gold #B8860B on 2026-08-28, client request via cahier de test — "trop de couleurs", épuré). Never deviate without explicit instruction.
- **Weight inversion**: H1 weight 300 (elegant), H2 weight 700 (structural). Don't flip this.
- **Hairlines over shadows** on the public site. Shadows acceptable in the dark admin.
- **No glassmorphism. No gradient blobs.** Consulting-grade = precision, not decoration.
- **Template CSS vars** drive ALL visual decisions on the public site: `var(--color-primary)`, `var(--font-heading)`, etc.

## Appwrite (Self-hosted 1.7.4)

- **No underscores in labels.** Use `admin` not `super_admin`.
- **node-appwrite v15** — don't upgrade, server is 1.7.4.
- **Cookies**: `mbc-session` (httpOnly) + `mbc-role` (readable by middleware). Never rename.
- **Server Actions** call `createAdminClient()` not `createSessionClient()` for mutations.
- **Collection attribute limit: 16.** Count before creating new attributes.
<!-- END:frontend-architect-principles -->
