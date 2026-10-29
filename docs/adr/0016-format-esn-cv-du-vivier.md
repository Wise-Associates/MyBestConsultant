# 0016 — « Format ESN » pour les CV du vivier des recruteurs

- Statut : accepté
- Date : 2026-10-29
- Complète : 0010 (export « Format ESN » des recruteurs, un modèle par organisation)

## Contexte

Les recruteurs exportent au format de leur ESN les candidats de leur CV Thèque (ADR 0010). Ils veulent faire de même
pour les CV de leur vivier (`/recruiter/vivier`), et déposer le modèle CV depuis cette page aussi (demande du
2026-10-29). Or l'export ne connaît que les **comptes candidats** (`users` de rôle `candidate`, CV dans le bucket
`cvs`) : un CV du vivier est un document `vivier_cvs` (nom, e-mail et téléphone lus par l'IA à l'import, fichier dans
le bucket `vivier_cvs`), **visible du seul recruteur qui l'a importé** (et des administrateurs de la plateforme). Les
versions enregistrées sont rangées par organisation et identifiant de candidat (`cv_exports`) et la route GET des
candidats ne vérifie que l'organisation : une version d'un CV du vivier rangée sous son identifiant serait
téléchargeable par un collègue de la même organisation, qui ne voit pas ce CV.

## Décision

- **Même export, autre source** : `exportVivierCv` (`src/lib/cv-export/export.ts`) lit le CV du vivier puis suit
  exactement le chemin d'un candidat (IA de la ligne « Export CV », modèle de l'organisation, contrôle des fuites,
  enregistrement). Le nom complet est découpé en prénom (tous les mots sauf le dernier) et nom (le dernier mot,
  `splitFullName`) : le contrôle des fuites cherche chacun seul.
- **Seul le recruteur qui a importé le CV l'exporte** ou retélécharge ses versions (`loadOwnVivierCv` : même organisation
  et même `recruiterId`, comme `ownVivierDoc` du vivier) ; le CV d'un autre est « introuvable ». Vérifié avant le quota
  et tout appel d'IA. Route `/api/recruiter/vivier/cv-export/[cvId]` (POST, GET), versions pour la fenêtre par l'action
  `getVivierCvExportVersions`. Mêmes conditions que la CV Thèque (modèle déposé, abonnement actif, adresse e-mail
  vérifiée) et **même quota du jour** (`cvExportOrg` / `cvExportAll`) : la préparation est partagée
  (`recruiterGenerationScope`, `http.ts`).
- **Versions rangées sous `vivier:<id du CV>`** (`vivierExportKey`, `stored.ts`, dans l'attribut `candidateId` de 36
  caractères) : le « : » la rend inaccessible aux routes des candidats (`CANDIDATE_ID`), seule la route du vivier, qui
  vérifie le propriétaire, la lit et l'écrit. Aucun changement de structure.
- **Supprimées avec le CV** : « Supprimer » dans le vivier supprime d'abord ses versions (`deleteCvExportsForCandidate`
  avec la clé) ; si elles ne peuvent pas l'être, le CV est gardé et le recruteur réessaie. Un second passage suit la
  suppression du CV, comme pour un compte : avec la vérification du CV par `saveCvExports` avant et après l'écriture,
  une génération en cours pendant la suppression ne garde aucune version (échec du second passage : journalisé, à
  supprimer à la main).
- **Nom connu exigé** : le contrôle des fuites cherche le nom du candidat indépendamment de l'IA qui rédige le dossier.
  Un CV du vivier sans nom (profil non créé, nom non lu) n'est pas exporté (422, avant le quota) ; le bouton n'apparaît
  que sur un profil créé. Les versions se lisent avec le fichier du CV du vivier (`loadCvExportVersions(…,
  currentCvFileId)`), pas avec un compte candidat.
- **Bouton « Modèle CV » aussi dans le vivier** : le même composant (`CvTemplateManager`) et les mêmes actions que la CV
  Thèque ; un seul modèle par organisation, les deux pages sont relues après un dépôt ou un retrait.

## Conséquences

- Les recruteurs exportent un CV du vivier sans en faire d'abord un compte candidat ; les administrateurs de la
  plateforme, qui voient tous les CV du vivier d'une organisation, n'ont pas ce bouton (route réservée aux recruteurs).
- Un CV du vivier n'a pas d'autre durée de conservation que sa suppression : ses versions la suivent.
- Si un autre chemin de suppression de `vivier_cvs` est ajouté (suppression d'une offre, d'un compte), il doit aussi
  supprimer ces versions.
