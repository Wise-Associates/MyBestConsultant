# Espace recruteur — `/recruiter`

Pages des recruteurs d'une organisation (rôle `recruiter`) : offres et candidatures, pipelines, appels d'offres, vivier,
CV Thèque, MBC Search, équipe, entretiens et screening IA. Chaque rubrique a son `README.md` dans son dossier : ce que
lit la page, qui y a droit, les règles et algorithmes, les actions serveur, ce qu'il faut changer ensemble.
Ce fichier-ci décrit ce qui est commun à toutes les pages : layout, contrôle d'accès, navigation, chargement.
Règles produit : `AGENTS.md` (sections « Design System », « Tableau de bord du recruteur », « Vivier général des
recruteurs », « MBC Search », « AO Offers »…). Décisions : [docs/adr/](../../../docs/adr/).

## Pages et documentation

| Route | Page (sous-menu) | Documentation |
|---|---|---|
| `/recruiter/dashboard` | Tableau de bord : « Mes offres », KPI, aperçu d'une offre | [dashboard/README.md](dashboard/README.md) |
| `/recruiter/pipeline/[jobId]`, `…/matching` | Pipeline d'une offre et Matching IA | [pipeline/README.md](pipeline/README.md) |
| `/recruiter/candidates/[applicationId]` | Fiche candidat (export PDF) | [candidates/README.md](candidates/README.md) |
| `/recruiter/candidate-preview/[source]/[id]` | Profil d'un candidat hors candidature | [candidate-preview/README.md](candidate-preview/README.md) |
| `/recruiter/import` | Import d'offres | [import/README.md](import/README.md) |
| `/recruiter/annonces`, `…/[jobId]` | Suivi des annonces (« Suivi & rapports ») | [annonces/README.md](annonces/README.md) |
| `/recruiter/funnel` | Pipelines : processus, phases, statuts | [funnel/README.md](funnel/README.md) |
| `/recruiter/parametres/boites-ao/…` | Appels d'offres : liste, offre, boîtes, statistiques | [parametres/README.md](parametres/README.md) |
| `/recruiter/reporting` | Reporting | [reporting/README.md](reporting/README.md) |
| `/recruiter/vivier`, `…/[jobId]` | Mon vivier, vivier général, vivier d'une offre | [vivier/README.md](vivier/README.md) |
| `/recruiter/cvtheque` | CV Thèque | [cvtheque/README.md](cvtheque/README.md) |
| `/recruiter/mbc-search` | MBC Search (Apollo.io) | [mbc-search/README.md](mbc-search/README.md) |
| `/recruiter/equipe` | Mon équipe | [equipe/README.md](equipe/README.md) |
| `/recruiter/marque-employeur` | Marque employeur (depuis « Mon équipe ») | [marque-employeur/README.md](marque-employeur/README.md) |
| `/recruiter/interviews/…` | Entretiens IA : liste, création, questions, séance, salle | [interviews/README.md](interviews/README.md) |
| `/recruiter/screening/…` | Screening IA des CV (depuis « Entretiens IA ») | [screening/README.md](screening/README.md) |
| `/recruiter/support`, `…/[ticketId]` | Demandes au support (hors sous-menu) | [support/README.md](support/README.md) |

Moteur de **matching et de notation IA** (commun au screening, au Matching IA et aux viviers), expliqué fichier par
fichier et étape par étape : [docs/matching-et-notation-ia.md](../../../docs/matching-et-notation-ia.md).

Routes API propres à l'espace : [src/app/api/recruiter/](../api/recruiter/) (appels d'offres : liste, export,
offres échues, e-mail original, synchronisation ; export de CV au format cabinet ; modèles de CV). Chacune est décrite
dans le README de la page qui l'appelle.

## Fichiers communs

```
layout.tsx     composant serveur : contrôle de session et de rôle, barre du site, sous-menu, fournisseurs communs
loading.tsx    chargement par défaut d'une page : SectionPageSkeleton (les rubriques de mise en page différente ont le leur)
```

Code partagé par toutes les pages :

- [recruiter-nav.ts](../../lib/recruiter-nav.ts) : rubriques du sous-menu, leur ordre, et les pages qui gardent une
  rubrique en surbrillance (`RECRUITER_SECTIONS`, `recruiterSectionOf`) ; affiché par
  [recruiter-subnav.tsx](../../components/recruiter/recruiter-subnav.tsx).
