# MBC Search — `/recruiter/mbc-search`

Recherche de profils **hors de la base de la plateforme**, dans la base de personnes d'Apollo.io. Le recruteur décrit
le profil voulu (brief), l'IA en tire des critères qu'il corrige, Apollo renvoie des personnes que la page classe par un
score sur 100 avec ses raisons. Il peut ensuite révéler le profil complet (payant, crédits Apollo), enregistrer une
personne, l'ajouter à son vivier ou à celui d'une offre, et faire rédiger un message d'approche. On y arrive par la
rubrique « MBC Search » du sous-menu recruteur.
Décisions : [ADR 0018](../../../../docs/adr/0018-mbc-search-recherche-de-profils-apollo.md). Règles produit :
[AGENTS.md](../../../../AGENTS.md), section « MBC Search (recherche de profils via Apollo.io) » ; pour le vivier,
section « Vivier général des recruteurs (matching automatique) ».

## Fichiers

```
page.tsx               composant serveur : rôle vérifié, lectures facultatives (jauge, offres, historique, personnes enregistrées)
actions.ts             Server Actions : brief, recherche, révélation, personnes enregistrées, historique, approche
mbc-search-client.tsx  écran : accueil « Qui recherchez-vous ? », espace de travail en trois colonnes, état de la visite
mbc-profile-panel.tsx  panneau du profil choisi : score détaillé, coordonnées, vivier / offre, message d'approche
mbc-search-ui.tsx      petits composants (ErrorNote, Avatar, ChipField, Toggle) et types Reveal, SaveButton
```

Code partagé :

- [rules.ts](../../../lib/mbc-search/rules.ts) — règles pures, importées aussi par le navigateur : critères (zod),
  requête et réponses d'Apollo, score, lecture de la réponse de l'IA, texte de l'approche.
- [access.ts](../../../lib/mbc-search/access.ts) — `mbcSearchDenial` et constantes de quotas.
- [apollo.ts](../../../lib/mbc-search/apollo.ts) (`server-only`) — appels à Apollo et à l'IA (prompts).
- [history.ts](../../../lib/mbc-search/history.ts) / [history-store.ts](../../../lib/mbc-search/history-store.ts) —
  historique des recherches (`mbc_searches`).
- [reveals.ts](../../../lib/mbc-search/reveals.ts) / [reveal-store.ts](../../../lib/mbc-search/reveal-store.ts) —
  profils révélés gardés 90 jours (`mbc_reveals`) et « Dans votre vivier » (`vivier_cvs.apolloId`).
- [saved.ts](../../../lib/mbc-search/saved.ts) / [saved-store.ts](../../../lib/mbc-search/saved-store.ts) —
  personnes enregistrées (`mbc_saved_people`).
- [vivier/actions.ts](../vivier/actions.ts) — `addMbcProfileToVivier` (« Ajouter au vivier », « Associer à une offre »).
- [state.ts](../../../lib/ao/state.ts) (`takeDailySlotId`, `releaseDailySlot`, `countDailySlots`) et
  [tenancy.ts](../../../lib/ao/tenancy.ts) (`counterIdFor`, préfixes des compteurs) — quotas du jour.
- [offer-actions.ts](../../../lib/ao/offer-actions.ts) — `tenantSubscriptionStatus`.
- [mbc-search-purge/route.ts](../../api/cron/mbc-search-purge/route.ts) — purge quotidienne de `mbc_reveals`.
- [admin/users/actions.ts](../../admin/users/actions.ts) (`deleteUserAccount`) et [team.ts](../../../lib/team.ts)
  (`removeMember`) — suppression de l'historique et des personnes enregistrées avec le compte.

## Accès et périmètre des données

- **Page** : le layout [../layout.tsx](../layout.tsx) puis `page.tsx` redirigent vers `/login` sans session ou si le
  rôle n'est pas `recruiter`. La page s'affiche sans contrôle d'abonnement : ce sont les actions qui refusent.
