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
- **Every admin Server Action and `/api/admin/*` route checks the caller itself** (`requireAdmin()` from `@/lib/appwrite/auth`, or role check → 401/403). Server Actions are public POST endpoints: the admin layout only guards page rendering. Code outside `src/app/admin` never imports admin actions; shared reads live in `src/lib`.
- **Collection attribute limit: 16.** Count before creating new attributes.
<!-- END:frontend-architect-principles -->

---

<!-- BEGIN:dev-workflow -->
# Git & Deploy Workflow

- **Work on `pre-dev` only.** One change per commit with a clear message, then `git push origin pre-dev`. Vercel deploys `pre-dev` as the preview wired to the DEV Appwrite project (`bestconsultant-dev`).
- **Never touch production.** No push to `prod`, `main` or any other branch, no force push, no `vercel --prod` / `deploy` / `promote` / `rollback` / `env` / `alias` — a hook in `.claude/settings.json` blocks them. Production is released by a human through a pull request `dev` → `prod`.
- **Undo with `git revert <sha>` then `git push origin pre-dev`.** Never rewrite pushed history (`reset --hard` + force push).
- **Never read or print `.env*` files.** Scripts may load them; you don't.
- **Verify after pushing.** Wait for the preview (`vercel ls`, `vercel inspect <url> --logs`), then check the page in the browser.
<!-- END:dev-workflow -->

---

<!-- BEGIN:ao-offers -->
# AO Offers (appels d'offres reçus par e-mail)

- Boîte `ao@wise-associates.fr` (IONOS, IMAP) lue en **lecture seule** toutes les 5 min par Vercel Cron (`/api/cron/ao-inbox`, `vercel.json`) et par le bouton « Synchroniser » de `/admin/ao-offers`. Aucun message n'est supprimé, déplacé ni marqué comme lu : le suivi est en base, par Message-ID (fenêtre relue : 7 jours).
- Code dans `src/lib/ao/` : `imap.ts` (lecture), `extract.ts` + `prompt.ts` (IA via `callLLM`), `parse.ts` (validation zod de la réponse IA), `fingerprint.ts` (dédoublonnage : intitulé + client + ville + contrat, sur 60 jours), `anonymize.ts` (version publique), `excel.ts` (export au format `public/templates/modele-import-offres.xlsx`, ré-importable), `filters.ts` (filtres partagés page/export), `repo.ts` (Appwrite), `sync.ts` (orchestration).
- Collections `ao_emails` (12 attributs) et `ao_offers` (**16/16 attributs : plus aucun ajout possible**), créées par `npm run ao:setup -- <fichier .env> [--apply] [--prod]` (`scripts/setup-ao-collections.mjs`, simulation sans `--apply`).
- Les offres arrivent « à valider ». Un admin publie une copie anonymisée : client (variantes du nom, sigle) et expéditeur remplacés par un libellé générique, coordonnées retirées, dans le titre, la description, la ville et les compétences ; règles réappliquées côté serveur. L'offre publique a l'identifiant fixe `ao<id de l'offre AO>` (pas de double publication). La page admin et l'export Excel gardent les vraies données (usage interne).
- E-mails en erreur réessayés 3 fois (réponse IA tronquée ou message > 25 Mo : abandonnés tout de suite) ; pièces jointes zip > 50 Mo décompressées ignorées ; 20 offres max par e-mail ; données AO supprimées après 365 jours (les offres publiées restent).
- Vercel Cron ne s'exécute que sur la production ; sur une preview `dev`, utiliser le bouton « Synchroniser maintenant ». En local : `npm run dev` puis `npm run ao:poll` (même appel toutes les 5 min, `--once` pour un seul passage ; `CRON_SECRET` ≥ 16 caractères dans les fichiers .env lus par `next dev`). Hors Vercel, n'importe quel planificateur peut appeler `GET /api/cron/ao-inbox` avec `Authorization: Bearer $CRON_SECRET`.
- Variables : `AO_IMAP_*`, `APPWRITE_COLLECTION_AO_*`, `CRON_SECRET` (≥ 16 caractères) — voir `.env.example`.
- Tests : `npm test` (node:test + tsx, fichiers `src/**/*.test.ts`) ; `npm run typecheck`.
<!-- END:ao-offers -->
