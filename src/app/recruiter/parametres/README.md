# Appels d'offres de l'organisation — `/recruiter/parametres/boites-ao`

Appels d'offres reçus par e-mail dans les boîtes IMAP de l'organisation du recruteur, lus automatiquement et devenus
des offres « à valider » : tous les recruteurs de l'organisation les consultent, les commentent, les ignorent, les
suppriment, les exportent, y cherchent des candidats et les **publient** comme offres de l'organisation (visibles
ensuite dans `/recruiter/annonces`). C'est **le même tableau** que `/admin/candidats` (mêmes composants, même cœur
serveur), limité aux boîtes de l'organisation de la session. Rubrique « Appels d'offres » du sous-menu ; sous-pages :
`…/boites` (boîtes de réception), `…/<offre>` (page d'une offre), `…/statistiques`. Le dossier `parametres/` ne contient
que `boites-ao/`.
Décisions : [ADR 0005](../../../../docs/adr/0005-ao-boites-par-organisation.md) (boîtes par organisation, phase C pour
cette page), [ADR 0019](../../../../docs/adr/0019-ao-liste-filtree-par-le-serveur.md) (liste filtrée par le serveur,
chargement par 50), [0006](../../../../docs/adr/0006-ao-originaux-relus-dans-la-boite.md) (originaux relus dans la
boîte), [0013](../../../../docs/adr/0013-ao-publication-anonymisee-par-ia.md) et
[0020](../../../../docs/adr/0020-ao-publication-non-anonymisee.md) (version publiée),
[0023](../../../../docs/adr/0023-recruteur-affecte-identifiant-de-profil.md) (recruteur affecté).
Règles produit : AGENTS.md, section « AO Offers (appels d'offres reçus par e-mail) », en particulier « Boîtes par
organisation », « Configuration des boîtes », « Appels d'offres des organisations », « Page d'une offre », « Liste
filtrée par le serveur », « Suivi des publications ». Ce README décrit ce qui est propre à l'espace recruteur ; le
traitement des e-mails, l'anonymisation et la publication sont décrits dans AGENTS.md et les ADR.

## Fichiers

```
boites-ao/layout.tsx             AoPublicationsProvider : préparation et publication continuent d'une page de la section à l'autre
boites-ao/loading.tsx            AoListSkeleton
boites-ao/page.tsx               tableau : session, loadAoView, abonnement, boîtes en erreur, suivi → AoOffersDashboard
boites-ao/actions.ts             Server Actions du tableau et de la page d'une offre : appelant, abonnement, quotas, puis cœur
boites-ao/[offerId]/page.tsx     page d'une offre : loadAoOfferRow, offres voisines, suivi, recruteur affecté → AoOfferPage
boites-ao/[offerId]/loading.tsx  AoOfferSkeleton
boites-ao/boites/page.tsx        boîtes de l'organisation : listMailboxes, abonnement → MailboxesManager
boites-ao/boites/actions.ts      Server Actions des boîtes : tester, enregistrer, activer / désactiver, supprimer
boites-ao/statistiques/page.tsx  statistiques : listAllAoOfferRows → AoStatsView
```

Code partagé avec `/admin/candidats` ([`src/app/admin/candidats/`](../../admin/candidats/)) :

- Cœur des actions : [offer-actions.ts](../../../lib/ao/offer-actions.ts) ; cœur des routes : [http.ts](../../../lib/ao/http.ts).
- Isolation : [access.ts](../../../lib/ao/access.ts) (`aoAccess`), [platform-view.ts](../../../lib/ao/platform-view.ts)
  (`aoAccessFor`, `loadAoView`, `loadAoOfferRow`, `loadAoNeighbours`, `searchParamsOf`).
- Boîtes : [mailboxes.ts](../../../lib/ao/mailboxes.ts), [mailbox-input.ts](../../../lib/ao/mailbox-input.ts).
- Droits et quotas : [tenancy.ts](../../../lib/ao/tenancy.ts) (`canUseAoSourcing`, `COUNTER_PREFIX`),
  [sourcing-access.ts](../../../lib/ao/sourcing-access.ts), [attempts.ts](../../../lib/ao/attempts.ts)
  (`AO_RETRY_DAILY_LIMITS`), [publication-copy.ts](../../../lib/ao/publication-copy.ts)
  (`AO_PUBLICATION_AI_DAILY_LIMITS`), [state.ts](../../../lib/ao/state.ts) (`takeDailySlot`, `takeDailySlotId`,
  `releaseDailySlot`).
- Liste : [filters.ts](../../../lib/ao/filters.ts), [offer-index.ts](../../../lib/ao/offer-index.ts),
  [repo.ts](../../../lib/ao/repo.ts) ; suppression groupée et offres échues : [bulk-delete.ts](../../../lib/ao/bulk-delete.ts).
- Contrat du tableau (actions, liens, textes passés en props) : [dashboard-types.ts](../../../lib/ao/dashboard-types.ts).
- Écrans : [ao-offers-dashboard.tsx](../../../components/ao/ao-offers-dashboard.tsx),
  [ao-offer-page.tsx](../../../components/ao/ao-offer-page.tsx), [ao-offer-detail.tsx](../../../components/ao/ao-offer-detail.tsx),
  [mailboxes-manager.tsx](../../../components/ao/mailboxes-manager.tsx), [ao-stats-view.tsx](../../../components/ao/ao-stats-view.tsx),
  [offer-publications.tsx](../../../components/ao/offer-publications.tsx), [ao-sync-provider.tsx](../../../components/ao/ao-sync-provider.tsx)
  (monté par le layout de l'espace recruteur), [ao-assignee.tsx](../../../components/ao/ao-assignee.tsx).
- Routes de l'espace : [`src/app/api/recruiter/ao/`](../../api/recruiter/ao/) (`sync`, `liste`, `export`, `echues`,
  `original/[emailId]`).
- Recruteur affecté : [recruiter-assignment.ts](../../../lib/recruiter-assignment.ts).

## Accès et périmètre des données

- Chaque page : layout de l'espace recruteur, puis `redirect('/login')` si
  `!user || user.role !== 'recruiter' || !user.tenantId`. Chaque Server Action : `recruiter()` (`boites-ao/actions.ts`)
  ou `requireRecruiter()` (`boites/actions.ts`) ; chaque route : 401 sans session, 403 hors rôle `recruiter` ou sans
  organisation. **Tous les recruteurs de l'organisation** ont les mêmes droits (aucune règle de propriétaire depuis le
  2026-10-27, ADR 0005).
- L'organisation vient toujours de la session (`user.tenantId`) et est passée au cœur ; aucun identifiant
  d'organisation ne vient du navigateur.
- Isolation (`aoAccess`, testé) : un e-mail est à l'organisation si sa boîte (`ao_emails.sourceId` → `ao_sources`) a
  ce `tenantId` ; une offre, si son e-mail l'est (`ao_offers` est à 16/16 attributs, sans organisation). Sinon `null`,
  traité comme « introuvable ». Chaque fonction du cœur vérifie l'offre ou l'e-mail par `aoAccessFor(tenantId)` avant
  d'agir ; un identifiant non conforme (`isDocumentId`) est refusé avant toute lecture. La liste lit `ao_offer_index` par
  `tenantId` puis ne garde que les offres dont l'e-mail vient d'une boîte de l'organisation (ADR 0019, « isolation
  redoublée »).