- [recruiter-trail.ts](../../lib/recruiter-trail.ts) : règles des liens « ← Retour : <page d'origine> » (`recordVisit`,
  `backTarget`, `parseTrail`, `recruiterPageLabel`, `PAGE_LABELS`) ; composants `BackLink`, `RecruiterTrailRecorder`,
  `clearRecruiterTrail` dans [back-link.tsx](../../components/recruiter/back-link.tsx).
- [url-list-state.ts](../../lib/url-list-state.ts) : filtres de liste gardés dans l'adresse (`noteListWrite`,
  `syncFromUrl`).
- [page-skeletons.tsx](../../components/recruiter/page-skeletons.tsx) : formes grises de chargement de chaque rubrique,
  construites avec [skeleton.tsx](../../components/shared/skeleton.tsx).
- [identity-context.tsx](../../components/recruiter/identity-context.tsx) : nom du recruteur et de son entreprise
  (`useRecruiterIdentity`), pour pré-remplir les modèles de message (WhatsApp…).
- [job-tabs.tsx](../../components/recruiter/job-tabs.tsx) : onglets « Matching IA / Pipeline » et ligne de l'offre
  (`jobMetaLine`) du pipeline et du Matching IA sur grand écran.

## Accès

Trois niveaux, dont seul le dernier protège réellement les données :

1. **Middleware** ([src/middleware.ts](../../middleware.ts)) : sans cookie `mbc-session`, renvoie vers
   `/login?redirect=<page>` ; avec un cookie `mbc-role` différent de `recruiter`, vers le tableau de bord de ce rôle
   (`DASHBOARD_BY_ROLE`). Il ne vérifie pas la session : il évite seulement d'afficher une page pour rien.
2. **Layout** (`layout.tsx`) : `getCurrentUser()` ([auth.ts](../../lib/appwrite/auth.ts)) lit le compte Appwrite de la
   session et son profil ; pas de session ou rôle autre que `recruiter` → `redirect('/login')`. Cela protège
   l'**affichage** des pages, pas les actions serveur.
3. **Chaque page et chaque action serveur** refait son contrôle, parce qu'une action serveur est un point d'entrée POST
   public que le layout ne garde pas. Les fonctions de contrôle sont locales à chaque fichier `actions.ts`, avec des
   règles qui ne sont pas toutes identiques :

