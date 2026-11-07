# Fiche candidat — `/recruiter/candidates/[applicationId]`

Vue complète d'une **candidature** (un document `applications`) pour le recruteur : identité et coordonnées du
candidat, rapports de l'IA (screening du CV, entretien IA), étapes du parcours de recrutement déjà renseignées,
recommandations, compétences et expérience, lien vers le CV, et export en PDF par l'impression du navigateur. On y
arrive depuis le pipeline d'une offre, le Matching IA (type « Candidature »), le tableau de bord, le screening, un
entretien IA et le suivi des annonces (« Rapport PDF », qui ouvre la fiche avec `?print=1`). Un candidat qui n'a pas
postulé (base candidats, vivier) a sa fiche ailleurs : [candidate-preview](../candidate-preview/README.md).
Décisions : aucun ADR propre. Règles produit : [AGENTS.md](../../../../AGENTS.md), sections « Design System »
(points « « Retour » links » et « Loading states »).

## Fichiers

```
[applicationId]/page.tsx               composant serveur : contrôle d'accès, lectures, rendu de la fiche et règles d'impression
[applicationId]/export-pdf-button.tsx  bouton « Exporter en PDF » (client) : window.print()
[applicationId]/auto-print.tsx         ouvre l'impression à l'affichage quand l'adresse contient ?print=1 (client)
```

Code partagé :

- [candidate-funnel.ts](../../../lib/candidate-funnel.ts) — `funnelForCandidate`, `STEP_TYPES` (étapes du parcours
  enregistrées sur la candidature, `funnelJson`).
- [appwrite/funnel.ts](../../../lib/appwrite/funnel.ts) — `getFunnelStages` (phases du pipeline de l'organisation,
  libellés et couleurs).
