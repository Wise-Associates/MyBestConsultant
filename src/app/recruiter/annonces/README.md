# Suivi des annonces — `/recruiter/annonces` et `/recruiter/annonces/[jobId]`

Vue d'ensemble des offres de l'organisation du recruteur et de leur avancement (candidatures par phase, entretiens IA,
score IA moyen, acceptés), avec export CSV et impression en PDF ; chaque offre a un « Rapport » imprimable
(`/recruiter/annonces/<offre>`), pensé pour être transmis à la hiérarchie ou au client (commentaire de `[jobId]/page.tsx`).
On y arrive par « Suivi & rapports » dans l'en-tête de « Mes offres » du tableau de bord (`jobs-list-client.tsx`) ; la
page n'a pas de rubrique propre dans le sous-menu, elle garde « Tableau de bord » en surbrillance (`recruiter-nav.ts`).
Décisions : aucun ADR. Règles produit : AGENTS.md, section « Design System », points « Recruiter sub-menu » et
« « Retour » links » (filtres de la liste dans l'adresse).

## Fichiers

```
page.tsx                  liste (serveur) : session, lecture par data.ts, mise en forme AnnoncesData
data.ts                   loadTenantOverview : offres, candidatures, phases, entretiens, correspondances, CV de vivier, noms
annonces-client.tsx       liste (client) : indicateurs, recherche / statut / tri / page dans l'adresse, CSV, impression
[jobId]/page.tsx          rapport d'une annonce (serveur) : indicateurs, répartition par phase, tableau des candidats
[jobId]/print-button.tsx  bouton « Exporter en PDF » (impression du navigateur)
```

Code partagé :

- [annonces-filters.ts](../../../lib/annonces-filters.ts) — vue de la liste ↔ adresse (`annoncesViewFromSearchParams`, `withAnnoncesView`), testé.
- [url-list-state.ts](../../../lib/url-list-state.ts) — reprise d'une adresse changée ailleurs sans reprendre les écritures de la liste (`noteListWrite`, `syncFromUrl`), testé.
- [funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) — `resolveStatus`, `withOrphanStages`.
- [jobs.ts](../../../lib/appwrite/jobs.ts) — `getJobsByTenant`, `getApplicationsByTenant`, `getJobById`.
- [funnel.ts](../../../lib/appwrite/funnel.ts) — `getFunnelStages`.
- [back-link.tsx](../../../components/recruiter/back-link.tsx) — `BackLink` du rapport (`fallbackHref="/recruiter/annonces"`).

## Accès et périmètre des données

- Le layout [`src/app/recruiter/layout.tsx`](../layout.tsx) redirige vers `/login` sans session ou hors rôle
  `recruiter` ; chaque page refait le contrôle (`getCurrentUser`, puis `redirect('/login')` si
  `!user || user.role !== 'recruiter' || !user.tenantId`).
- Toutes les lectures passent par `createAdminClient()` (clé API serveur) : le périmètre vient des requêtes, toutes
  filtrées sur `user.tenantId`.
  - Offres : `getJobsByTenant` = offres de l'organisation **et** offres partagées de la plateforme (`tenantId ''`),
    dédoublonnées, triées par date de création décroissante.
  - Candidatures : `getApplicationsByTenant` = candidatures portant le `tenantId` de l'organisation (sur une offre de la
    plateforme, seules celles de l'organisation).
  - `interviews`, `job_matches`, `vivier_cvs` : `Query.equal('tenantId', …)` ; pour `vivier_cvs`, seulement les CV des
    viviers d'offres (`Query.isNotNull('jobId')`, le vivier général « remplirait la limite », commentaire de `data.ts`).
  - Noms : documents `users` des `candidateId` des candidatures.
- Rapport : `getJobById(jobId)`, puis `notFound()` si l'offre n'existe pas ou si `job.tenantId !== user.tenantId`.

## Chargement de la page

### Liste (`page.tsx`)

1. Contrôle de la session (ci-dessus).
2. `loadTenantOverview(tenantId)` (`data.ts`) lit en parallèle (`Promise.all`) : `getJobsByTenant`,
   `getApplicationsByTenant` (toutes les pages, `listAllDocuments`), `getFunnelStages`, puis `interviews`, `job_matches`
   et `vivier_cvs` par la fonction locale `listAll` : **une seule requête de 500 documents au plus**, liste vide en cas
   d'erreur (sans journal).
3. Ensuite, noms des candidats : identifiants uniques par lots de 100 (`Query.equal('$id', …)`), en parallèle ; nom =
   « prénom nom », sinon l'adresse e-mail ; « Candidat » si le profil n'est pas lu.
4. `page.tsx` construit `AnnoncesData` (offres, phases, candidatures avec leur statut brut et `aiScore`, entretiens
   `{appId, status}`, `matchCountByJob`, `generatedAt` = heure du serveur) et le passe à `AnnoncesClient`.
5. Pas de `loading.tsx` dans ce dossier : c'est celui de l'espace recruteur ([`../loading.tsx`](../loading.tsx),
   `SectionPageSkeleton`) qui s'affiche.
6. Une exception de `getJobsByTenant`, `getApplicationsByTenant` ou `getFunnelStages` n'est pas rattrapée ; aucun
   `error.tsx` n'existe dans `src/app` : page d'erreur par défaut de Next.js.

`getFunnelStages` crée les phases du pipeline par défaut à la première lecture d'une organisation qui n'en a pas
(`getDefaultStages`) : cette page peut donc écrire dans `funnel_stages`.

### Rapport (`[jobId]/page.tsx`)

1. Contrôle de la session, lecture de l'offre et contrôle de l'organisation (ci-dessus).
2. `loadTenantOverview(tenantId)` : **toute l'organisation** est relue comme pour la liste, puis réduite à l'offre :
   candidatures de `jobId`, statut passé par `resolveStatus`, tri par score décroissant (sans score en dernier) puis
   date décroissante ; phases complétées par `withOrphanStages`.
3. Entretiens relus par candidature (`Query.equal('applicationId', …)` par lots de 100, `orderAsc('$createdAt')`,
   500 au plus par lot) : pour chaque candidature, la dernière session créée (statut, `analysis.overallScore`,
   `analysis.recommendation` ; JSON illisible ignoré) ; tous les statuts sont gardés pour le compte. Lecture en échec :
   colonne « Entretien IA » vide.
4. Rendu serveur complet (pas de composant client hors `PrintButton`).

## Logique et algorithmes

### État d'une annonce

`archived` si `!isActive`, sinon `expired` si `expiresAt` est antérieur à `generatedAt`, sinon `active`
(`annonces-client.tsx`, `rows`). Filtre « Actives » = `active` ; « Archivées » = tout ce qui n'est pas `active`
(désactivées **et** expirées) ; « Toutes ». Le rapport calcule le même libellé (Archivée / Expirée / Active) avec
l'heure du serveur.

### Phase d'une candidature

Les phases viennent de `getFunnelStages` : celles du pipeline par défaut, puis les phases des autres pipelines dont le
`slug` n'existe pas déjà. Une seule liste pour toutes les offres, y compris celles qui suivent un pipeline personnalisé.

- `resolveStatus(stages, status)` : statut gardé s'il est le `slug` d'une phase ; sinon la première phase dont
  `autoAction` vaut ce statut ou, pour un ancien statut connu (`LEGACY` : `pending`, `screening`, `interview`,
  `accepted`, `on_hold`, `rejected`), dont le libellé est celui de l'ancien statut (sans casse) ; sinon le statut brut.
- `withOrphanStages(stages, statuses)` : phases triées par `order`, puis une phase « orpheline » par statut inconnu
  (libellé de `LEGACY` ou slug rendu lisible, couleur de `LEGACY` ou `#9ca3af`) : une candidature dont la phase a été
  supprimée reste comptée et affichée.

### Indicateurs d'une annonce

Calculés dans le navigateur (`rows`, `annonces-client.tsx`) et, pour le rapport, sur le serveur avec les mêmes
définitions :

| Indicateur | Définition |
|---|---|
| Candidatures | candidatures de l'offre ; « dernière le » = date de la plus récente |
| « à trier » (`todo`) | candidatures dans la première phase (plus petit `order` des phases lues, donc la première du pipeline par défaut ; `pending` s'il n'y en a aucune) |
| Barre d'avancement | une part par phase non vide, largeur = nombre / total |
| Matching IA | documents `job_matches` de l'offre (quel que soit le score) + CV du vivier de l'offre avec un `matchScore` ; les correspondances du vivier général ne sont pas comptées |
| Entretiens IA | sessions terminées / sessions envoyées des candidatures de l'offre ; terminée = statut `completed` ou `analysed` (`DONE_INTERVIEW`, `DONE`) |
| Score IA moyen | moyenne arrondie des `aiScore` non vides ; couleur ≥ 75 vert, ≥ 55 orange, sinon rouge (`scoreColor`) |
| Acceptés | candidatures au statut `accepted` ; pourcentage du total |

La bande du haut (`totals`) additionne ces valeurs sur **toutes** les annonces, pas sur les annonces filtrées.

### Recherche, statut, tri, page et adresse

- `AnnoncesView` = `{ q, status, sort, page }`, par défaut `{ '', 'all', 'recent', 1 }` (`DEFAULT_ANNONCES_VIEW`).
  `annoncesViewFromSearchParams` remplace toute valeur inconnue par sa valeur par défaut, ne garde qu'une page entière
  supérieure à 1 et coupe la recherche à 200 caractères (`MAX_QUERY`). `withAnnoncesView` n'écrit que les valeurs
  différentes du défaut et garde les autres paramètres. Mêmes noms de paramètres que « Mes offres »
  (`recruiter-job-filters.ts`).
- Toute modification (`change`) revient à la page 1 sauf un changement de page, met à jour l'état, note l'écriture
  (`noteListWrite`) et réécrit l'adresse par `history.replaceState` (pas d'entrée d'historique, pas de rendu serveur).
- À chaque rendu, l'adresse normalisée est comparée à la dernière vue (`syncFromUrl`) : une adresse que la liste n'a
  pas écrite (onglet du sous-menu, lien vers la même page) remplace la vue affichée ; une écriture de la liste arrivée
  en retard pendant une frappe n'est pas reprise.
- Recherche : sous-chaîne, en minuscules, dans l'intitulé, le lieu ou le nom d'un candidat (pas de normalisation des
  accents).
- Tris (`by`) : `recent` (date de création de l'offre), `todo`, `candidates`, `score` (sans score en dernier), tous
  décroissants.
- Pagination : 5 annonces par page (`PAGE_SIZE`), page ramenée à la dernière si elle la dépasse ; toutes les annonces
  filtrées sont rendues, celles hors de la page masquées (`display: none`). Numéros affichés par `pageNumbers` :
  première, dernière, page courante et ses voisines, « … » entre deux trous.

### Export CSV et impression

- CSV (`exportCsv`) : toutes les annonces filtrées (pas seulement la page), une ligne par candidat (une annonce sans
  candidature ne donne aucune ligne) : Annonce, Statut annonce, Candidat, Étape, Score IA, Date de candidature ;
  séparateur `;`, valeurs entre guillemets, BOM UTF-8, fins de ligne CRLF, fichier `suivi-annonces-AAAA-MM-JJ.csv`.
- « Exporter en PDF » = `window.print()`. Le `<style>` `@media print` du composant masque `.no-print`, affiche
  `.print-only` (titre « Rapport de suivi des annonces », date, nombre d'annonces), affiche **toutes** les annonces
  filtrées (`.mbc-annonce`, la pagination est ignorée), déplie les listes de candidats (`.mbc-cand-list`) et rend la
  barre collante statique (`.mbc-sticky-bar`). Le rapport fait de même avec `PrintButton`.

### Rapport d'une annonce

- Indicateurs : Candidatures, Matching IA, Entretiens IA (sessions terminées / toutes les sessions), Score IA moyen,
  Acceptés (définitions du tableau ci-dessus).
- « Répartition par étape du funnel » : une barre par phase (orphelines comprises), largeur
  `max(n / effectif de la phase la plus remplie × 100, 8) %` quand `n > 0`, pourcentage `n / total`.
- Tableau : candidat (lien `/recruiter/candidates/<candidature>`) et `aiSummary` coupé à 180 caractères, phase,
  « Score CV » (`aiScore`), « Entretien IA » de la dernière session : `completed` / `analysed` → `overallScore/100` ou
  « Terminé », `in_progress` → « En cours », autre → « Envoyé », puis la recommandation (`hire` « Recommandé »,
  `consider` « À considérer », `reject` « Non recommandé », `INTERVIEW_RECO`).

## Actions serveur

Aucune : les deux pages ne font que lire (CSV et impression se font dans le navigateur). Seule écriture possible : les
phases par défaut créées par `getFunnelStages` (voir « Chargement »).

## Erreurs et cas limites

- Lectures plafonnées sans avertissement : `interviews`, `job_matches` et `vivier_cvs` à 500 documents pour toute
  l'organisation (liste) ; entretiens à 500 par lot de 100 candidatures (rapport). Au-delà, les chiffres sont
  sous-estimés ; une lecture en échec donne une liste vide, sans journal. Seules les offres et les candidatures sont
  lues en entier.
- Une offre partagée de la plateforme (`tenantId ''`) apparaît dans la liste, mais son « Rapport » répond 404 (contrôle
  `job.tenantId !== user.tenantId`).
- « expirée » est calculé à l'heure du rendu serveur (`generatedAt`) : il ne change pas sans rechargement.
- Statut inconnu des phases : phase orpheline (voir plus haut), jamais une candidature perdue.
- « Rapport PDF » d'un candidat : `/recruiter/candidates/<candidature>?print=1`, dans un nouvel onglet.

## Tests

- [annonces-filters.test.ts](../../../lib/annonces-filters.test.ts) : vue relue à l'identique, valeurs par défaut non
  écrites, valeur inconnue ou page impossible, recherche bornée.
- [url-list-state.test.ts](../../../lib/url-list-state.test.ts) : écritures de la liste non reprises, adresse venue
  d'ailleurs reprise.
- [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) et [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts) :
  noms « Suivi des annonces » / « Rapport de l'annonce », rubrique « Tableau de bord ».
- Aucun test des indicateurs (calculés dans les composants) ni de `funnel-stage-utils.ts`.

Commandes (`package.json`) : `npm test` (tous les `src/**/*.test.ts`), ou un fichier :
`node --import tsx --test src/lib/annonces-filters.test.ts`.

## Modifier cette page

- Nouveau filtre ou tri : `AnnoncesView`, `STATUSES` / `SORTS`, `withAnnoncesView` et leur test ; garder les noms de
  paramètres de « Mes offres ».
- Les définitions sont écrites deux fois, dans `annonces-client.tsx` et `[jobId]/page.tsx` : `CONTRACT`, `REMOTE`,
  `scoreColor`, sessions terminées, formule « Matching IA ». Les changer ensemble.
- Styles d'impression : `<style>` en bas de chaque composant, classes `no-print`, `print-only`, `mbc-annonce`,
  `mbc-cand-list`, `mbc-sticky-bar` ; la barre collante est à `top: 68` (hauteur de la barre fixe du site).
- Noms de page de « ← Retour » : `PAGE_LABELS` de [recruiter-trail.ts](../../../lib/recruiter-trail.ts) ; rubrique :
  `also` de « Tableau de bord » dans [recruiter-nav.ts](../../../lib/recruiter-nav.ts).
- Chargement : pas de `loading.tsx` propre ; en ajouter un (formes de `page-skeletons.tsx`) si la mise en page s'éloigne
  de `SectionPageSkeleton`.
- Contenu d'aide de l'assistant : ligne « Suivi des annonces » de
  [knowledge.ts](../../../lib/assistant/knowledge.ts) (AGENTS.md : à mettre à jour quand une page, un libellé ou une
  règle change).