| Fonction | Fichier | Règle |
|---|---|---|
| `requireRecruiter` | `pipeline/[jobId]/actions.ts` (exportée, reprise par `email-actions.ts` et `matching-actions.ts` du même dossier), `funnel/actions.ts`, `parametres/boites-ao/boites/actions.ts` | rôle `recruiter` **et** organisation (`tenantId`) ; la version des boîtes AO exige aussi, avec `{ verified: true }`, une adresse e-mail vérifiée |
| `requireRecruiter` | `cvtheque/actions.ts` | rôle `recruiter` **ou `admin`**, sans exiger d'organisation (`getRecruiterCvExportVersions`, dans le même fichier, fait son propre contrôle : rôle `recruiter` et organisation) |
| `requireTeamMember` | `marque-employeur/actions.ts` | rôle `recruiter` et organisation |
| `requireJobAccess` | `pipeline/[jobId]/matching-actions.ts` | `requireRecruiter`, puis l'offre est celle de l'organisation ou une offre partagée par la plateforme (`tenantId` vide) : `recruiterCanOpenJob`, [job-ownership.ts](../../lib/job-ownership.ts) |
| `requireVivierAccess` | `vivier/actions.ts` | rôle `recruiter` ou `admin`, organisation ; pour le vivier d'une offre, l'offre appartient à l'organisation |
| `requireOwnedInterview` | `pipeline/[jobId]/interview-detail-actions.ts` | rôle `recruiter`, organisation, et l'entretien a le même `tenantId` |
| `requireOwner` | `equipe/actions.ts` | rôle `recruiter`, organisation, et propriétaire du compte (`TENANTS.recruiterId` = l'utilisateur) |

Le détail (quelle donnée est filtrée sur quel champ) est dans le README de chaque rubrique. Une nouvelle action serveur
reprend la fonction de contrôle de sa rubrique ; elle ne compte jamais sur le layout ni sur un bouton masqué.

## Ce que monte le layout

Dans l'ordre : `LoadingProvider` (barre de progression indéterminée de `withLoading`), `SiteNavbar`,
`VerifyEmailBanner` (adresse non vérifiée), `RecruiterIdentityProvider`, puis dans `<main className="mbc-app">` :

- `RecruiterTrailRecorder` sous `Suspense` : note les pages visitées dans l'onglet (voir « Navigation ») ;
- `RecruiterSubnav` : le sous-menu des rubriques ;
- `AoSyncProvider` (`/api/recruiter/ao/sync`) autour des pages : une synchronisation des boîtes AO lancée continue d'une
  page à l'autre, avec un bandeau qui renvoie vers `/recruiter/parametres/boites-ao` ;
- `MbcAssistant` (assistant IA, module [src/assistant/](../../assistant/README.md)).

Le nom de l'entreprise vient de la collection `TENANTS` (client API serveur, `createAdminClient`) ; si la lecture
échoue, il reste vide et les modèles de message s'en passent.

## Navigation

- **Sous-menu** : une rubrique s'ajoute dans `RECRUITER_SECTIONS` ([recruiter-nav.ts](../../lib/recruiter-nav.ts)),
  jamais comme carte sur le tableau de bord. `also` liste les pages qui gardent la rubrique en surbrillance (le pipeline,
  la fiche candidat, l'import et le suivi des annonces restent sous « Tableau de bord » ; le screening sous « Entretiens
  IA » ; la marque employeur sous « Mon équipe »). Le support n'a pas de rubrique.
- **« ← Retour »** : `RecruiterTrailRecorder` garde au plus `TRAIL_MAX` (10) adresses de l'espace recruteur dans le
  `sessionStorage` de l'onglet (clé `mbc-recruiter-trail`). `recordVisit` : même page avec d'autres paramètres →
  remplace sa dernière entrée ; retour à l'avant-dernière page → on recule d'un cran ; sinon la page s'ajoute.
  `backTarget` renvoie la page d'avant, ou `null` (page ouverte directement, nouvel onglet, stockage bloqué) : `BackLink`
  affiche alors `fallbackHref`, la page parente. Le nom affiché vient de `recruiterPageLabel` : libellé de la rubrique,
  sinon `PAGE_LABELS`, sinon « Page précédente ». L'historique est effacé à la déconnexion (`clearRecruiterTrail`).
- **Filtres dans l'adresse** : les listes (« Mes offres », suivi des annonces, appels d'offres) écrivent leurs filtres
  avec `history.replaceState`, sans entrée d'historique ni nouveau rendu serveur. `noteListWrite` / `syncFromUrl`
  distinguent les écritures de la liste elle-même (frappe rapide) d'un vrai changement d'adresse (lien, onglet du
  sous-menu), seul cas où la liste relit l'adresse.

## Chargement

Pas de chargeur plein écran. Un changement de page affiche la barre fine du haut
([navigation-progress.tsx](../../components/shared/navigation-progress.tsx) ; appeler `startNavigationProgress()` avant
un `router.push()`), et le `loading.tsx` de la route dessine la page en formes grises
([page-skeletons.tsx](../../components/recruiter/page-skeletons.tsx)). Le contenu chargé dans une page reçoit des formes
de même taille ; les indicateurs qui tournent restent dans les boutons d'action et les opérations longues (analyse IA).

## Ajouter une page

1. Le dossier sous `src/app/recruiter/`, son `page.tsx` (composant serveur) qui lit les données et vérifie l'accès.
2. Ses actions serveur, chacune avec la fonction de contrôle de la rubrique.
3. Sa rubrique dans `RECRUITER_SECTIONS`, ou sa page de rattachement dans `also`.
4. Pour une page de détail : son nom dans `PAGE_LABELS` ([recruiter-trail.ts](../../lib/recruiter-trail.ts)) et un
   `BackLink` avec `fallbackHref`.
5. Un `loading.tsx` si sa mise en page diffère de `SectionPageSkeleton`.
6. Son `README.md`, et une ligne dans le tableau « Pages et documentation » ci-dessus.

## Tests

Règles communes testées : [recruiter-nav.test.ts](../../lib/recruiter-nav.test.ts),
[recruiter-trail.test.ts](../../lib/recruiter-trail.test.ts), [url-list-state.test.ts](../../lib/url-list-state.test.ts).
Tous les tests : `npm test` (`node --import tsx --test "src/**/*.test.ts"`).
