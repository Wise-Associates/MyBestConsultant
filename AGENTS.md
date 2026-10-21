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
- **Admin**: the back-office is dark (`#0F1117`, colours written in each page). **Only AO Offers (`/admin/ao-offers`) is light**: its root carries the `admin-light` class from `globals.css`, which defines the `--admin-*` tokens and paints the light background (Tailwind: `bg-admin-bg`, `bg-admin-panel`, `bg-admin-panel-raised`, `bg-admin-hover`, `border-admin-line`, `border-admin-line-strong`, `text-admin-fg`, `text-admin-fg-muted`; inline: `var(--admin-panel)`…). These tokens exist only inside an `.admin-light` element: elsewhere they resolve to nothing. Light grey background `#F5F5F6`, white cards with a hairline, anthracite text `#2C2C2E`, no shadows. Text only in `admin-fg` / `admin-fg-muted` (≥ 4.5:1); `--admin-fg-subtle` is for icons, placeholders and inactive states. Status colours on white use Tailwind 700 shades (`#047857`, `#1d4ed8`, `#b91c1c`, `#b45309`, `#6d28d9`), written as hex where a colour is also used as a tint (`${color}18`). Never use the public-site tokens (`--color-surface`, `--color-text`, `--hero-bg`…) for admin chrome: they follow the customised site theme. Making another admin page light = putting `admin-light` on its root and replacing its hard-coded dark colours with the tokens.

## Appwrite (Self-hosted 1.7.4)

- **No underscores in labels.** Use `admin` not `super_admin`.
- **node-appwrite v15** — don't upgrade, server is 1.7.4.
- **Cookies**: `mbc-session` (httpOnly) + `mbc-role` (readable by middleware). Never rename.
- **Server Actions** call `createAdminClient()` not `createSessionClient()` for mutations.
- **Sign-up never joins an existing organisation**: a recruiter who registers always gets a new tenant (unique slug `nom`, `nom-2`… via `src/lib/tenant-slug.ts`); colleagues join only through an invitation (`src/lib/team.ts`, `/recruiter/equipe`). Typing a company's name must never give access to its data.
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