- **Chaque Server Action vérifie elle-même** la session (`getCurrentUser`), le rôle `recruiter` et un `tenantId`,
  sinon « Session expirée… ». Les actions qui coûtent (IA ou Apollo) passent en plus par `mbcSearchDenial`
  ([access.ts](../../../lib/mbc-search/access.ts)) : abonnement `active` ou `trialing` de l'organisation
  (`canUseAoSourcing`, l'organisation plateforme `admin` étant toujours admise) et adresse e-mail vérifiée
  (`user.emailVerification`). Les actions de l'historique et « Retirer » ne demandent que la session, le rôle,
  l'organisation et la collection configurée.
- **Périmètre** :

| Donnée | Collection | Clé de périmètre | Vue par |
|---|---|---|---|
| Historique des recherches | `mbc_searches` | `userId` = compte Auth (`user.userId`) | le recruteur seul |
| Profils révélés | `mbc_reveals` | `tenantId` | toute l'organisation (crédit payé une fois) |
| Personnes enregistrées | `mbc_saved_people` | `userId` = compte Auth | le recruteur seul |
| « Dans votre vivier » | `vivier_cvs` | `tenantId` + `recruiterId` = profil (`user.$id`) | le recruteur seul |
| Jauge et quotas | `ao_sync_state` | compteur de l'organisation / de la plateforme | — |

- Les identifiants de documents sont des empreintes SHA-256 de la clé de périmètre et de la personne ou des critères
  (`searchDocId`, `revealDocId`, `savedPersonDocId`) ; à la lecture, le code revérifie en plus `doc.userId`
  (`ownDoc`, `savedPerson`, `deleteSavedPerson`). Le document d'un autre est traité comme « introuvable ».
- Tout accès Appwrite passe par `createAdminClient()` (clé API serveur) ; les trois collections `mbc_*` n'ont aucune
  permission client ([appwrite.config.json](../../../../appwrite.config.json)). Le client de session ne sert qu'à
  `getCurrentUser`. `APOLLO_API_KEY` n'est lue que côté serveur ([apollo.ts](../../../lib/mbc-search/apollo.ts)).

## Chargement de la page

1. `getCurrentUser()` ; pas de recruteur → `redirect('/login')`.
2. Quatre lectures en parallèle (`Promise.all`), toutes **facultatives** : chacune en échec est journalisée
   (`[mbc-search] …`) et remplacée par `null`.
   - `countDailySlots('mbcRevealOrg', tenantId, now)` : profils complets déjà révélés aujourd'hui par l'organisation.
   - `getOpenJobsOfTenant(tenantId)` ([jobs.ts](../../../lib/appwrite/jobs.ts)) : offres actives non expirées de
     l'organisation (100 plus récentes, sans les offres de la plateforme), pour « Associer à une offre ».
   - `listMbcSearches(user.userId)` si `isMbcHistoryConfigured()`.
   - `listSavedPeople(user.userId)` si `isMbcSavedStoreConfigured()`.
   Sans `tenantId`, les deux premières valent `null` sans lecture.
3. Props de `MbcSearchClient` : `configured` (`isApolloConfigured()`), `revealUsage`
   (`{ used, limit: MBC_REVEAL_DAILY_LIMITS.perOrganisation }` ou `null`), `jobs` (`{ id, title }`, « Offre sans
   intitulé » à défaut), `history`, `savedPeople`. Côté client, `null` signifie « indisponible » et donne un message à
   la place de la liste ; la recherche reste possible.
4. Aucun appel à Apollo au chargement. Pas de `loading.tsx` propre : celui de l'espace,
   [../loading.tsx](../loading.tsx) (`SectionPageSkeleton`).

## Logique et algorithmes

### Parcours et état du client

`MbcSearchClient` a deux phases : `compose` (brief, exemples fictifs `EXAMPLES`, « Vos recherches », « Ou renseignez
les critères vous-même ») et `workspace` (critères · profils · profil choisi). Trois étapes affichées (`STEPS` :
`brief`, `search`, `rank`), chacune `todo | run | done | error | skip`.

- « Lancer la recherche » (`launchFromBrief`) : `analyseMbcBrief` puis `runSearch(criteria, 1)`.
- « Relancer », « Précédente » / « Suivante », un clic sur une recherche de l'historique (`openEntry`, seulement si
  Apollo est configuré et les critères valides) : `runSearch` directement.