- Boîte visée par une action : `ownSource` exige le même `tenantId` et une boîte non supprimée.
- Client `createAdminClient()` partout.

## Chargement des pages

### Tableau (`boites-ao/page.tsx`)

1. Filtres (`filtersFromSearchParams`) et nombre d'offres affichées (`nb`, `listSizeFromSearchParams`, par 50) lus dans
   l'adresse (`searchParamsOf` : première valeur d'une clé répétée).
2. En parallèle : document `tenants` et `loadAoView(tenantId, filters, size)` = boîtes de l'organisation
   (`listSources`), puis en parallèle les `size` premières offres filtrées avec leurs e-mails, détails et commentaires
   (`listAoOfferRowsRange`), les compteurs du haut (`aoOfferCounts`) et les 50 derniers e-mails des boîtes.
3. Abonnement sans droit (`canUseAoSourcing`) : bandeau `accessAlert` (« vos boîtes ne sont pas lues »).
   `inboxConfigured` = au moins une boîte active ; `mailboxIssues` = boîtes actives avec `lastError`.
4. Erreur de l'étape 2 : journalisée, tableau vide et bandeau `loadError`.
5. Suivi des offres publiées (`loadAoTracking`) lu à part : son échec n'affiche qu'un bandeau `trackingError`.
6. `AoOffersDashboard` reçoit les actions de la page, les chemins de l'espace recruteur (`paths`) et les textes
   (`copy`, « de votre organisation »).

