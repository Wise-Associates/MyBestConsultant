# CV Thèque — `/recruiter/cvtheque`

Recherche dans la base des candidats inscrits sur la plateforme (comptes `users` de rôle `candidate` qui ont déposé un
CV) : filtres par mots-clés, mobilité, séniorité, lieu, secteur et disponibilité, fiche complète, contact par e-mail, et
export « CV format cabinet » dans le modèle Word de l'organisation. On y arrive par la rubrique « CV Thèque » du
sous-menu. Le bouton « Modèle CV » de l'en-tête (dépôt du modèle de l'organisation) est le même que celui de « Mon
vivier ».
Décisions : [0010](../../../../docs/adr/0010-export-cv-modele-par-organisation.md) (modèle par organisation),
[0014](../../../../docs/adr/0014-modele-cv-cartographie-par-ia.md) (cartographie du modèle par l'IA),
[0024](../../../../docs/adr/0024-cv-format-cabinet-copie-fidele.md) (contenu recopié, identité anonymisée).
Règles produit : [AGENTS.md](../../../../AGENTS.md), section « Export des CV au format ESN » (points « Modèle CV » et
« Recruteurs »).

## Fichiers

```
page.tsx                    composant serveur : contrôle d'accès, candidats, état « CV format cabinet » ; maxDuration 300
loading.tsx                 squelette : SectionPageSkeleton content="grid"
cvtheque-client.tsx         écran (client) : filtres, compteurs, pagination, cartes, fenêtres de fiche et d'export
candidate-profile-modal.tsx fenêtre « Profil complet » (aussi utilisée par le vivier, prop `vivier`) et formulaire de contact
actions.ts                  Server Actions : candidats, recommandations, message au candidat, versions et modèle CV ;
                            type CvThequeCandidate
```

Code partagé :

- [keyword-match.ts](../../../lib/keyword-match.ts) — `matchesKeywordRows`, `isExcludedByKeywordRows` (aussi utilisés
  par la liste publique des offres, `getActiveJobs`) ; saisie :
  [keyword-query-builder.tsx](../../../components/shared/keyword-query-builder.tsx).
- [regions.ts](../../../lib/regions.ts) — `normalizeLocation`, `expandLocationSearch` (régions, pays et leurs villes).
- [candidate-taxonomy.ts](../../../lib/candidate-taxonomy.ts) — liste `SECTORS` du filtre « Secteur ».
- [cv-export/](../../../lib/cv-export/) — `recruiterCvExportAccess`, `takeTemplateSlot`, `organisationName`
  (`recruiter.ts`) ; `readTemplateUpload`, `saveUploadedTemplate`, `removeTemplate` (`template-upload.ts`) ;
  `loadCvExportVersions` (`store.ts`) ; `templateUploadDenial`, `CV_TEMPLATE_DAILY_LIMITS`, `CV_EXPORT_DAILY_LIMITS`
  (`access.ts`) ; `CANDIDATE_ID` (`stored.ts`) ; cœur des routes (`http.ts`).
- [api/recruiter/cv-export/[candidateId]/route.ts](<../../api/recruiter/cv-export/[candidateId]/route.ts>) — génération
  (POST) et retéléchargement (GET) d'un export ; [api/recruiter/cv-templates/](../../api/recruiter/cv-templates/) —
  aperçu (`sample`) et exemple (`example`) du modèle.
- [esn-export-dialog.tsx](../../../components/cv-export/esn-export-dialog.tsx),
  [cv-template-manager.tsx](../../../components/cv-export/cv-template-manager.tsx) — fenêtre d'export et bouton
  « Modèle CV ».
- [api/cv/[fileId]/route.ts](<../../api/cv/[fileId]/route.ts>) — sert le CV d'un candidat (« Voir le CV »).
- [appwrite/recommendations.ts](../../../lib/appwrite/recommendations.ts) — `getSubmittedRecommendations`.
- [email-template.ts](../../../lib/email-template.ts) — `wrapEmailHtml` (mise en page de l'e-mail au candidat).

## Accès et périmètre des données

- `src/middleware.ts` (cookie `mbc-session`, rôle du cookie `mbc-role`) puis le layout `src/app/recruiter/layout.tsx`
  (rôle `recruiter` seulement, sinon `/login`).
- `page.tsx` : `getCurrentUser()` ; absent, ou rôle autre que `recruiter` / `admin` → `redirect('/login')`. Aucun
  `tenantId` n'est exigé pour la liste.
- **Périmètre : toute la base candidats de la plateforme**, sans filtre d'organisation — `getRecruiterCvthequeCandidates`
  lit `users` avec `role = 'candidate'` (500 documents au plus), puis garde ceux qui ont un `cvFileId`. Les coordonnées
  (e-mail, téléphone, WhatsApp, ville) sont envoyées au navigateur avec le reste du profil. Les profils proposés par un
  chasseur (`hunter_profile`) n'en font pas partie.
- « Voir le CV » : `/api/cv/<fichier>` accepte tout recruteur ou admin connecté, sans contrôle d'organisation (un
  chasseur seulement pour les CV de ses profils).
- Export « CV format cabinet » et modèle CV : **organisation de la session**, jamais de la requête ; rôle `recruiter`
  avec `tenantId` (`recruiterOfSession`, `sessionRecruiter`). L'export n'accepte que des comptes de rôle `candidate`
  (`loadCandidate`, `src/lib/cv-export/export.ts`).
- Client Appwrite : `createAdminClient()` (clé API serveur) partout.

## Chargement de la page

1. Contrôle d'accès (ci-dessus).
2. En parallèle : `getRecruiterCvthequeCandidates()` et `recruiterCvExportAccess(user)`.
3. `getRecruiterCvthequeCandidates` convertit chaque document en `CvThequeCandidate` : nom = prénom + nom ;
   compétences, résumé, expériences, formation, langues et années d'expérience lus dans `cvProfileJson` (JSON du profil
   extrait du CV) ; `openToWork` absent → `true` ; `desiredSector` et `desiredRoles` découpés sur la virgule.
