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

- Boîte `ao@wise-associates.fr` (IONOS, IMAP) lue en **lecture seule** par `/api/cron/ao-inbox` (Vercel Cron une fois par jour — limite du plan Hobby —, plus un planificateur externe pour une lecture fréquente) et par le bouton « Synchroniser » de `/admin/ao-offers`. Aucun message n'est supprimé, déplacé ni marqué comme lu : le suivi est en base, par Message-ID. Chaque passage ne lit que le courrier arrivé depuis le point de reprise (dernier UID, par boîte) plus les e-mails à réessayer ; une fois par jour, ou si l'UIDVALIDITY de la boîte change, un rattrapage relit 7 jours (`checkpoint.ts`, règles pures testées).
- Code dans `src/lib/ao/` : `imap.ts` (lecture), `checkpoint.ts` + `state.ts` (point de reprise et verrou), `extractors/` (chaîne de lecture des pièces jointes : `office.ts` texte local, puis `vision.ts` pour les images et PDF scannés ; ajouter un format = ajouter un extracteur dans `chain.ts`), `spreadsheet.ts` (tableaux d'offres joints lus sans IA), `extract.ts` + `prompt.ts` (IA via `callLLM`), `parse.ts` (validation zod de la réponse IA), `fingerprint.ts` (dédoublonnage : intitulé + client + ville + contrat, sur 60 jours), `anonymize.ts` (version publique), `excel.ts` (export au format `public/templates/modele-import-offres.xlsx`, ré-importable), `filters.ts` (filtres partagés page/export), `repo.ts` (Appwrite), `sync.ts` (orchestration).
- Collections `ao_emails` (12 attributs), `ao_offers` (**16/16 attributs : plus aucun ajout possible**) et `ao_sync_state` (verrou + points de reprise), créées par `npm run ao:setup -- <fichier .env> [--apply] [--prod]` (`scripts/setup-ao-collections.mjs`, simulation sans `--apply`).
- Les offres arrivent « à valider ». Un admin publie une copie anonymisée : client (variantes du nom, sigle) et expéditeur remplacés par un libellé générique, coordonnées retirées, dans le titre, la description, la ville et les compétences ; règles réappliquées côté serveur. L'offre publique a l'identifiant fixe `ao<id de l'offre AO>` (pas de double publication). La page admin et l'export Excel gardent les vraies données (usage interne).
- Description d'une offre (formes variées rendues par l'IA : `### Titre`, `**Titre**`, `Libellé :` en ligne, bloc unique) : `src/lib/description-sections.ts` la découpe en sections Contexte / Missions / Profil / Modalités, pour le panneau admin AO (`ao-description.tsx`, affichage seulement) et pour pré-remplir la description à publier (`descriptionForPublication`, appelée par « Préparer la publication » après l'anonymisation : titres `###`, puces `-`, paragraphes courts). La page publique et le post LinkedIn (`buildPostText`, non modifié) lisent ce texte tel quel.
- Une seule synchronisation à la fois (cron, bouton admin, `ao:poll`) : verrou en base (document `sync_lock` de `ao_sync_state`, expiré après 6 min) ; un appel qui arrive pendant un passage est ignoré (`skipped: true`).
- Images (PNG, JPEG, GIF, WebP ≤ 5 Mo) et PDF sans texte (scannés) : transcrits par Claude (`claude-opus-5-5`, effort `low`, 8 000 jetons max, repli serveur sur `claude-opus-4-8` en cas de refus), 3 lectures max par e-mail et 50 par jour (compteur dans `ao_sync_state`), clé Claude de Config IA (ou `ANTHROPIC_API_KEY`) ; sans aucune clé (ni Claude ni OpenAI), la pièce jointe est ignorée avec la raison. Archives Office vérifiées par décompression réelle bornée (50 Mo), pas d'après les tailles annoncées. Échec passager (API saturée, délai) : `RetryLater`, l'e-mail entier est repris (un report faute de temps ne compte pas comme essai).
- **Tableaux d'offres joints** (xlsx, xls, csv, tsv — tableau de suivi d'AO d'un client, export de cette page) : chaque ligne devient une offre, **sans IA** (`spreadsheet.ts`, règles pures testées avec de vrais en-têtes). Colonnes reconnues par leur nom, dans un ordre qui lève les ambiguïtés (`COLUMNS`) : intitulé, client, lieu, contrat, télétravail, TJM, compétences (toutes les colonnes concernées), durée, démarrage, expérience ; description = la colonne de description telle quelle, ou une section `### <en-tête>` par colonne (contexte, missions, profil…). Les colonnes de suivi interne (numéro, statut, candidats présentés ou positionnés, notes, taux, dates de réception ou de clôture) et celles qui nomment des personnes ou des coordonnées (interlocuteur, manager, référent, acheteur, téléphone…) sont ignorées. En-tête cherché dans les 15 premières lignes (un intitulé + au moins une autre colonne), 500 lignes et 64 colonnes lues au plus par fichier. Fichiers hostiles : contenu vérifié par ses premiers octets (une archive renommée « .xls » ou « .csv » est refusée), décompression bornée, taille annoncée par le fichier ignorée (`readSheets` avec `nodim` et bornes, dans `job-import.ts`) ; pas d'ODS (ses cellules répétées se développent sans limite à la lecture). Même validation que les réponses de l'IA (`parseOfferFields`). Au plus 500 offres de tableaux par jour (compteur dans `ao_sync_state`) : au-delà, l'e-mail attend sans user ses essais. Un tableau aux colonnes inconnues, ou sans aucune ligne exploitable, est lu par l'IA comme texte, avec le corps de l'e-mail. Quand un tableau a été lu, le corps de l'e-mail (qui le présente) n'est pas envoyé à l'IA — il en tirerait des quasi-doublons —, les autres pièces jointes si. L'export Excel de cette page se relit à l'identique. Décision : `docs/adr/0003-ao-tableaux-sans-ia.md`.
- **IA indisponible, échecs sans frais** (`ai-failures.ts`, règles pures testées) : compte ou configuration (crédits épuisés, clé refusée, modèle inconnu, non configuré — côté API compatible OpenAI, seule une réponse d'erreur JSON compte) et panne du service (saturé 429/529, erreur 5xx sauf 504, injoignable). Ces requêtes sont refusées avant traitement : rien n'est facturé. Les images et PDF scannés passent alors au modèle OpenAI de Config IA (GPT-4o par défaut, clé OpenAI de Config IA ou `OPENAI_API_KEY`, `extractors/vision-openai.ts`, nom de fichier générique envoyé) ; le texte des e-mails passe déjà aux autres modèles configurés (repli de `callLLM`, qui lève `LLMChainError` avec l'échec de chacun, message inchangé ; `LLMUnreachableError` distingue « injoignable » de « sans réponse dans le délai », `LLMNotConfiguredError` un modèle non configuré). Si tous les services échouent sans frais : `AiUnavailable`, l'e-mail reste « en erreur » avec la cause par service et est repris à chaque synchronisation sans user sa reprise. Un délai dépassé ou une réponse illisible ont pu être facturés : ils suivent la règle normale (une reprise), y compris dans un échec mixte, pour qu'un e-mail ne soit pas refacturé indéfiniment. Lecture des scans impossible : le reste du passage continue, les autres e-mails à scan attendent sans nouvel appel (`PassState`). Extraction des offres impossible : le passage s'arrête. Dans les deux cas `aiUnavailable: true` dans le compte rendu (avertissement dans les logs du cron, message sur `/admin/ao-offers`, `ao:poll` ne relance pas plus tôt). Une lecture refusée ainsi est rendue au compteur du jour. Le courrier nouveau passe avant les e-mails à réessayer (`processingOrder`). Décision : `docs/adr/0002-repli-ia-credits-epuises.md`.
- E-mails en erreur repris **une seule fois**, au passage suivant (`MAX_ATTEMPTS = 2` dans `attempts.ts`, règle pure testée ; réponse IA tronquée ou message > 25 Mo : abandonnés tout de suite) ; un e-mail en attente de l'IA (échec sans frais, `AiUnavailable`) ou reporté faute de temps ne compte pas d'essai et revient à chaque passage. Bouton **« Réessayer »** sur chaque e-mail non traité de `/admin/ao-offers` (action `retryAoEmail`, admin seulement, `manualRetryPatch`) : remet ses essais à zéro, même abandonné ou enregistré avant ces règles, puis le traite tout de suite (`syncAoEmail` : même traitement et même verrou qu'une synchronisation, sans toucher au point de reprise) ; si une synchronisation est en cours ou que ce traitement échoue, il reste en file pour la suivante. Pièces jointes zip > 50 Mo décompressées ignorées ; 50 offres max par e-mail ; données AO supprimées après 365 jours (les offres publiées restent).
- Vercel Cron ne s'exécute que sur la production ; sur une preview `dev`, utiliser le bouton « Synchroniser maintenant ». En local : `npm run dev` (ou `npm run dev:local` si Appwrite répond en « fetch failed (ETIMEDOUT) » : réseau sans IPv6 / serveur à plus de 250 ms) puis `npm run ao:poll` (même appel toutes les `AO_POLL_INTERVAL_MINUTES` minutes, 5 par défaut, ou `--every N` ; `--once` pour un seul passage ; en arrière-plan : `npm run ao:poll:start` / `ao:poll:status` / `ao:poll:stop` ; `CRON_SECRET` ≥ 16 caractères dans les fichiers .env lus par `next dev`). Hors Vercel, n'importe quel planificateur peut appeler `GET /api/cron/ao-inbox` avec `Authorization: Bearer $CRON_SECRET`.
- Variables : `AO_IMAP_*`, `APPWRITE_COLLECTION_AO_EMAILS` / `_AO_OFFERS` / `_AO_STATE`, `CRON_SECRET` (≥ 16 caractères) — voir `.env.example`.
- Tests : `npm test` (node:test + tsx, fichiers `src/**/*.test.ts`) ; `npm run typecheck`.
<!-- END:ao-offers -->