### Page d'une offre (`[offerId]/page.tsx`)

1. Filtres et `nb` de la liste lus dans l'adresse ; `query` (`listToSearchParams`) les garde pour « Liste »,
   « Précédente » et « Suivante ».
2. En parallèle : `loadAoOfferRow(tenantId, offerId)` (contrôle `aoAccess`) et `loadAoNeighbours` (identifiants de la
   liste filtrée, 5 000 au plus, position de l'offre, voisines). Erreur : page avec un bandeau et « Retour à la liste ».
3. Offre absente ou d'une autre organisation : `notFound()`.
4. Suivi de la publication puis recruteur affecté (`listTenantRecruiters`, `getAoAssignee`) lus à part : un échec
   masque seulement le bloc concerné.
5. `AoOfferPage` avec `stickyTop = 68` (`RECRUITER_NAVBAR_HEIGHT`, hauteur de la barre fixe du site).

### Boîtes (`boites/page.tsx`) et statistiques (`statistiques/page.tsx`)

- Boîtes : document `tenants` et `listMailboxes(tenantId)` (boîtes non supprimées, en `MailboxView` : jamais le mot de
  passe, ni chiffré ni en clair) ; bandeau avec lien `/abonnement` sans droit. Pas de `try` : une erreur donne la page
  d'erreur par défaut de Next.js.
- Statistiques : `listAllAoOfferRows(tenantId, EMPTY_AO_FILTERS)`, c'est-à-dire **toutes** les offres de l'organisation
  (5 000 au plus), pas celles des filtres de la liste ; erreur : `loadError`. `dynamic = 'force-dynamic'`.
- Ni l'une ni l'autre n'ont de `loading.tsx` : le plus proche est `boites-ao/loading.tsx` (`AoListSkeleton`).

## Logique et algorithmes

### Droit à la lecture des boîtes (`canUseAoSourcing`)

Vrai pour la plateforme (`tenantId` « admin ») ou un abonnement `active` / `trialing` : « L'IA est à nos frais : seules
les organisations abonnées (et la plateforme) ont leurs boîtes lues » (`tenancy.ts`). Côté recruteur, il est exigé par :
« Synchroniser maintenant » (route `sync`), « Réessayer », la rédaction de la version publiée par l'IA et la recherche
de candidats par l'IA. Il n'est **pas** vérifié pour : lire, commenter, ignorer, supprimer, exporter, ouvrir les
originaux, publier, affecter, « Tout arrêter » (« arrêter ne coûte rien ») et gérer les boîtes.

### Quotas quotidiens des recruteurs

Même schéma pour « Réessayer » (`retrySlot`), la rédaction par l'IA (`rewriteSlot`) et la recherche de candidats
(`sourcingSlot`), dans `boites-ao/actions.ts` :

1. abonnement (rédaction et recherche ; « Réessayer » l'a vérifié avant), puis adresse e-mail vérifiée ;
2. une place sur le compteur de l'organisation (`takeDailySlotId(<compteur>Org, tenantId)`) ;
3. une place sur le compteur de toutes les organisations (clé `'platform'`) ; refus : la place de l'organisation est
   rendue (`releaseDailySlot`) et un avertissement journalisé.

La place est prise juste avant l'appel coûteux et n'est pas rendue s'il échoue (« l'IA a pu être facturée »). Jour =
date UTC (`counterIdFor`). Places atomiques : une rafale parallèle ne dépasse pas la limite (AGENTS.md, `takeDailySlot`).

| Opération | Organisation | Toutes | Compteurs | Refus |
|---|---|---|---|---|
| « Réessayer » un e-mail | 30 | 300 | `aoRetryOrg` / `aoRetryAll` | erreur affichée |
| Version publiée rédigée par l'IA | 30 | 300 | `aoRewriteOrg` / `aoRewriteAll` | version des règles automatiques, avec la raison |
| « Trouver des candidats » / « Recalculer » | 20 | 300 | `aoSourcingOrg` / `aoSourcingAll` | erreur affichée ; lire le dernier résultat reste gratuit |

### Boîtes de réception

- Saisie (`parseMailboxInput`, zod, testé) : serveur en minuscules (3 à 253 caractères), identifiant (3 à 320),
  mot de passe (500 au plus), dossier (`INBOX` par défaut), « nos domaines » séparés par virgules / espaces / `;`
  (10 au plus, forme `acme.fr`) ou, à défaut, le domaine de l'identifiant s'il contient `@`.
- Test et enregistrement exigent l'adresse e-mail vérifiée du recruteur (« un compte jetable ne doit pas pouvoir se
  servir du test de connexion contre des boîtes de tiers »).