- **Boîtes par organisation** (ADR 0005) : la plateforme (`tenantId` « admin » : `ao@wise-associates.fr`) et chaque organisation ont leurs boîtes IMAP (collection `ao_sources`, `sources.ts`, `server-only`). Lues si l'abonnement est `active` ou `trialing`, offre gratuite comprise (`canUseAoSourcing`, `tenancy.ts`, décision du 2026-10-21 ; une organisation créée par l'admin sans statut doit être passée « active » dans Admin → Abonnements). Serveur saisi par l'organisation : nom d'hôte dont toutes les adresses sont publiques, port 993 TLS, connexion à l'adresse vérifiée avec SNI (`imap-host.ts`, anti-SSRF), réponses bornées à 26 Mo et connexion coupée après 150 s (`withAoInbox`). Mot de passe chiffré AES-256-GCM avec `AO_CREDENTIALS_KEY`, lié à la boîte, au serveur et à l'identifiant (`mailboxSecretContext` : changer le serveur oblige à ressaisir le mot de passe), jamais renvoyé au navigateur. Isolation : e-mails suivis par boîte (index unique `sourceId` + `messageId`), empreinte de dédoublonnage propre à l'organisation (celles de la plateforme inchangées), verrou et quotas quotidiens par organisation, « nos domaines » et « jamais <nom> » = l'organisation de la boîte. Passage planifié : organisations dans l'ordre de la boîte la moins récemment tentée (`lastSyncAt` noté AVANT la lecture), 2 min au plus chacune ; l'IA indisponible arrête tout le passage. Une boîte illisible (mot de passe, serveur, délai) est journalisée, notée sur la boîte (`lastError`), affichée en bandeau dans `/admin/ao-offers` pour les boîtes de la plateforme, et fait répondre la route cron en 502 si toutes les boîtes tentées ont échoué. L'admin n'agit (Synchroniser, Réessayer, Publier, Ignorer) que sur les boîtes de la plateforme, vérifiées avant toute écriture (`platformEmail` / `platformOffer`). **Mise en place** (ordre impératif, ADR 0005) : arrêter tous les déclencheurs (`ao:poll:stop`, worker `ao-idle`, autres previews), sauvegarder la base, `npm run ao:setup -- <env> --apply`, `npm run ao:migrate-sources -- <env> --apply`, déployer, relancer `ao:migrate-sources`, puis seulement avant la phase B `--drop-old-index`. Mot de passe de la plateforme erroné : `--reseal` (ne jamais supprimer sa boîte, ses e-mails y sont rattachés).
- **Configuration des boîtes** (phase B) : propriétaire d'une organisation sur `/recruiter/parametres/boites-ao` (tous ses recruteurs voient la liste, sans mot de passe) ; plateforme sur `/admin/ao-offers/boites`. Même composant (`src/components/ao/mailboxes-manager.tsx`) et même cœur serveur (`src/lib/ao/mailboxes.ts`, `server-only`) : l'organisation vient de la session, jamais du formulaire, et chaque action vérifie que la boîte lui appartient. N'importe quelle adresse. « Tester la connexion » (serveur vérifié, connexion, dossier ouvert en lecture seule, nombre de messages ; rien d'enregistré) ; « Enregistrer » refait le test et n'enregistre que s'il réussit. Mot de passe jamais renvoyé au navigateur (`MailboxView`), à ressaisir si le serveur ou l'identifiant change (`passwordProblem`, `mailbox-input.ts`, testé). Tests de connexion limités par jour : 30 par organisation, 10 par boîte visée (serveur + identifiant, toutes organisations), 500 pour la plateforme, avec des places créées de façon atomique (`takeDailySlot`, `state.ts` : une rafale parallèle ne dépasse pas la limite) ; adresse e-mail vérifiée exigée pour tester ou enregistrer (inscription libre : le formulaire ne doit pas servir à essayer des mots de passe de tiers). 10 boîtes au plus. Compteurs et places de plus de 7 jours purgés par les passages planifiés. Erreurs traduites pour l'utilisateur (`imap-errors.ts`, testé). « Supprimer » : boîte désactivée et mot de passe effacé (`ERASED_PASSWORD`), document gardé pour que ses offres restent rattachées à l'organisation jusqu'à leur purge.
- **Page `/admin/ao-offers`** : colonnes Reçue le · Offre · Ville · Séniorité (tranche d'après l'expérience, `seniorityOf`, `stats.ts`) · Assistance / Forfait · Date limite · TJM · Compétences · Sources · Statut ; panneau de détail sur ¾ de la zone de contenu, avec technologies et originaux. **Assistance technique / forfait** (`engagement`) et **technologies** : lus par l'IA (et colonnes de tableau « Assistance technique / Forfait », « Technologies »), enregistrés dans `ao_offer_details` (un document de même identifiant que l'offre, `ao_offers` étant à 16/16 ; purgé avec elle). **Originaux** (ADR 0006) : « E-mail d'origine (.eml) » et chaque pièce jointe, relus dans la boîte au clic (`originals.ts`, route `/api/admin/ao-offers/original/[emailId]`, admin et boîtes de la plateforme seulement, Message-ID revérifié) ; jamais conservés ; servis en téléchargement forcé (`application/octet-stream`, `nosniff`, CSP `sandbox`). Tableau **sans défilement horizontal** (`table-fixed`, largeurs dans `TABLE_COLUMNS` de `ao-offers-dashboard.tsx`) : colonnes secondaires affichées selon la largeur d'écran (Ville et Sources dès 1536 px, Compétences dès 1400, Séniorité et AT / Forfait dès 1280, Date limite dès 768, Reçue le et TJM dès 640 ; Offre et Statut toujours), valeurs courtes (date 21/10/26, « AT ») avec la valeur complète en infobulle et dans le panneau. Lignes de hauteur constante : titre et client sur une ligne (texte complet au survol), 2 compétences et « +N » ouvrant une carte au survol / focus / toucher (`src/components/ui/hover-card.tsx`, réutilisable). **Sourcing** (panneau) : seuls les **5 meilleurs candidats notés 65 ou plus** (règle unique `src/lib/sourcing-rules.ts`, testée, partagée avec l'e-mail automatique de la publication), avec la raison. Toujours enregistré, lu à l'ouverture sans appel d'IA : offre publiée → matching calculé à sa publication (`tryAutoSourceCandidates` → `runPoolMatching`, lu par `getJobMatches` : base candidats, vivier, candidatures) ; offre non publiée → dernier calcul à la demande, enregistré dans `ao_offer_details.sourcing` (JSON : date, CV analysés, identifiant / score / raison des candidats retenus ; ni nom ni e-mail, relus dans la fiche du candidat). L'IA n'est appelée que par « Trouver des candidats » / « Recalculer » (environ 1 min). Attention : publier une offre AO (`createAdminJob`) envoie aussi un e-mail automatique à ces 5 candidats. **Statistiques** : `/admin/ao-offers/statistiques` (règles pures `stats.ts`, testées ; graphiques HTML/CSS `src/components/ao/stats-charts.tsx`, sans bibliothèque) : offres par mois et statut (palette validée : vert, orange, gris, jamais vert contre gris), séniorité, assistance / forfait, compétences, technologies, TJM (médiane, tranches ; salaires annuels exclus), clients, villes.
- Boîtes lues en **lecture seule** par `/api/cron/ao-inbox` (Vercel Cron une fois par jour — limite du plan Hobby —, plus un planificateur externe pour une lecture fréquente) et par le bouton « Synchroniser » de `/admin/ao-offers`. Aucun message n'est supprimé, déplacé ni marqué comme lu : le suivi est en base, par Message-ID. Chaque passage ne lit que le courrier arrivé depuis le point de reprise (dernier UID, par boîte) plus les e-mails à réessayer ; une fois par jour, ou si l'UIDVALIDITY de la boîte change, un rattrapage relit 7 jours (`checkpoint.ts`, règles pures testées).
- **Lecture complète** d'une boîte sans aucun e-mail suivi (nouvelle, ou `ao_emails` vidée pour elle) : tout le courrier des 365 derniers jours (durée de conservation), et non les 7 du rattrapage quotidien ; l'ancien point de reprise est ignoré. Elle s'étale sur plusieurs passages (5 e-mails par clic sur « Synchroniser », 25 par passage planifié), repérée d'un passage à l'autre par un document `full_<empreinte>` de `ao_sync_state`, supprimé quand un rattrapage va au bout (`planRead(…, fullRead)`, testé). Repartir de zéro pour une boîte : vider `ao_emails`, `ao_offers` et `ao_offer_details` (les statuts « publiée » / « ignorée » sont perdus ; les offres déjà publiées restent en ligne et seraient republiées en double), garder `ao_sources`.
- Code dans `src/lib/ao/` : `sources.ts` + `credentials.ts` + `imap-host.ts` + `tenancy.ts` (boîtes, organisations), `imap.ts` (lecture), `checkpoint.ts` + `state.ts` (point de reprise par boîte, verrou et compteurs par organisation), `extractors/` (chaîne de lecture des pièces jointes : `office.ts` texte local, puis `vision.ts` pour les images et PDF scannés ; ajouter un format = ajouter un extracteur dans `chain.ts`), `spreadsheet.ts` (tableaux d'offres joints lus sans IA), `extract.ts` + `prompt.ts` (IA via `callLLM`), `parse.ts` (validation zod de la réponse IA), `fingerprint.ts` (dédoublonnage : intitulé + client + ville + contrat, sur 60 jours), `anonymize.ts` (version publique), `excel.ts` (export au format `public/templates/modele-import-offres.xlsx`, ré-importable), `filters.ts` (filtres partagés page/export), `repo.ts` (Appwrite), `sync.ts` (orchestration).
- Collections `ao_emails` (**16/16 attributs**), `ao_sources` (10 attributs), `ao_offers` (**16/16 attributs : plus aucun ajout possible**, une donnée de plus va sur l'e-mail) et `ao_sync_state` (verrou + points de reprise), créées par `npm run ao:setup -- <fichier .env> [--apply] [--prod]` (`scripts/setup-ao-collections.mjs`, simulation sans `--apply`). **Lancer `--apply` sur un projet avant d'y déployer du code qui écrit un nouvel attribut** : Appwrite refuse un attribut inconnu et l'e-mail passerait en erreur.
- **Client d'une offre = entreprise de l'expéditeur d'origine** (`origin.ts`, règles pures testées, ADR 0004) : pour un e-mail transféré, l'en-tête cité le plus ancien (« De : … <adresse> », « … a écrit : ») dont l'adresse n'est pas `@wise-associates`, sinon l'expéditeur de l'e-mail. Toutes les offres de l'e-mail (lignes de tableau comprises) reçoivent le nom que l'IA lit dans sa signature — seulement si le corps de l'e-mail lui est confié, ce qui n'est pas le cas quand un tableau a été lu —, sinon celui tiré du domaine (`sopra-steria.com` → « Sopra Steria »). Entreprise introuvable (messagerie grand public, par domaine complet : `orange.fr` oui, `orange.com` non) ou aucun expéditeur extérieur : chaque offre garde le client lu dans le texte ou le tableau. L'IA ne reçoit que le **domaine** de l'expéditeur d'origine. L'expéditeur d'origine est enregistré sur l'e-mail (`origin`, « Nom <adresse> »), affiché comme expéditeur dans la page (avec « transférée par … »). La recherche d'en-têtes ne lit que les 200 000 premiers caractères, ligne par ligne (corps hostile de 25 Mo : coût linéaire, testé).
- **Clients cités, masqués à la publication** : la colonne « Client » d'un tableau et le client final lu par l'IA (`endClient`) sont relevés avant que le client de l'offre ne devienne l'entreprise de l'expéditeur, et enregistrés sur l'e-mail (`citedClients`, avant la création des offres). `hiddenNamesFor` masque le client de l'offre, ces clients cités et les deux expéditeurs (nom dans les deux ordres « Marie Dupont » / « Dupont, Marie », domaine).
- **Dates d'un appel d'offres** (`dates.ts`, règles pures testées, ADR 0004) : l'IA ne remplit `startDate` / `deadline` que pour les dates que le texte désigne lui-même (« démarrage », « date limite »…) ; les dates citées sans libellé vont dans `otherDates`, classées par le code selon leur jour de la semaine — **vendredi : date limite, lundi : démarrage**, autre jour ou date illisible : date limite (décision du 2026-10-21 ; le jour est calculé ici, l'IA se trompe sur les jours). Une date désignée par le texte n'est jamais déplacée. Année manquante (« 02/11 ») : celle de la réception de l'e-mail, ou la suivante si la date est passée de plus de 60 jours. Même règle pour l'import manuel (`/api/admin/extract-jobs`). Colonnes « Date limite / clôture / échéance » des tableaux : date limite. Une seule date limite par e-mail, la plus proche de ses offres (`emailDeadline`), enregistrée sur `ao_emails` ; affichée dans le panneau et l'export Excel, jamais publiée. Dates Excel au format court régional lues en jour/mois/année (`dateNF` dans `readSheets`).
- Les offres arrivent « à valider ». Un admin publie une copie anonymisée : client (variantes du nom, sigle) et expéditeurs (celui de l'e-mail et celui du message d'origine) remplacés par un libellé générique, coordonnées retirées, dans le titre, la description, la ville et les compétences ; règles réappliquées côté serveur. L'offre publique a l'identifiant fixe `ao<id de l'offre AO>` (pas de double publication). La page admin et l'export Excel gardent les vraies données (usage interne).
- Description d'une offre (formes variées rendues par l'IA : `### Titre`, `**Titre**`, `Libellé :` en ligne, bloc unique) : `src/lib/description-sections.ts` la découpe en sections Contexte / Missions / Profil / Modalités, pour le panneau admin AO (`ao-description.tsx`, affichage seulement) et pour pré-remplir la description à publier (`descriptionForPublication`, appelée par « Préparer la publication » après l'anonymisation : titres `###`, puces `-`, paragraphes courts). La page publique et le post LinkedIn (`buildPostText`, non modifié) lisent ce texte tel quel.
- **« Synchroniser maintenant » est continu** : la page enchaîne de petits passages (2 e-mails, `syncAoInboxNow`) jusqu'à ce que la boîte soit lue, selon `afterBatch` (`src/lib/ao/sync-loop.ts`, testé : s'arrête quand tout est lu, IA indisponible, boîte illisible, ou passage sans progrès ; attend puis réessaie si un passage automatique tient la boîte). Chaque passage renvoie les offres et e-mails à jour (`loadPlatformAoView`), affichés aussitôt : un `revalidatePath` / `router.refresh()` entre deux passages serait abandonné par Next.js au profit du passage suivant. Ligne de progression et bouton « Arrêter » (fin du passage en cours) ; la page est rafraîchie à la fin.
- Une seule synchronisation à la fois par organisation (cron, boutons, `ao:poll`) : verrou en base (document `lock_<empreinte>` de `ao_sync_state`, expiré après 6 min) ; un appel qui arrive pendant un passage de la même organisation est ignoré (`skipped: true`). Le bouton « Synchroniser » et « Réessayer » de `/admin/ao-offers` ne portent que sur les boîtes de la plateforme.
- Images (PNG, JPEG, GIF, WebP ≤ 5 Mo) et PDF sans texte (scannés) : transcrits par Claude (`claude-opus-5-5`, effort `low`, 8 000 jetons max, repli serveur sur `claude-opus-4-8` en cas de refus), 3 lectures max par e-mail et 50 par jour et par organisation (compteur dans `ao_sync_state`), clé Claude de Config IA (ou `ANTHROPIC_API_KEY`) ; sans aucune clé (ni Claude ni OpenAI), la pièce jointe est ignorée avec la raison. Archives Office vérifiées par décompression réelle bornée (50 Mo), pas d'après les tailles annoncées. Échec passager (API saturée, délai) : `RetryLater`, l'e-mail entier est repris (un report faute de temps ne compte pas comme essai).
- **Tableaux d'offres joints** (xlsx, xls, csv, tsv — tableau de suivi d'AO d'un client, export de cette page) : chaque ligne devient une offre, **sans IA** (`spreadsheet.ts`, règles pures testées avec de vrais en-têtes). Colonnes reconnues par leur nom, dans un ordre qui lève les ambiguïtés (`COLUMNS`) : intitulé, client, lieu, contrat, télétravail, TJM, compétences (toutes les colonnes concernées), durée, démarrage, date limite, expérience ; description = la colonne de description telle quelle, ou une section `### <en-tête>` par colonne (contexte, missions, profil…). Les colonnes de suivi interne (numéro, statut, candidats présentés ou positionnés, notes, taux, date de réception) et celles qui nomment des personnes ou des coordonnées (interlocuteur, manager, référent, acheteur, téléphone…) sont ignorées. En-tête cherché dans les 15 premières lignes (un intitulé + au moins une autre colonne), 500 lignes et 64 colonnes lues au plus par fichier. Fichiers hostiles : contenu vérifié par ses premiers octets (une archive renommée « .xls » ou « .csv » est refusée), décompression bornée, taille annoncée par le fichier ignorée (`readSheets` avec `nodim` et bornes, dans `job-import.ts`) ; pas d'ODS (ses cellules répétées se développent sans limite à la lecture). Même validation que les réponses de l'IA (`parseOfferFields`). Au plus 500 offres de tableaux par jour et par organisation (compteur dans `ao_sync_state`) : au-delà, l'e-mail attend sans user ses essais. Un tableau aux colonnes inconnues, ou sans aucune ligne exploitable, est lu par l'IA comme texte, avec le corps de l'e-mail. Quand un tableau a été lu, le corps de l'e-mail (qui le présente) n'est pas envoyé à l'IA — il en tirerait des quasi-doublons —, les autres pièces jointes si. L'export Excel de cette page se relit à l'identique (client compris s'il est renvoyé par l'un des nôtres ; envoyé d'ailleurs, le client devient l'entreprise de l'expéditeur). Décision : `docs/adr/0003-ao-tableaux-sans-ia.md`.
- **IA indisponible, échecs sans frais** (`ai-failures.ts`, règles pures testées) : compte ou configuration (crédits épuisés, clé refusée, modèle inconnu, non configuré — côté API compatible OpenAI, seule une réponse d'erreur JSON compte) et panne du service (saturé 429/529, erreur 5xx sauf 504, injoignable). Ces requêtes sont refusées avant traitement : rien n'est facturé. Les images et PDF scannés passent alors au modèle OpenAI de Config IA (GPT-4o par défaut, clé OpenAI de Config IA ou `OPENAI_API_KEY`, `extractors/vision-openai.ts`, nom de fichier générique envoyé) ; le texte des e-mails passe déjà aux autres modèles configurés (repli de `callLLM`, qui lève `LLMChainError` avec l'échec de chacun, message inchangé ; `LLMUnreachableError` distingue « injoignable » de « sans réponse dans le délai », `LLMNotConfiguredError` un modèle non configuré). Si tous les services échouent sans frais : `AiUnavailable`, l'e-mail reste « en erreur » avec la cause par service et est repris à chaque synchronisation sans user sa reprise. Un délai dépassé ou une réponse illisible ont pu être facturés : ils suivent la règle normale (une reprise), y compris dans un échec mixte, pour qu'un e-mail ne soit pas refacturé indéfiniment. Lecture des scans impossible : le reste du passage continue, les autres e-mails à scan attendent sans nouvel appel (`PassState`). Extraction des offres impossible : le passage s'arrête. Dans les deux cas `aiUnavailable: true` dans le compte rendu (avertissement dans les logs du cron, message sur `/admin/ao-offers`, `ao:poll` ne relance pas plus tôt). Une lecture refusée ainsi est rendue au compteur du jour. Le courrier nouveau passe avant les e-mails à réessayer (`processingOrder`). Décision : `docs/adr/0002-repli-ia-credits-epuises.md`.
- E-mails en erreur repris **une seule fois**, au passage suivant (`MAX_ATTEMPTS = 2` dans `attempts.ts`, règle pure testée ; réponse IA tronquée ou message > 25 Mo : abandonnés tout de suite) ; un e-mail en attente de l'IA (échec sans frais, `AiUnavailable`) ou reporté faute de temps ne compte pas d'essai et revient à chaque passage. Bouton **« Réessayer »** sur chaque e-mail non traité de `/admin/ao-offers` (action `retryAoEmail`, admin seulement, `manualRetryPatch`) : remet ses essais à zéro, même abandonné ou enregistré avant ces règles, puis le traite tout de suite (`syncAoEmail` : même traitement et même verrou qu'une synchronisation, sans toucher au point de reprise) ; si une synchronisation est en cours ou que ce traitement échoue, il reste en file pour la suivante. Pièces jointes zip > 50 Mo décompressées ignorées ; 50 offres max par e-mail ; données AO supprimées après 365 jours (les offres publiées restent).
- Vercel Cron ne s'exécute que sur la production ; sur une preview `dev`, utiliser le bouton « Synchroniser maintenant ». En local : `npm run dev` (ou `npm run dev:local` si Appwrite répond en « fetch failed (ETIMEDOUT) » : réseau sans IPv6 / serveur à plus de 250 ms) puis `npm run ao:poll` (même appel toutes les `AO_POLL_INTERVAL_MINUTES` minutes, 5 par défaut, ou `--every N` ; `--once` pour un seul passage ; en arrière-plan : `npm run ao:poll:start` / `ao:poll:status` / `ao:poll:stop` ; `CRON_SECRET` ≥ 16 caractères dans les fichiers .env lus par `next dev`). Hors Vercel, n'importe quel planificateur peut appeler `GET /api/cron/ao-inbox` avec `Authorization: Bearer $CRON_SECRET`.
- Variables : `AO_CREDENTIALS_KEY` (32 octets base64, serveur seulement ; la changer rend les mots de passe enregistrés illisibles), `APPWRITE_COLLECTION_AO_EMAILS` / `_AO_OFFERS` / `_AO_STATE` / `_AO_SOURCES`, `CRON_SECRET` (≥ 16 caractères), `AO_IMAP_*` (lues seulement par `ao:migrate-sources`) — voir `.env.example`.
- Tests : `npm test` (node:test + tsx, fichiers `src/**/*.test.ts`) ; `npm run typecheck`.
<!-- END:ao-offers -->