4. Rendu de `CvthequeClient` avec `initialCandidates`, `loadError` (bandeau rouge), `cvExport` (`null` : ni bouton
   « Modèle CV » ni export) et `cvExportError` (bandeau orange, page utilisable).
5. `loading.tsx` : `SectionPageSkeleton content="grid"` (`src/components/recruiter/page-skeletons.tsx`).
6. `maxDuration = 300` : le dépôt du modèle (Server Action de cette page) attend jusqu'à deux réponses de l'IA de 120 s
   (ADR 0014).

Tout le filtrage se fait ensuite dans le navigateur, sur la liste chargée ; aucune action n'est appelée en changeant un
filtre.

## Logique et algorithmes

### Filtres (`CvthequeClient`, `filtered`)

Un candidat est gardé s'il passe **tous** les filtres, dans cet ordre :

| Filtre | Règle |
|---|---|
| Secteur | `desiredSector` contient exactement la valeur choisie (`SECTORS`) |
| Disponibilité | « Actuellement disponible » : `openToWork` ; « Non disponible » : `!openToWork` |
| 20 plus récents | le candidat est parmi les 20 (`RECENT_COUNT`) de date de création la plus récente de la liste chargée |
| Rayon de mobilité (0–100 km, pas de 5) | seulement si `mobilityRadiusKm` est renseigné : exclu s'il est hors de l'intervalle choisi |
| Séniorité (0–15 ans) | seulement si `yearsOfExperience` est renseigné : exclu sous le minimum ; au-dessus du maximum seulement si le maximum est sous 15 (`SENIORITY_MAX` = « 15+ ans ») |
| Localisation | texte libre étendu par `expandLocationSearch` (une région ou un pays donne ses villes, une ville sa région et les villes de celle-ci) ; gardé si la ville normalisée du candidat contient un des termes ou y est contenue |
| Exclusion | `isExcludedByKeywordRows(haystack, excludeRows)` : exclu si les lignes d'exclusion remplies correspondent |
| Mots-clés | `matchesKeywordRows(haystack, includeRows)` ; aucune ligne remplie = tout passe |

`haystack` = nom, ville, termes de `expandLocationSearch(ville)`, compétences, secteurs, missions recherchées, résumé,
expériences (intitulé, entreprise, missions), formations (diplôme, établissement), langues.

`matchesKeywordRows` ([keyword-match.ts](../../../lib/keyword-match.ts)) : chaque ligne remplie est une sous-chaîne
cherchée sans casse (sans normalisation des accents) ; les lignes sont combinées **de gauche à droite** avec l'opérateur
de chaque ligne (`AND` / `OR`, celui de la première ligne ignoré), sans priorité : `A AND B OR C` = `(A AND B) OR C`.
`isExcludedByKeywordRows` renvoie `false` quand aucune ligne d'exclusion n'est remplie (sinon tout serait exclu).

`normalizeLocation` ([regions.ts](../../../lib/regions.ts)) : sans accents, minuscules, tirets, virgules et espaces
réduits à une espace.