- Mot de passe (`passwordProblem`, testé) : obligatoire à la création et dès que le serveur ou l'identifiant change ;
  sinon le mot de passe enregistré est réutilisé, déchiffré pour ce serveur et cet identifiant seulement
  (`mailboxSecretContext`).
- « Tester la connexion » (`testMailbox`) : trois places prises sans être rendues — 30 tests par jour pour
  l'organisation, 10 pour la boîte visée (serveur + identifiant, toutes organisations), 500 pour la plateforme —, puis
  serveur vérifié (`resolveImapHost`, adresses publiques seulement), connexion et dossier ouvert en lecture seule
  (`withAoInbox`, 30 s), nombre de messages renvoyé ; erreur traduite (`mailboxErrorMessage`).
- « Enregistrer » (`saveMailbox`) : 10 boîtes au plus (`MAX_MAILBOXES`), refus d'un doublon (même serveur, identifiant
  et dossier), **refait le test** et n'enregistre que s'il réussit ; mot de passe chiffré (`sealMailboxPassword`) lié à
  l'identifiant du document.
- « Supprimer » (`deleteMailbox`) : boîte désactivée, mot de passe remplacé par `ERASED_PASSWORD`, document gardé pour
  que ses offres restent rattachées à l'organisation.

### Offres échues (`expiredToReview`, route `echues`)

Parmi les offres « à valider » (5 000 au plus), celles dont la date limite est passée (`isPastDeadline`, année d'une
date sans année = celle de la réception) ; une offre n'est proposée à la suppression que si son e-mail n'a apporté
qu'une offre (offres et doublons), qu'elle n'a été reçue qu'une fois et que sa date limite ne cite qu'une date ; sinon
elle est comptée à part (`uncertain`), à vérifier dans l'e-mail. Testé dans `bulk-delete.test.ts`.

### Publication par un recruteur

`publishRecruiterAoOffer` → `publishAoOfferOf(tenantId, id, input, jobTenantId = tenantId, paths, publisher = user)` :