- État gardé **pour la visite seulement** : résultats de la page, `reveals` (identifiant Apollo → `loading` / `done`
  / `missing`), `seen` (profils vus, pour l'onglet « Révélés »), `added` (vivier général `general` ou offres).
  `reveals` est pré-rempli avec les personnes enregistrées : elles s'affichent révélées sans appel.
- Une Server Action qui lève (réseau, déploiement) fait passer l'étape en cours en `error` avec « Le serveur ne répond
  pas… » (`failRunning`).

### Critères

`criteriaSchema` ([rules.ts](../../../lib/mbc-search/rules.ts)), revalidé par chaque action : `titles`, `locations`,
`skills` (8 éléments de 80 caractères au plus, `CRITERIA_LIMITS`), `seniorities` (identifiants Apollo de
`SENIORITIES`), facultatifs `requiredSkills` (★), `sectors`, `emailOnly`, `recentOnly`. Brief : 4 000 caractères.

- `criteriaProblem` : au moins un intitulé ou une compétence, sinon refus avant Apollo.
- `requiredSkillsOf` : compétences ★ encore présentes dans `skills` (comparaison sans casse ni accents) ; une
  compétence retirée cesse d'être obligatoire.

### Lecture du brief par l'IA (`analyseMbcBrief`)

1. `briefSchema` : 20 à 4 000 caractères.
2. `searchSlot()` : contrôles d'accès puis une place de quota de recherche (voir « Quotas du jour »), **avant** l'IA ;
   un échec ensuite compte quand même.
3. `briefToCriteriaText` : `callLLM` module `matching` de Config IA (avec le repli habituel), `maxTokens` 600, délai
   30 s, consigne `BRIEF_SYSTEM_PROMPT` (objet JSON `titles` / `locations` / `seniorities` / `skills` / `sectors`,
   intitulés en anglais et en français, lieux « Ville, Pays », secteurs en anglais, consignes du brief ignorées).
4. `parseBriefCriteria` (fail closed) : texte entre la première `{` et la dernière `}`, `JSON.parse`, chaque liste
   réduite aux chaînes non vides, coupées à 80 caractères, sans doublon (sans casse ni accents), 8 au plus ;
   séniorités hors liste écartées ; `requiredSkills` toujours vide (c'est au recruteur de les marquer) ; `null` si
   `criteriaProblem`.

### Recherche Apollo (`searchMbcProfiles`)

1. Validation : `criteriaSchema`, `pageSchema` (1 à `MAX_PAGE` = 40), brief ≤ 4 000 ; `criteriaProblem` ;
   `searchSlot()` — **chaque page demandée prend une place**, pas seulement la première.
2. `searchApolloPeople` → `POST https://api.apollo.io/api/v1/mixed_people/api_search` (sans crédit, ni e-mail ni
   téléphone, nom de famille masqué), corps `toApolloQuery` :
   - `person_titles`, `person_locations`, `person_seniorities`, `include_similar_titles: true`, `page`,
     `per_page: PAGE_SIZE` (25) ;
   - `q_keywords` = `apolloKeywords` : les compétences ★ ; sans ★ et sans intitulé, toutes les compétences ; sinon
     rien (envoyer toutes les compétences écartait presque tous les profils) ; 200 caractères au plus ;
   - `q_organization_keyword_tags` = `sectors` s'il y en a ; `contact_email_status: ['verified', 'likely to engage',
     'unverified']` si `emailOnly`.
   - `recentOnly` n'est **pas** envoyé : c'est un filtre de l'onglet « Tous » dans le navigateur (`p.match.fresh`),
     le nombre de profils masqués est affiché.
3. `postApollo` : en-tête `x-api-key`, `cache: 'no-store'`, délai 15 s (`APOLLO_TIMEOUT_MS`). Erreurs traduites en
   `ApolloSearchError` : injoignable, 429, 401 / 403 (clé refusée), 402 (crédits épuisés), autre statut. Journal :
   statut ou nom de l'erreur seulement.
4. `parseApolloPeople` : réponse d'une autre forme → erreur ; personne illisible → seulement écartée. `hasPhone` vaut
   vrai seulement pour `true` ou « Yes » (Apollo écrit aussi « Maybe: … »).
5. `rankProfiles(profiles, criteria, new Date())` (voir « Score »).
6. En parallèle et facultatifs (`Promise.allSettled`, échec journalisé) : `storedReveals` (profils de la page déjà
   révélés par l'organisation → `revealed`, affichés révélés sans crédit) et `vivierTargetsOf(tenantId, user.$id, ids)`
   (personnes déjà dans un vivier du recruteur → `inVivier`, boutons d'ajout grisés, badge « Dans votre vivier »).
7. Page 1 seulement, si l'historique est configuré : `recordMbcSearch` → `entry` ; échec → `historyError`, la
   recherche est quand même renvoyée.

### Score (`scoreProfile`) et classement (`rankProfiles`)

Le score ne départage que sur ce qui est visible avant enrichissement (intitulé, employeur, indicateurs) ; Apollo a
déjà filtré lieu et séniorité. Poids `SCORE_WEIGHTS` : intitulé 55, compétences 25, joignable 10, récent 10.

```
words(s)   = s sans accents, en minuscules, découpé sur tout sauf [a-z0-9+#.], mots de 2 caractères ou plus
intitulé   : aucun intitulé demandé → 55 points (critère « any »)
             sinon ratio = max sur les intitulés demandés de (mots demandés présents dans words(profil.title)) / (mots demandés)
                   points = round(55 × ratio) ; match = full (ratio 1) | partial (> 0) | none
compétences: aucune demandée → 25 ; sinon trouvées = compétences dont le texte normalisé figure dans
             normalize(title + " " + company) ; points = round(25 × trouvées / demandées)
joignable  : hasEmail ou hasPhone → 10
récent     : isFresh(refreshedAt, now) : mis à jour il y a 180 jours au plus (FRESH_DAYS) → 10
score      = min(100, somme) ; une raison lisible par critère obtenu (reasons)
```

Exemple : intitulé demandé « Data Engineer », profil « Senior Data Engineer » → ratio 1 → 55 points, « Intitulé
conforme ». `rankProfiles` trie par score décroissant et garde l'ordre d'Apollo à score égal. `now` est injecté
(tests). À l'écran : `CriteriaPills` (Intitulé si demandé, 3 premières compétences, « E-mail » = `hasEmail`,
« Récent ») et, dans le panneau, une barre par critère (`points` / `SCORE_WEIGHTS`). Une personne enregistrée absente
des résultats est notée dans le navigateur par `scoreProfile(s.search, criteria, openedAt)`, avec la ligne de recherche
gardée à son enregistrement et l'heure d'ouverture de la page.

### Quotas du jour

| Compteur | Préfixe | Clé | Limite / jour (UTC) | Pris par |
|---|---|---|---|---|
| `mbcSearchOrg` | `k` | organisation | 60 | `analyseMbcBrief`, `searchMbcProfiles` (chaque page), `draftMbcOutreach` |
| `mbcSearchAll` | `z` | `platform` | 600 | idem |
| `mbcRevealOrg` | `j` | organisation | 100 | chaque profil demandé à Apollo (révélation, enregistrement) |
| `mbcRevealAll` | `l` | `platform` | 1 000 | idem |

Constantes : `MBC_SEARCH_DAILY_LIMITS`, `MBC_REVEAL_DAILY_LIMITS` ([access.ts](../../../lib/mbc-search/access.ts)) ;
préfixes : `COUNTER_PREFIX` ([tenancy.ts](../../../lib/ao/tenancy.ts)). `takeDailySlotId` crée un document par place
(`<counterIdFor>_<n>` dans `ao_sync_state`, `counterIdFor` = préfixe, empreinte de la clé, jour UTC) : la création
échoue en 409 si la place est prise, ce qui borne les rafales parallèles. Ordre : organisation, puis plateforme ; un
refus de la plateforme rend les places de l'organisation (`releaseDailySlot`). La jauge de l'en-tête lit
`countDailySlots` au chargement puis ajoute `charged` renvoyé par le serveur. Le navigateur grise « Révéler la
sélection » quand la jauge restante est inférieure à la sélection ; le serveur reste seul juge.

### Révélation d'un profil complet (`revealMbcProfiles` → `revealForRecruiter`)

1. `revealSchema` : 1 à `REVEAL_BATCH` (10, limite d'Apollo) identifiants `APOLLO_PERSON_ID` (24 caractères
   hexadécimaux), dédoublonnés. Session, rôle, organisation ; puis `mbcSearchDenial`.
2. `storedReveals(tenantId, ids, now)` : ceux déjà gardés pour l'organisation (`known`) ne sont pas redemandés.
   Lecture impossible : journalisée, tous sont redemandés (et payés).
3. Rien à demander → `{ profiles: known, charged: 0 }`.
4. Pour chaque profil à demander : une place `mbcRevealOrg` puis une place `mbcRevealAll` ; un refus rend toutes les
   places prises par cet appel et renvoie `MBC_REVEAL_QUOTA_MESSAGE`.
5. `revealApolloPeople` → `POST https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false`,
   corps `toRevealRequest` = `{ details: [{ id }] }` (identifiants seuls). **1 crédit Apollo par personne trouvée.**
6. `parseApolloMatches` : nom (ou prénom + nom), intitulé, accroche, employeur et son site, lieu (ville, région, pays
   sans répétition), LinkedIn, photo, e-mail professionnel et son statut, 8 expériences au plus (mois `AAAA-MM`).
   Liens : `http://` réécrit en `https://`, puis seulement `https://` sans espace ni guillemet (`httpsUrl`) ;
   e-mail gardé seulement s'il passe `PLAIN_EMAIL`. Une personne non trouvée est absente du résultat.
7. `saveReveals(tenantId, user.userId, fresh, now)` : un document `mbc_reveals` par personne (création, ou mise à jour
   sur 409). Collection non configurée ou écriture en échec : profils renvoyés quand même avec `notKept` (ils seraient à
   repayer à la prochaine recherche).
8. Retour `{ profiles: known + fresh, charged: nombre de profils demandés }` : un profil introuvable compte dans
   `charged` (sa place est prise).

Côté client (`reveal`) : les identifiants déjà présents dans `reveals` (en cours, révélés ou introuvables) ne sont pas
redemandés ; un profil absent de la réponse passe à `missing` (« Introuvable chez Apollo », plus sélectionnable).

### Profils révélés gardés 90 jours (`mbc_reveals`)

- `revealDocId` = `r` + SHA-256(`tenantId\napolloId`) sur 35 caractères : deux révélations simultanées visent le même
  document.
- `revealJson` borne chaque champ avant écriture (nom 200, intitulé 300, accroche 500, employeur 300, lieu 300, statut
  40, 8 expériences ; attribut `profileJson` de 20 000 caractères).
- `parseRevealDoc` : document ignoré si `revealedAt` est antérieur à `revealCutoff(now)` = now −
  `MBC_REVEAL_RETENTION_DAYS` (90) jours, puis `parseRevealedJson` revalide le profil (`revealedSchema` : liens https,
  `PLAIN_EMAIL`, identifiant égal à `doc.apolloId`).
- Purge : `GET /api/cron/mbc-search-purge` ([route.ts](../../api/cron/mbc-search-purge/route.ts)), `Authorization:
  Bearer $CRON_SECRET` (`isAuthorizedCronRequest`), `purgeExpiredReveals(now, Date.now() + 240 000)` : pages de 100
  documents `revealedAt < cutoff` supprimées jusqu'à une page incomplète ou l'échéance ; un passage interrompu reprend
  au suivant. Planifiée dans [vercel.json](../../../../vercel.json) (`0 4 * * *`).

### Personnes enregistrées (`saveMbcPerson`, `unsaveMbcPerson`, `mbc_saved_people`)

« Enregistrer » révèle la personne puis la garde, sans limite de durée, dans la liste personnelle du recruteur.

1. `searchRowSchema` ([saved.ts](../../../lib/mbc-search/saved.ts)) : la ligne de recherche affichée, champs bornés,
   caractères de contrôle remplacés (échappés en JSON, ils feraient dépasser l'attribut `searchJson` de 4 000).
2. Session, rôle, organisation ; collection non configurée → message « pas encore activé ».
3. Déjà enregistrée (`savedPerson`) → renvoyée, `charged: 0`.
4. `countSavedPeople >= SAVED_PEOPLE_MAX` (200) → refus **avant** de payer.
5. `revealForRecruiter(…, [id])` : même chemin, mêmes contrôles et même quota que « Révéler » ; aucun crédit si la
   personne est dans `mbc_reveals`. Introuvable chez Apollo → `missing`, rien n'est enregistré.
6. `saveSavedPerson` : document `savedPersonDocId` = `p` + SHA-256(`userId\napolloId`) (champs `userId`, `tenantId`,
   `apolloId`, `savedAt`, `searchJson`, `profileJson`) ; 409 → la version déjà gardée. Puis revérification après
   écriture : `users.get(userId)` en 404 (compte supprimé pendant la révélation) → document supprimé et erreur ;
   plus de 200 personnes (enregistrements simultanés) → document supprimé, `'full'`. Revérification impossible pour
   une autre raison : journalisée, document gardé.
7. Écriture en échec ou `'full'` : le profil payé est renvoyé (`revealed`) avec un message ; un nouvel essai le relit
   dans `mbc_reveals` sans crédit.

`unsaveMbcPerson` supprime le document s'il appartient au recruteur (absent : rien à faire) ; le profil reste dans
`mbc_reveals`. `listSavedPeople` lit les 210 plus récentes (`orderDesc('savedAt')`), écarte et journalise (par
identifiant de document) celles que `parseSavedPersonDoc` ne relit pas. Dans le navigateur, `saveButton` grise le
bouton quand la liste est indisponible, la personne introuvable chez Apollo, ou la jauge épuisée pour un profil non
révélé ; pendant l'enregistrement, la ligne passe en `loading` pour que « Révéler » ne la paie pas une seconde fois.

### Historique et recherches enregistrées (`mbc_searches`)

- `criteriaKey` : forme canonique des critères (listes sans casse ni accents, triées, sans doublon ; compétences ★
  limitées à celles de la liste ; `emailOnly`, `recentOnly`). `searchDocId` = `s` + SHA-256(`userId\ncriteriaKey`) :
  relancer la même recherche met à jour sa ligne.
- `recordMbcSearch` (page 1) : mise à jour de `brief`, `criteriaJson`, `total` (borné à 2 000 000 000), `lastRunAt` ;
  404 → création avec `userId`, `tenantId`, `name` = `savedSearchName` (premier intitulé ou première compétence,
  première ville avant la virgule), `pinned: false` ; 409 → mise à jour. Puis `historyOverflow` : les lignes non
  épinglées au-delà des 50 plus récentes (`SEARCH_HISTORY_MAX`) sont supprimées (échec journalisé seulement).
- `listMbcSearches` : 80 lignes au plus (50 + 20 + 10 de marge), plus récente d'abord ; `parseSearchDoc` revalide les
  critères avec `criteriaSchema` et écarte une ligne illisible.
- `pinMbcSearch` → `setMbcSearchPinned` : 20 recherches enregistrées au plus (`SAVED_SEARCHES_MAX`), nom
  `searchNameSchema` (1 à 80 caractères). `deleteMbcSearchEntry` → `deleteMbcSearch`.
- Écran : le marque-page de la colonne des critères n'est actif que pour la dernière recherche lancée **et tant que
  ses critères n'ont pas changé** (`currentEntry`, comparaison `JSON.stringify`). L'accueil montre les 5 premières
  (enregistrées d'abord). Rouvrir une recherche la relance et prend donc une place de quota.

### Ajout au vivier (`addMbcProfileToVivier`)

Dans [vivier/actions.ts](../vivier/actions.ts), appelée par le panneau pour un profil révélé (cible `general` ou une
offre de `jobs`).

1. `mbcProfileInput` : `jobId` (null = vivier général), profil borné (lien LinkedIn `https://`, e-mail
   `PLAIN_EMAIL`, `apolloId` facultatif). Le profil vient du navigateur, comme un CV que le recruteur importerait
   (commentaire de la fonction) ; il n'est pas relu dans `mbc_reveals`.
2. `requireVivierAccess` : rôle `recruiter` (ou `admin`), organisation ; pour une offre, `job.tenantId` = organisation
   de la session, sinon « Offre introuvable ».
3. Doublon refusé : même organisation, même `recruiterId` (`user.$id`), même vivier, même `candidateEmail` (ou même
   `candidateName` sans e-mail).
4. Création d'un document `vivier_cvs` **sans fichier** : `cvFileId` vide, `fileName` « Profil MBC Search (sans
   CV) », `cvProfileJson` construit depuis le parcours (`experienceSummary` = accroche · lieu · LinkedIn · « Profil
   trouvé avec MBC Search (sans CV). »), `apolloId`.
5. Matching IA comme un import (`matchProfile`) : vivier d'une offre → `matchVivierCvAgainstJob` ; vivier général →
   `compareWithNewOffers` (adresse vérifiée, quotas `vivierMatchOrg` / `vivierMatchAll`), dont le refus ou l'échec
   revient en `notice`.

### Message d'approche (`draftMbcOutreach`)

`outreachSchema` : brief, critères et personne (`outreachPersonSchema` : prénom, poste, employeur, 8 expériences
titre / employeur — ni e-mail ni lien). Besoin = brief, sinon critères (`outreachNeedText`) ; vide → refus. Puis
`searchSlot()` (même quota que les recherches), `outreachDraftText` (`callLLM` module `matching`, `maxTokens` 700,
30 s, `OUTREACH_SYSTEM_PROMPT` : français, vouvoiement, 90 à 140 mots, rien d'inventé, signature = prénom et nom du
recruteur ou « Le recruteur »), `cleanOutreachDraft` (bloc de code et guillemets retirés, 2 000 caractères). Rien n'est
envoyé ni enregistré : le recruteur copie le texte ou l'ouvre dans sa messagerie (`mailto:` avec le corps).

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `analyseMbcBrief` | `actions.ts` | brief → critères | `briefSchema` ; `searchSlot` (session, rôle, organisation, abonnement, e-mail vérifié, quota) | IA (module matching) ; places `mbcSearch*` |
| `searchMbcProfiles` | `actions.ts` | une page de profils classés | `criteriaSchema`, page 1–40, brief ≤ 4 000, `criteriaProblem` ; `searchSlot` | Apollo `mixed_people/api_search` ; lectures `mbc_reveals`, `vivier_cvs` ; écriture `mbc_searches` (page 1) |
| `pinMbcSearch` | `actions.ts` | enregistrer / retirer une recherche | `searchIdSchema`, `searchNameSchema` ; session, rôle, organisation, collection ; ligne du recruteur | mise à jour `mbc_searches` |
| `deleteMbcSearchEntry` | `actions.ts` | supprimer de l'historique | `searchIdSchema` ; idem | suppression `mbc_searches` |
| `revealMbcProfiles` | `actions.ts` | profils complets (10 au plus) | `revealSchema` ; session, rôle, organisation ; `mbcSearchDenial` ; quota par profil | Apollo `people/bulk_match` (crédits) ; places `mbcReveal*` ; écriture `mbc_reveals` |
| `saveMbcPerson` | `actions.ts` | révéler si besoin et enregistrer | `searchRowSchema` ; session, rôle, organisation ; collection ; 200 au plus ; puis comme `revealMbcProfiles` | idem + écriture `mbc_saved_people` |
| `unsaveMbcPerson` | `actions.ts` | retirer de la liste | `APOLLO_PERSON_ID` ; session, rôle, organisation ; document du recruteur | suppression `mbc_saved_people` |
| `draftMbcOutreach` | `actions.ts` | brouillon d'approche | `outreachSchema` ; besoin non vide ; `searchSlot` | IA (module matching) ; places `mbcSearch*` |
| `addMbcProfileToVivier` | [vivier/actions.ts](../vivier/actions.ts) | CV du vivier sans fichier | `mbcProfileInput` ; `requireVivierAccess` ; doublon | création `vivier_cvs` ; Matching IA (quotas `vivierMatch*`) ; `revalidateVivier` |

## Erreurs et cas limites

- **Sans `APOLLO_API_KEY`** : bandeau « clé Apollo manquante », boutons de recherche inactifs ; une action appelée
  quand même répond par `ApolloSearchError`.
- **Collections facultatives** : sans `APPWRITE_COLLECTION_MBC_SEARCHES`, « Historique indisponible » et recherche
  normale ; sans `APPWRITE_COLLECTION_MBC_SAVED_PEOPLE`, boutons « Enregistrer » grisés et onglet explicatif ; sans
  `APPWRITE_COLLECTION_MBC_REVEALS`, profils révélés affichés avec le message `notKept` (journal : « variable non
  définie »). Les fonctions de suppression avec le compte ignorent une collection absente (`collection_not_found`).
- **Quotas atteints** : `MBC_SEARCH_QUOTA_MESSAGE` / `MBC_REVEAL_QUOTA_MESSAGE` (organisation ou plateforme ; le
  plafond de la plateforme est aussi journalisé en `console.warn`).
- **Lectures annexes en échec** (profils déjà révélés, vivier) : la page de résultats s'affiche sans elles.
- **Personne illisible** chez Apollo : écartée de la page ; **document enregistré illisible** : absent de la liste mais
  compté dans les 200.
- **Photo** d'Apollo expirée ou bloquée : `Avatar` garde le cadre et les initiales (`onError`).
- **Journaux** : jamais le brief ni un profil ; statut HTTP, nom de l'erreur, identifiants de documents.

## Tests

- [rules.test.ts](../../../lib/mbc-search/rules.test.ts) : critères et requête Apollo (mots-clés, secteur, e-mail),
  lecture des réponses de recherche et d'enrichissement (liens et e-mails dangereux écartés), score et classement,
  lecture du brief, accès (`mbcSearchDenial`), approche, nom d'une recherche.
- [history.test.ts](../../../lib/mbc-search/history.test.ts) : `criteriaKey`, `searchDocId`, `parseSearchDoc`,
  `historyOverflow`.
- [reveals.test.ts](../../../lib/mbc-search/reveals.test.ts) : identifiant, conservation de 90 jours, relecture,
  taille de `revealJson`.
- [saved.test.ts](../../../lib/mbc-search/saved.test.ts) : identifiant, relecture, `searchRowSchema`.
- Non couverts par des tests : `actions.ts`, les modules `*-store.ts`, `apollo.ts`, l'écran.

Commande : `npm test` (tous les `src/**/*.test.ts`), ou
`node --import tsx --test "src/lib/mbc-search/*.test.ts"` pour ces seuls fichiers.

## Modifier cette page

- **Barème** : `SCORE_WEIGHTS` et `FRESH_DAYS` ([rules.ts](../../../lib/mbc-search/rules.ts)) servent au score et au
  panneau (`BREAKDOWN`) ; « 6 mois » est écrit en toutes lettres dans les raisons de `scoreProfile` et dans l'écran ;
  les tests de `rules.test.ts`, l'ADR 0018 et AGENTS.md citent les poids.
- **Nouveau critère** : `criteriaSchema` (facultatif, sinon les recherches déjà en base ne se relisent plus :
  `parseSearchDoc` les écarte), `EMPTY_CRITERIA`, `toApolloQuery`, `criteriaKey` (sinon deux recherches différentes
  partagent une ligne d'historique), `parseBriefCriteria` et `BRIEF_SYSTEM_PROMPT`, colonne des critères de
  `mbc-search-client.tsx`, éventuellement `outreachNeedText`. Attribut `criteriaJson` : 8 000 caractères.
- **Champs d'un profil révélé** (`MbcRevealed`) : `parseApolloMatches`, `revealedSchema` et `revealJson`
  ([reveals.ts](../../../lib/mbc-search/reveals.ts)), `mbcProfileInput` ([vivier/actions.ts](../vivier/actions.ts)) ;
  ligne de recherche (`MbcProfile`) : `searchRowSchema` et l'objet envoyé par `toggleSave`.
- **Quotas** : constantes de [access.ts](../../../lib/mbc-search/access.ts) ; un nouveau compteur prend un préfixe
  unique dans `COUNTER_PREFIX` ([tenancy.ts](../../../lib/ao/tenancy.ts)).
- **Durée de conservation** : `MBC_REVEAL_RETENTION_DAYS` règle la relecture et la purge ; « 90 jours » est aussi
  écrit en toutes lettres dans `mbc-search-client.tsx` et `mbc-profile-panel.tsx` (textes RGPD) et dans l'ADR.
- **Nouvelle donnée par recruteur** : la supprimer aussi dans `deleteUserAccount`
  ([admin/users/actions.ts](../../admin/users/actions.ts)) et `removeMember` ([team.ts](../../../lib/team.ts)), comme
  `deleteMbcSearchesForUser` et `deleteSavedPeopleForUser`.
- **Structure Appwrite** : collections dans [appwrite.config.json](../../../../appwrite.config.json) (`mbc_searches`
  8/16, `mbc_reveals` 5/16, `mbc_saved_people` 6/16, `vivier_cvs` 13/16), mise en place décrite dans AGENTS.md
  (`schema:push`, variables `APPWRITE_COLLECTION_MBC_*`).
- **Navigation** : rubrique `mbcsearch` de `RECRUITER_SECTIONS` ([recruiter-nav.ts](../../../lib/recruiter-nav.ts)) ;
  le lien « Retour » prend son libellé de la rubrique (pas d'entrée `PAGE_LABELS` dans
  [recruiter-trail.ts](../../../lib/recruiter-trail.ts)). Mise en page : une colonne, deux dès `lg` (critères,
  profils), trois dès `xl` (panneau collé à droite) ; en dessous de `xl`, le panneau s'ouvre en plein écran
  (`fixed inset-0`). Squelette de chargement : celui de l'espace (`SectionPageSkeleton`) ; une `loading.tsx` propre
  devrait suivre ces points de rupture.
- **Variables** : `APOLLO_API_KEY`, `APPWRITE_COLLECTION_MBC_SEARCHES`, `APPWRITE_COLLECTION_MBC_REVEALS`,
  `APPWRITE_COLLECTION_MBC_SAVED_PEOPLE`, `CRON_SECRET` (purge).