### Compteurs et pagination

- « Profils avec CV » = candidats chargés ; « Disponibles » = `openToWork` parmi eux ; « Résultats » = après filtres.
- 50 profils par page (`PAGE_SIZE`). Tout changement de filtre remet la page à 1 : la clé `filterKey` (JSON de tous les
  filtres) est comparée à la précédente pendant le rendu.

### Fiche complète (`candidate-profile-modal.tsx`)

- Affiche le profil extrait (compétences, synthèse, expériences, formation, langues) et les coordonnées ; Échap ou clic
  sur le fond ferme.
- Recommandations (hors vivier) : `getCandidateRecommendationsAction(candidateId)` à l'ouverture →
  `getSubmittedRecommendations` : statut `submitted`, les 25 plus récentes. Une erreur donne une liste vide.
- « Contacter » (hors vivier) : formulaire objet + message, envoyé par `sendCvthequeCandidateMessage` ; bouton actif
  seulement si les deux sont remplis. Pour un CV du vivier (`vivier`), « Contacter » est un lien `mailto:` et « Voir le
  CV » pointe vers `/api/vivier-cv/…` au lieu de `/api/cv/…`.
- Sur la carte de la liste, « Contacter » est un lien `mailto:` (pas le formulaire).

### Envoi d'un message : `sendCvthequeCandidateMessage`

1. `requireRecruiter()` (recruteur ou admin, sinon exception « Non autorisé »).
2. `users.list([Query.equal('email', [candidateEmail])])` : compte Auth de cette adresse ; aucun → « Aucun compte
   candidat associé à cet email ».
3. Corps : chaque ligne du message dans un `<p>` (ligne vide → `&nbsp;`), mis en page par `wrapEmailHtml(subject, …)`.
4. `messaging.createEmail(…)` (Appwrite Messaging), destinataire = ce compte, HTML. Rien n'est enregistré dans la base.

Aucune validation de schéma, aucun quota, aucune vérification que l'adresse appartient à un candidat de la liste.

### « CV format cabinet » et modèle CV

- Bouton « CV format cabinet » sur une carte : seulement si l'organisation a un modèle (`cvExport.template`) et si le
  candidat a un `cvFileId`. Fenêtre `EsnExportDialog` : route `/api/recruiter/cv-export`, versions par
  `getRecruiterCvExportVersions`, refus de générer (`generationDenied`) passé en prop.
- Génération (POST de la route) : session recruteur (`sessionRecruiter`), puis `recruiterGenerationScope` — modèle
  déposé, abonnement `active` / `trialing` et adresse vérifiée (`generationDenial`) ; demande venue du site
  (`Sec-Fetch-Site`) ; places de quota `cvExportOrg` / `cvExportAll` (20 par organisation, 300 pour toutes,
  `CV_EXPORT_DAILY_LIMITS`) prises juste avant l'IA et rendues si elle échoue sans frais. Détail : AGENTS.md et ADR 0010.