1. `parsePublishInput` : `reviewed: true` obligatoire (case « J'ai relu »), `anonymized: false` seulement pour
   « Publier sans anonymiser ».
2. Offre de l'organisation, pas encore publiée.
3. Version anonymisée repassée par `toPublicOffer` (noms à masquer, `maskTerms`), ou `rawPublicOffer`.
4. `ao_offers` passée `published` avec `jobId = ao<id>` (identifiant fixe : une seconde publication échoue au lieu de
   créer une seconde offre), puis `createJob` dans l'organisation, auteur et recruteur affecté par `jobOwnership`
   (recruteur affecté de l'AO s'il y en a un, sinon celui qui publie). Création en échec et offre absente : l'AO repasse
   `to_review`.
5. Après la réponse (`after()`) : `tryAutoPublishJob` (diffusion sur les réseaux) et `tryAutoSourceCandidates`
   (sourcing et e-mails aux candidats), d'où `maxDuration = 300` sur la page du tableau et celle d'une offre.
6. `revalidatePath` du tableau, de `/recruiter/annonces` et de `/recruiter/dashboard`.

### Sourcing d'une offre (`recruiterAoOfferSourcing`)

`vivierOwner = user.$id` : seuls les CV de vivier **du recruteur connecté** sont montrés (« un vivier est personnel »).
Offre publiée : « Recalculer » appelle `runPoolMatching(jobId, …, 'all')` après la place de quota, puis les meilleurs
résultats de `getJobMatches`. Offre non publiée : dernier résultat enregistré dans `ao_offer_details.sourcing`, ou
calcul (`matchCandidatesForOffer`) puis enregistrement. Dans les deux cas, 5 candidats notés 65 ou plus au plus
(`bestMatches`, `sourcing-rules.ts`).

## Actions serveur

`boites-ao/actions.ts` (chaque action : `recruiter()`, sinon « Session expirée ») :

| Action | Cœur | Contrôles propres à l'espace recruteur | Écritures et effets |
|---|---|---|---|
| `retryRecruiterAoEmail(id)` | `retryAoEmailOf` | abonnement ; e-mail de l'organisation en erreur ; `retrySlot` | essais remis à zéro (`manualRetryPatch`), traitement immédiat (`syncAoEmail`, 150 s), IA |
| `previewRecruiterAoPublication(id, mode)` | `previewAoPublicationOf` | `mode` autre que `raw` = anonymisée ; `rewriteSlot` avant l'IA (pas pour `raw`) | appel d'IA (60 s) ; aucune écriture hors places de quota |
| `publishRecruiterAoOffer(id, input)` | `publishAoOfferOf` | `parsePublishInput` | `ao_offers`, `jobs`, diffusion et sourcing en arrière-plan |
| `setRecruiterAoOfferStatus(id, status)` | `setAoOfferStatusOf` | `to_review` ou `ignored` ; offre non publiée | `ao_offers.status` |
| `stopRecruiterAoPublicationTasks(id)` | `stopAoPublicationTasksOf` | offre publiée | marqueur d'arrêt dans `ao_sync_state`, diffusion en file arrêtée |
| `recruiterAoOfferSourcing(id, recompute)` | `aoOfferSourcingOf` | `sourcingSlot` avant l'IA | `job_matches` (offre publiée) ou `ao_offer_details.sourcing` |
| `listRecruiterAoOfferComments(offerId)` | `listAoOfferCommentsOf` | offre de l'organisation | lecture |
| `addRecruiterAoOfferComment(offerId, body)` | `addAoOfferCommentOf` | `parseCommentBody` | `ao_comments` (auteur = compte Auth) |
| `deleteRecruiterAoOfferComment(commentId)` | `deleteAoOfferCommentOf` | commentaire de l'organisation, auteur seulement | suppression |
| `deleteRecruiterAoOffer(id)` | `deleteAoOfferOf` | offre non publiée | commentaires, offre et détails supprimés ; l'e-mail reste (l'offre n'est pas recréée) |
| `deleteRecruiterAoOffers(ids)` | `deleteAoOffersOf` | `parseBulkDeleteIds` (10 par envoi, `BULK_DELETE_MAX`) | comme la précédente, offre par offre |
| `assignRecruiterAoOffer(id, recruiterId)` | `assignAoOfferOf` | chaînes, `recruiterId` ≤ 36 ; `checkAssignee` (recruteur de l'organisation, vide = personne) | `ao_offer_details.assigneeId`, `jobs.recruiterId` si publiée, e-mail au recruteur affecté |

`boites/actions.ts` (chaque action : `requireRecruiter()`, identifiant de boîte `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$`,
erreur inattendue journalisée et remplacée par un message générique) :

| Action | Contrôles | Écritures |
|---|---|---|
| `testMailboxAction(raw, id)` | adresse vérifiée ; `parseMailboxInput` ; quotas de test | aucune (places de quota) |
| `saveMailboxAction(raw, id)` | adresse vérifiée ; `parseMailboxInput` ; 10 boîtes ; doublon ; test réussi | `ao_sources` ; `revalidatePath` |
| `setMailboxEnabledAction(id, enabled)` | boîte de l'organisation ; booléen | `ao_sources.enabled` |
| `deleteMailboxAction(id)` | boîte de l'organisation | `enabled: false`, `ERASED_PASSWORD` |

Routes (`src/app/api/recruiter/ao/`) : `sync` (POST, abonnement, `Sec-Fetch-Site` absent ou `same-origin`, 300 s ;
un passage de 2 e-mails au plus et 120 s, enchaîné par `AoSyncProvider`), `liste` (GET, 50 offres après `depuis`, avec
leur suivi), `export` (GET, Excel des offres filtrées, vraies données), `echues` (GET, 60 s), `original/[emailId]` (GET,
60 s : `.eml`, pièce jointe `?attachment=`, version affichable `?vue=html` ou en fichier `?format=html`, relus dans la
boîte). Ce sont des routes et non des Server Actions : le navigateur exécute les Server Actions une par une
(commentaires de `http.ts`).

## Erreurs et cas limites

- Abonnement inactif : les offres déjà reçues restent visibles et gérables ; « Synchroniser » répond une erreur
  (statut 200) ; bandeau sur le tableau et la page des boîtes.
- Offre, e-mail, commentaire ou boîte d'une autre organisation : « introuvable », jamais « interdit ».
- Une offre publiée ne se supprime pas et ne change pas de statut ici (« retirez d'abord l'offre publique »).
- Une Server Action ne s'interrompt pas : « Arrêter » côté navigateur ignore la réponse, le serveur finit la demande et
  consomme le quota (AGENTS.md, « Page d'une offre »).
- Liste, export, statistiques et voisines : 5 000 offres au plus (`AO_MAX_LISTED`), les plus récentes.

## Tests

Dans `src/lib/ao/` : `access.test.ts` (isolation), `mailboxes.test.ts` (`mailbox-input`, `imap-host`, `imap-errors`),
`sourcing-access.test.ts`, `bulk-delete.test.ts` (dont `expiredToReview`), `offer-index.test.ts`, `comment-input.test.ts`,
`stats.test.ts`, `tracking.test.ts`, `sync-loop.test.ts`, `publication-copy.test.ts`, `sources.test.ts` (dont
`tenancy`), `ao.test.ts` (dont `filters`, `attempts`, `publication-input`, `anonymize`). Aussi
[recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) et [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts).
Aucun test des actions de ce dossier ni de `mailboxes.ts` (Appwrite et IMAP). Commandes : `npm test` ;
`node --import tsx --test src/lib/ao/access.test.ts`.

## Modifier cette page

- « Toute nouvelle action du tableau va dans le cœur, avec sa vérification dans les deux fichiers d'actions »
  (AGENTS.md) : `offer-actions.ts`, `src/app/admin/candidats/actions.ts` et `boites-ao/actions.ts`, plus son type dans
  `AoDashboardActions` (`dashboard-types.ts`).
- Une opération coûteuse ouverte aux recruteurs prend un quota sur le modèle de `retrySlot` ; un nouveau compteur
  reçoit une lettre libre dans `COUNTER_PREFIX` (`tenancy.ts`).
- Chargement : `AoListSkeleton` et `AoOfferSkeleton` (`page-skeletons.tsx`) suivent les mises en page des composants AO
  partagés avec l'admin.
- Noms de « ← Retour » : `PAGE_LABELS` de [recruiter-trail.ts](../../../lib/recruiter-trail.ts) (« Boîtes AO »,
  « Statistiques AO » avant « Appel d'offres », la sous-page fixe d'abord).
- `maxDuration = 300` est nécessaire sur toute page qui lance une publication (AGENTS.md, « Publication sur les
  réseaux »).
- Contenu d'aide de l'assistant : lignes `/recruiter/parametres/boites-ao` de
  [knowledge.ts](../../../lib/assistant/knowledge.ts).