- [candidate-identity.ts](../../../lib/candidate-identity.ts) — `resolveCandidateIdentities` (WhatsApp, chasseur de têtes
  d'un profil proposé).
- [appwrite/recommendations.ts](../../../lib/appwrite/recommendations.ts) — `getSubmittedRecommendations` ;
  [recommendation-boost.ts](../../../lib/recommendation-boost.ts) — `RELATIONSHIP_LABEL`.
- [interviews/actions.ts](../interviews/actions.ts) — type `InterviewAnalysis` (analyse d'un entretien IA).
- [cv-detail-expander.tsx](../../../components/shared/cv-detail-expander.tsx) — détail dépliable des expériences,
  formations et langues ; [whatsapp-contact.tsx](../../../components/recruiter/whatsapp-contact.tsx) ;
  [back-link.tsx](../../../components/recruiter/back-link.tsx).
- [api/cv/[fileId]/route.ts](<../../api/cv/[fileId]/route.ts>) — « Voir le CV ».

## Accès et périmètre des données

- `src/middleware.ts` puis le layout `src/app/recruiter/layout.tsx` (rôle `recruiter` seulement).
- `page.tsx` : utilisateur de rôle `recruiter` **avec** `tenantId`, sinon `redirect('/login')` (pas d'accès admin).
- Candidature lue par son identifiant (`createAdminClient()`, clé API serveur) ; lecture impossible (absente ou autre
  erreur) → `notFound()`.
- **Périmètre : `application.tenantId === user.tenantId`**, sinon `redirect('/recruiter/dashboard')`. Le candidat
  (`users`), l'offre (`jobs`), l'entretien et les recommandations sont ensuite lus d'après la candidature, sans autre
  contrôle d'organisation.
- Profil proposé par un chasseur de têtes (`candidate.role === 'hunter_profile'`) : l'e-mail et le téléphone du
  candidat ne sont pas affichés ; le chasseur est l'interlocuteur (nom, e-mail, WhatsApp).

## Chargement de la page

1. `params.applicationId`, `searchParams.print`, `getCurrentUser()` et contrôle du rôle.
2. `applications` : `getDocument(applicationId)` ; contrôle de l'organisation.
3. En parallèle (`Promise.all`) :
   - candidat : `users[application.candidateId]` (erreur → `null` → `notFound()`) ;
   - offre : `jobs[application.jobId]` (erreur → `null`, la fiche s'affiche sans l'offre) ;
   - dernier entretien : `interviews` avec `applicationId`, le plus récent (erreur → aucun) ;
   - `getSubmittedRecommendations(candidateId)` : statut `submitted`, 25 plus récentes (erreur → aucune) ;
   - `getFunnelStages(user.tenantId)` (erreur **non** rattrapée → erreur de rendu de Next).
4. `resolveCandidateIdentities([candidate.$id])` (erreur → aucune identité : ni WhatsApp ni chasseur).
5. `JSON.parse` de `interview.analysis` et de `candidate.cvProfileJson`.
6. Pas de `loading.tsx` propre : `src/app/recruiter/loading.tsx` (`SectionPageSkeleton`).

## Logique et algorithmes

### Libellé de l'étape de la candidature

`application.status` est cherché dans les phases de l'organisation (`getFunnelStages`, par `slug`) :

- statut standard (`STATUS` : `pending`, `screening`, `interview`, `accepted`, `rejected`, `on_hold`) : couleurs de
  `STATUS`, libellé de la phase de l'organisation s'il existe, sinon celui de `STATUS` ;
- autre statut (phase personnalisée) : libellé de la phase, sinon le statut brut ; fond = couleur de la phase (ou gris
  `#6b7280`) avec une opacité de 20 % (`33` en hexadécimal), texte blanc.

### Bloc « Rapports IA »

Affiché si `application.aiScore !== undefined` ou si le dernier entretien a une analyse.

- Screening CV : `aiScore`/100, recommandation `aiRecommendation` (`SCREEN_RECO` : `top`, `good`, `average`, `weak`,
  `reject`), résumé `aiSummary`.
- Entretien IA : `overallScore`/100, recommandation (`INTERVIEW_RECO` : `hire`, `consider`, `reject`), résumé, lien
  vers `/recruiter/interviews/<entretien>`.

À vérifier : Appwrite renvoie-t-il `null` pour un `aiScore` jamais écrit ? Dans ce cas le bloc s'affiche pour une
candidature non analysée, avec « /100 » sans nombre (ailleurs, par exemple `src/app/recruiter/annonces/[jobId]/page.tsx`,
le code teste `aiScore != null`).

### Bloc « Parcours de recrutement »

`funnelForCandidate(application.funnelJson, application.status)` : funnel enregistré s'il est lisible (`saved: true`),
sinon le funnel par défaut aligné sur la colonne (`saved: false`). Le bloc n'apparaît que pour un funnel **enregistré**
(le recruteur l'a déjà modifié dans le pipeline), et ne montre que les étapes dont le statut n'est pas « À faire » ou
qui ont un compte rendu. Par étape : libellé et couleur du type (`STEP_TYPES`), résultat (`positive` / `neutral` /
`negative`), statut (`STEP_STATUS_LABEL`, mêmes libellés que `src/app/recruiter/pipeline/[jobId]/funnel-modal.tsx`),
date et auteur de validation, compte rendu.

### Profil et coordonnées

- Nom : prénom + nom, sinon l'e-mail du compte.
- Compétences, synthèse et détail (expériences, formation, langues) : `cvProfileJson` (profil extrait du CV).
- Profil d'un chasseur : bloc « Profil proposé par un chasseur de têtes » (nom, e-mail, WhatsApp du chasseur, lettre
  d'accompagnement `coverLetter`). Sinon, WhatsApp du candidat s'il l'a renseigné (`identity.whatsapp`).
- « Voir le CV » : `/api/cv/<candidate.cvFileId>` dans un nouvel onglet ; sans fichier, « Aucun CV joint ».

### Export PDF (impression du navigateur)

Pas de génération de PDF côté serveur : la page s'imprime (« Enregistrer en PDF »).

- `ExportPdfButton` : `window.print()`.
- `AutoPrint` (rendu seulement si `?print=1`) : après 700 ms (polices et photo chargées), retire `print` de l'adresse
  par `history.replaceState` (un rechargement ou un « Retour » vers la fiche ne relance pas l'impression), puis
  `window.print()`. Lien d'origine : « Rapport PDF » de `src/app/recruiter/annonces/annonces-client.tsx`
  (`target="_blank"`).
- Règles d'impression (balise `<style>` de la page) : `.no-print` masqué (en-tête collant avec « Retour » et le bouton,
  WhatsApp, lien vers l'entretien), `.print-only` affiché (en-tête imprimé : nom, étape, offre), couleurs imprimées
  telles quelles (`print-color-adjust: exact`).
- À vérifier : la barre du site, le sous-menu recruteur, le bandeau de vérification, le pied de page et le bouton de
  l'assistant (layout recruteur) n'ont ni classe `no-print` ni règle d'impression ; le commentaire de
  `export-pdf-button.tsx` dit pourtant que la navigation est masquée. Contrôler l'aperçu d'impression.

## Actions serveur

Aucune. La page ne fait que lire ; les modifications de la candidature se font dans le pipeline.

## Erreurs et cas limites

- Candidature d'une autre organisation : redirection vers le tableau de bord (pas un 404).
- À vérifier : sur une offre partagée par la plateforme, le Matching IA liste aussi les candidatures directes
  (`tenantId ''`, `getJobMatches`) et leur lien mène ici ; la page les redirige vers le tableau de bord
  (`'' !== user.tenantId`). Faut-il les ouvrir ?
- Candidat supprimé : `notFound()`. Offre supprimée : fiche sans « A postulé pour » ; « Retour » sans page précédente
  renvoie alors au tableau de bord au lieu du pipeline de l'offre.
- `interview.analysis` ou `cvProfileJson` illisible (`JSON.parse` non protégé), ou recommandation d'entretien hors
  de `INTERVIEW_RECO` : erreur de rendu de la page.
- `getFunnelStages` en échec : erreur de rendu de la page.

## Tests

- [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) — nom « Fiche candidat » et retour depuis la fiche ;
  [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts) — la fiche garde la rubrique « Tableau de bord ».
- Aucun test de la page ni de `candidate-funnel.ts`.

Commandes : `npm test` (`node --import tsx --test "src/**/*.test.ts"`), `npm run typecheck`, `npm run lint`.

## Modifier cette page

- Libellés des statuts d'étape : `STEP_STATUS_LABEL` doit rester égal à celui de
  `src/app/recruiter/pipeline/[jobId]/funnel-modal.tsx`.
- Tout élément interactif ajouté (bouton, lien d'action) prend la classe `no-print` ; un contenu à n'imprimer qu'au PDF,
  `hidden print-only`.
- `?print=1` est construit par `annonces-client.tsx` et lu ici (`AutoPrint`) : changer les deux ensemble.
- Nom de la page dans « Retour » : `PAGE_LABELS` (« Fiche candidat », `src/lib/recruiter-trail.ts`) ; rubrique du
  sous-menu : `also` de « Tableau de bord » (`src/lib/recruiter-nav.ts`). Les liens vers la fiche sont construits dans
  le pipeline, le Matching IA (`profileHref`), le tableau de bord, le screening, les entretiens et les annonces.
- Ajouter un `loading.tsx` propre : partir de `src/components/recruiter/page-skeletons.tsx`.