- `getRecruiterCvExportVersions(candidateId)` : rôle `recruiter` avec `tenantId` (sinon message « Session expirée »),
  identifiant conforme à `CANDIDATE_ID`, date du modèle (illisible : la version ancienne n'est pas signalée), puis
  `loadCvExportVersions(tenantId, candidateId, …)`.
- `saveRecruiterCvTemplate(formData)` : recruteur de la session → adresse vérifiée (`templateUploadDenial`) → fichier
  (`readTemplateUpload`, le .docx seul) → nom de l'organisation (`organisationName`, lu **avant** la place de quota pour
  qu'une lecture en échec ne la consomme pas) → `takeTemplateSlot('upload')` (`cvTemplateOrg` 20 par jour, puis
  `cvTemplateAll` 200, place de l'organisation rendue si la plateforme refuse) → `saveUploadedTemplate` (cartographie par
  l'IA, vérifiée par un rendu fictif, ADR 0014) → relecture de `/recruiter/cvtheque` et de tout `/recruiter/vivier`
  (`revalidateTemplatePages`).
- `deleteRecruiterCvTemplate()` : recruteur de la session → `removeTemplate(tenantId)` ; les versions déjà générées
  restent.

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `getRecruiterCvthequeCandidates()` | `actions.ts` | liste des candidats | `requireRecruiter` (recruteur ou admin) | lecture `users`, 500 au plus |
| `getCandidateRecommendationsAction(candidateId)` | `actions.ts` | recommandations d'une fiche | `requireRecruiter` ; identifiant non validé | lecture `recommendations` |
| `sendCvthequeCandidateMessage({ candidateEmail, subject, message })` | `actions.ts` | e-mail au candidat | `requireRecruiter` ; ni schéma ni quota | e-mail Appwrite Messaging (HTML) |
| `getRecruiterCvExportVersions(candidateId)` | `actions.ts` | versions d'export enregistrées | rôle `recruiter` + `tenantId`, `CANDIDATE_ID` | lecture `cv_exports`, `cv_templates` |
| `saveRecruiterCvTemplate(formData)` | `actions.ts` | dépôt du modèle | recruteur + `tenantId`, adresse vérifiée, quotas du jour | IA (cartographie) ; collection et bucket `cv_templates` ; `AO_STATE` (places) ; `revalidatePath` CV Thèque et vivier |
| `deleteRecruiterCvTemplate()` | `actions.ts` | retrait du modèle | recruteur + `tenantId` | supprime le modèle (`deleteEsnTemplate`, `cv_templates`) ; `revalidatePath` |

`saveRecruiterCvTemplate` et `deleteRecruiterCvTemplate` sont aussi utilisées par `src/app/recruiter/vivier/page.tsx`.

## Erreurs et cas limites

- `getRecruiterCvthequeCandidates` lit 500 documents **sans ordre** (`Query.limit(500)` seul) puis retire ceux sans CV :
  au-delà de 500 candidats, une partie de la base n'est jamais affichée, sans avertissement, et « 20 plus récents »
  porte sur la liste chargée.
- Un `cvProfileJson` illisible n'est pas rattrapé dans la boucle (`JSON.parse`) : toute la liste échoue et la page
  affiche l'erreur (`loadError`) sans aucun candidat.
- Candidat sans ville : le filtre de localisation le garde toujours (une ville vide est contenue dans tout terme).
  À vérifier : voulu ?
- Rayon de mobilité : le curseur affiche « 100+ km » à son maximum, mais un candidat à plus de 100 km est exclu (la
  séniorité, elle, traite 15 comme « 15 ans et plus »). À vérifier : voulu ?
- Candidats sans `mobilityRadiusKm` ou sans `yearsOfExperience` : jamais exclus par ces curseurs.
- Erreur levée par `requireRecruiter` dans `sendCvthequeCandidateMessage` ou `getCandidateRecommendationsAction` : hors
  du `try`, elle remonte comme exception de Server Action (message masqué en production) ; pour les recommandations,
  la fenêtre l'ignore.
- Sans les variables `CV_TEMPLATES` (`isCvTemplateStorageConfigured`) : ni bouton « Modèle CV » ni export.

## Tests

- [cv-export/access.test.ts](../../../lib/cv-export/access.test.ts) (conditions et quotas de génération et de dépôt),
  [cv-export/stored.test.ts](../../../lib/cv-export/stored.test.ts) (`CANDIDATE_ID`, versions),
  [cv-export/template-mapping.test.ts](../../../lib/cv-export/template-mapping.test.ts),
  [cv-export/template-check.test.ts](../../../lib/cv-export/template-check.test.ts) et les autres
  `src/lib/cv-export/*.test.ts` (rendu, fuites, réponses de l'IA).
- [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts) — rubrique « CV Thèque ».
- Aucun test pour `keyword-match.ts`, `regions.ts`, les filtres de `cvtheque-client.tsx` ni `actions.ts`.

Commandes : `npm test` (`node --import tsx --test "src/**/*.test.ts"`), `npm run typecheck`, `npm run lint`.

## Modifier cette page

- `CandidateProfileModal` et le type `CvThequeCandidate` servent aussi au vivier (`toCandidate` dans
  `src/app/recruiter/vivier/vivier-client.tsx`) : un champ ajouté au type doit y être rempli.
- `revalidateTemplatePages` liste les pages qui affichent le bouton « Modèle CV » : une nouvelle page qui l'affiche s'y
  ajoute.
- `matchesKeywordRows` / `isExcludedByKeywordRows` et `expandLocationSearch` servent aussi à la liste publique des
  offres (`getActiveJobs`, `src/lib/appwrite/jobs.ts`) : changer leur sens change les deux pages.
- Mise en page : `loading.tsx` (`SectionPageSkeleton content="grid"`) suit la page ; la page n'a pas de nom propre dans
  `PAGE_LABELS` (`src/lib/recruiter-trail.ts`), elle prend celui de sa rubrique (`RECRUITER_SECTIONS`,
  `src/lib/recruiter-nav.ts`).
