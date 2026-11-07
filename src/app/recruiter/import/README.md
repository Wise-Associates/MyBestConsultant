# Import d'offres (« Import IA / Excel ») — `/recruiter/import`

Création en série d'**offres d'emploi** (collection `jobs`) à partir d'un fichier ou d'un texte collé : un tableur
(Excel, CSV) est lu directement, colonne par colonne, sans IA ; les autres formats (PDF, Word, PowerPoint, texte…)
passent par l'IA. Le recruteur relit et corrige les offres détectées, choisit lesquelles importer, puis les crée par
lots. Ce n'est pas un import de CV (les CV vont dans le vivier, `/recruiter/vivier`).
La route n'a plus d'écran : `page.tsx` redirige vers la fenêtre « Nouvelle offre » du tableau de bord, onglet
« Import IA / Excel ». Ce dossier garde les Server Actions et la carte d'offre éditable que cet onglet utilise.
Décisions : aucun ADR propre. Règles produit : [AGENTS.md](../../../../AGENTS.md), section « Tableau de bord du
recruteur (`/recruiter/dashboard`) » (affectation d'une offre créée à son auteur, montant TJM ou salaire annuel selon
le contrat).

## Fichiers

```
page.tsx           redirection vers /recruiter/dashboard?openCreateJob=1&tab=import
actions.ts         Server Actions : parseFileWithLLM, improveExtractedJob, importJobsChunk (écran actuel), confirmImport (ancien écran)
import-client.tsx  JobCard, carte éditable d'une offre extraite (utilisée par ImportPanel) ; ImportClient, ancien écran
                   pleine page, qu'aucune page ne monte plus (seul appelant de confirmImport)
```

Code partagé :

- [dashboard/import-panel.tsx](../dashboard/import-panel.tsx) — `ImportPanel` : l'écran (choix du fichier, relecture,
  import par lots).
- [dashboard/create-job-dialog.tsx](../dashboard/create-job-dialog.tsx) — `CreateJobDialog` : fenêtre « Nouvelle
  offre », onglets « Saisie manuelle » / « Import IA / Excel ».
- [job-import.ts](../../../lib/job-import.ts) — `parseSpreadsheetJobs`, `readSheets` (aussi utilisé par les AO :
  `src/lib/ao/spreadsheet.ts`), `contractOf`, `remoteOf`, `parseNumber`.
- [import-file-extract.ts](../../../lib/import-file-extract.ts) — `extractTextFromFile` (partagé avec
  `/api/admin/extract-jobs`, l'export de CV et la lecture des pièces jointes AO).
- [job-ownership.ts](../../../lib/job-ownership.ts) — `jobOwnership` (auteur et recruteur affecté).
- [jobs.ts](../../../lib/appwrite/jobs.ts) — `oneMonthFromNow` (date d'expiration).
- [llm-router.ts](../../../lib/ai/llm-router.ts) — `callLLM`.
- [social.ts](../../../lib/social.ts) — `tryAutoPublishJob`, `deliveryDeadline` ; [auto-source-candidates.ts](../../../lib/auto-source-candidates.ts)
  — `tryAutoSourceCandidates`.
- [job-pay.ts](../../../lib/job-pay.ts) — `payText` (montant du tableau compact).
- [modele-import-offres.xlsx](../../../../public/templates/modele-import-offres.xlsx) — modèle Excel téléchargeable
  depuis l'écran (aussi en `.csv` dans le même dossier).

## Accès et périmètre des données

- `/recruiter/import` : le layout [../layout.tsx](../layout.tsx) exige une session de rôle `recruiter` (sinon
  `/login`), puis `page.tsx` redirige sans rien lire.
- Chaque Server Action de [actions.ts](actions.ts) vérifie elle-même `getCurrentUser()` et le rôle `recruiter`, sinon
  « Non autorisé ». Aucune ne vérifie l'abonnement, l'adresse e-mail vérifiée ni un quota du jour.
- Les offres sont écrites avec `tenantId = user.tenantId ?? ''` et `jobOwnership(user)` : `postedBy` = `recruiterId`
  = profil du recruteur (`user.$id`, ADR 0023).
- Écritures par `createAdminClient()` (clé API serveur). Le texte du fichier n'est pas enregistré : seules les offres
  créées le sont.

## Chargement de la page

1. `page.tsx` : `redirect('/recruiter/dashboard?openCreateJob=1&tab=import')`, aucune donnée lue.
2. Le tableau de bord se charge (sa propre `loading.tsx`). `CreateJobDialog` s'ouvre d'emblée si `openCreateJob=1` et
   choisit l'onglet `import` si `tab=import` (état initial lu dans `useSearchParams`).
3. L'onglet monte `ImportPanel` avec `tenantName` (le `companyName` de `CreateJobDialog`, auquel le tableau de bord
   passe le prénom et le nom du recruteur ; seulement affiché : « Offres importées pour … »), `onImported`
   (`router.refresh()`) et `onClose` (ferme la fenêtre et relit la page).

## Logique et algorithmes

### Étapes de l'écran (`ImportPanel`)

Phases `idle → parsing → review → importing → done`, ou `error`. Constantes de
[import-panel.tsx](../dashboard/import-panel.tsx) : `MAX_FILE` 5 Mo, `CHUNK` 20 offres par appel, `EDITABLE_MAX` 30,
`BULK_FROM` 10, `PAGE` 25.

1. **Départ** : choix du modèle IA (`teckia`, `claude` par défaut, `gpt4o`, envoyé en champ `llmProvider`), fichier
   (glisser-déposer ou sélection ; refusé au-delà de 5 Mo dans le navigateur) ou texte collé.
2. **Analyse** : `parseFileWithLLM(formData)`.
3. **Relecture** : sélection initiale = toutes les lignes d'un tableur, ou les offres de l'IA dont `confidence` n'est
   pas `low`. Jusqu'à 30 offres : une `JobCard` éditable chacune (intitulé, lieu, contrat, télétravail, montant,
   compétences, entreprise, description, « Améliorer avec l'IA », suppression). Au-delà : tableau compact (recherche
   sur intitulé, entreprise et lieu ; pages de 25 ; case à cocher ; contrat ; `payText`). Les lignes ignorées du
   tableur sont listées avec leur raison.
4. **Import** (`runImport`) : `bulk = sélection > BULK_FROM` ; lots de 20 envoyés l'un après l'autre à
   `importJobsChunk(chunk, { bulk })`. Un lot dont l'appel lève est réessayé une fois, puis toutes ses offres sont
   comptées en échec (« Connexion interrompue »). Une réponse `error` (refus du serveur) arrête l'import. Progression,
   durée et temps restant estimé sont affichés ; « Arrêter après le lot en cours » met fin à la boucle. Les offres
   créées avant un arrêt ou une erreur restent créées (`onImported`).

### Analyse d'un fichier ou d'un texte (`parseFileWithLLM`)

1. Session et rôle. `defaultCompany` = `user.companyName`, sinon « Prénom Nom ».
2. Fichier de plus de 5 Mo → refus.
3. Extension `.xlsx`, `.xls`, `.csv` ou `.tsv` → `parseSpreadsheetJobs(buffer, filename, defaultCompany)` (voir
   ci-dessous). Tableau **reconnu** : erreur de lecture renvoyée telle quelle ; aucune ligne exploitable → erreur avec
   `totalRows` et `skipped` ; sinon les offres (`source: 'spreadsheet'`, 200 lignes ignorées au plus). Tableau **non
   reconnu** (aucune colonne d'intitulé) : il passe à l'étape suivante comme un document.
4. Autre fichier → `extractTextFromFile(buffer, filename)` (15 000 caractères au plus) ; texte collé → coupé à
   15 000 caractères. Rien → « Aucun contenu fourni » ; moins de 20 caractères → « Contenu illisible ou trop court ».
5. `callLLM([texte], SYSTEM, llmProvider)` : `llmProvider` est la forme ancienne (identifiant de modèle) ; un
   identifiant inconnu donne le modèle par défaut de Config IA (`pickPrimary`), avec le repli habituel sur les autres
   modèles. Consigne `SYSTEM` : un tableau JSON d'offres (`title`, `location`, `contractType`
   cdi | cdd | freelance | mission, `remote` onsite | hybrid | remote, `salary`, `skills`, `description`, `companyName`,
   `confidence`) ; montant = salaire annuel brut pour CDI / CDD (mensuel × 12), TJM pour freelance / mission, `null`
   si l'unité est inconnue ; description complète, jamais résumée ; entreprise par défaut `defaultCompany` ; contrat
   par défaut `mission`, télétravail par défaut `hybrid` ; `confidence` high / medium / low selon les informations
   présentes ; rien d'inventé hors de ces valeurs par défaut ; `[]` sans offre.
6. Lecture : du premier `[` au dernier `]`, `JSON.parse` (échec → « Le document est trop long ou trop complexe… »).
   Chaque offre reçoit un identifiant temporaire aléatoire, `salary` numérique ou `null`, 10 compétences au plus,
   `description` en texte. Les autres champs sont repris tels que l'IA les rend : ils ne sont normalisés qu'à la
   création (`importJobsChunk`).
7. `rawPreview` = 500 premiers caractères du texte (aperçu de l'ancien écran).

### Lecture directe d'un tableur (`parseSpreadsheetJobs`)

- **Lecture** (`readSheets`, bornes `IMPORT_LIMITS` : 5 016 lignes, soit `MAX_SHEET_ROWS` + 16, et 256 colonnes par
  feuille ; `nodim`, la taille annoncée par le fichier n'étant pas crue) : CSV / TSV décodé en UTF-8 (latin-1 s'il
  contient le caractère de remplacement), séparateur choisi sur la première ligne (`;` s'il est plus fréquent que `,`
  et au moins aussi fréquent que la tabulation, sinon tabulation si plus fréquente que `,`, sinon `,`) ; classeur via
  SheetJS. Dates au format `dd/mm/yyyy`. Toutes les feuilles sont lues.
- **En-tête** : cherché dans les 15 premières lignes de chaque feuille ; retenu dès qu'une ligne a une colonne
  d'intitulé et au moins une autre colonne reconnue. En-têtes comparés après `norm` (minuscules, sans accents, sans
  parenthèses ni ponctuation), égaux à un synonyme de `HEADERS` ou commençant par lui suivi d'un espace ; les champs
  sont essayés dans l'ordre de `HEADERS`, et pour un champ seule la première colonne compte. Champs : intitulé,
  entreprise, lieu, contrat, télétravail, montant, compétences, description, durée, démarrage, expérience. Feuille sans
  en-tête : ignorée ; aucune → `recognized: false`.
- **Lignes** (lignes entièrement vides sautées) :

| Champ | Règle |
|---|---|
| ligne lue | au-delà de 5 000 (`MAX_SHEET_ROWS`, toutes feuilles) → erreur « découpez-le en plusieurs fichiers » |
| `title` | obligatoire (sinon ligne ignorée, « Titre du poste manquant »), 200 caractères |
| doublon | même `norm(intitulé)` + `norm(lieu)` + `norm(entreprise)` déjà vu dans le fichier → « Doublon dans le fichier » |
| `companyName` | colonne, sinon `defaultCompany` ; 1 000 caractères |
| `contractType` | `contractOf` : « cdi », « cdd », sinon freelance / indépendant / tjm / portage → `freelance`, sinon `mission` |
| `remote` | `remoteOf` : full / 100 / complet / distance / remote (sans hybride ni partiel) → `remote` ; présentiel / sur site / site (sans hybride) → `onsite` ; sinon `hybrid` |
| `salary` | `parseNumber` : espaces, `€`, `$`, « eur(os) », `/j(our)`, `/mois`, `/an` retirés, premier nombre (virgule décimale, `k` = × 1 000), arrondi ; `null` si rien de positif. Un montant mensuel n'est pas multiplié par 12 |
| `skills` | colonne découpée sur `,` `;` `\|` et retour à la ligne, sans doublon, 10 au plus |
| `description` | colonne de description, puis « Durée de la mission : … », « Démarrage : … », « Expérience requise : … » ; à défaut « intitulé — entreprise (lieu) » ; 60 000 caractères |
| `confidence` | description et lieu → `high` ; l'un des deux → `medium` ; aucun → `low` |

  Le numéro de ligne d'une ligne ignorée est sa position dans les lignes lues + 1 ; SheetJS ne rendant pas les lignes
  vides (`blankrows: false`), il peut différer du numéro affiché par Excel après une ligne vide.

### Extraction du texte (`extractTextFromFile`, mode non strict)

| Extension | Lecture | Échec |
|---|---|---|
| csv, txt, tsv, md | texte UTF-8 | — |
| pdf | `pdf-parse`, 50 premières pages | octets imprimables des 5 000 premiers octets |
| docx | `mammoth` | balises XML retirées du contenu brut |
| doc | `mammoth`, puis `word-extractor` | texte latin-1 nettoyé |
| xlsx, xls (tableau non reconnu) | SheetJS, une section CSV `--- <feuille> ---` par feuille | texte vide |
| pptx, rtf, odt, ods, odp | `officeparser` | texte vide |
| autre | octets imprimables des 10 000 premiers octets | — |

Tout est coupé à 15 000 caractères (`DEFAULT_MAX_CHARS`) : l'IA ne voit que le début d'un long document.

### « Améliorer avec l'IA » (`improveExtractedJob`)

Depuis une `JobCard` : champs éditables de l'offre et demande libre du recruteur (vide → refus). `callLLM` avec la
consigne `IMPROVE_SYSTEM` (modèle par défaut de Config IA, repli habituel) : appliquer la demande, recopier les autres
champs, répondre par un objet JSON. Lecture du premier `{` au dernier `}` ; `title` 200 caractères, `skills` 10 au
plus, `contractType` et `remote` gardés seulement s'ils sont valides, `salary` numérique sinon l'ancien ; sans
`title` ou `description` → « Réponse IA incomplète ». Le résultat remplace les champs de la carte ; rien n'est
enregistré avant l'import.

### Création des offres (`importJobsChunk`)

1. Session et rôle ; lot vide → rien ; plus de 50 offres → « Lot trop grand. ».
2. Offres créées 5 par 5 en parallèle (`Promise.allSettled` : une offre en échec n'arrête pas les autres). Pour
   chacune (`createOne`), document `jobs` :
   `title` (200, obligatoire, sinon « Titre manquant »), `location` (200, sinon « Non spécifié »), `contractType`
   (valeur connue sinon `mission`), `remote` (valeur connue sinon `hybrid`), `salary` (arrondi si > 0, sinon 0),
   `skills` (10 de 100 caractères), `description` (60 000, sinon l'intitulé), `companyName` (1 000), `tenantId`,
   `postedBy` / `recruiterId`, `isActive: true`, `aiScore: null`, `applicationCount: 0`, `expiresAt` = dans un mois
   (`oneMonthFromNow`).
3. Si `bulk` est faux (10 offres ou moins, décidé par l'écran) : diffusion sur les réseaux en arrière-plan
   (`after(() => tryAutoPublishJob(doc, deliveryDeadline(début de la requête)))` : publication par Make si la
   publication automatique est activée dans `/admin/social` et Make configuré ; l'ancien envoi LinkedIn direct,
   `tryAutoPostJobToLinkedIn`, quand LinkedIn n'a pas été pris en charge ainsi), puis
   **attente** de `tryAutoSourceCandidates(doc)` (erreur ignorée) : classement de la base candidats par l'IA, e-mail
   rédigé par l'IA aux 5 meilleurs candidats notés 65 ou plus (`bestMatches`, `SOURCING_TOP_N`,
   `SOURCING_MIN_SCORE`), classement enregistré pour le Matching IA (`runPoolMatching`). Si `bulk` est vrai : rien de
   tout cela, le recruteur le lance ensuite depuis chaque offre.
4. Réponse `{ created, failed }` (intitulé 80 caractères, message 160) ; `revalidatePath('/recruiter/dashboard')`, et
   `/jobs` si au moins une offre a été créée. La page `/recruiter/dashboard` exporte `maxDuration = 300`.

### Ancien écran (`ImportClient`, `confirmImport`)

`ImportClient` ([import-client.tsx](import-client.tsx)) n'est monté par aucune page. Son action, `confirmImport`, crée
toutes les offres reçues une par une, avec les champs tels quels (sans les normalisations de `importJobsChunk`), et
lance pour chacune diffusion et sourcing automatique quel que soit leur nombre.

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `parseFileWithLLM` | `actions.ts` | fichier ou texte → offres à relire | session, rôle `recruiter` ; 5 Mo ; tableur reconnu ou texte ≥ 20 caractères | IA (sauf tableur reconnu) ; aucune écriture |
| `improveExtractedJob` | `actions.ts` | retoucher une offre extraite | session, rôle ; demande non vide ; `contractType` / `remote` filtrés | IA ; aucune écriture |
| `importJobsChunk` | `actions.ts` | créer un lot d'offres (écran actuel) | session, rôle ; 50 offres au plus ; champs normalisés | `jobs` ; si non `bulk` : diffusion réseaux (`after`), sourcing IA et e-mails aux candidats, `job_matches` |
| `confirmImport` | `actions.ts` | créer les offres (ancien écran) | session, rôle | `jobs` ; diffusion et sourcing pour chaque offre |

## Erreurs et cas limites

- Fichier trop lourd : refusé dans le navigateur et sur le serveur (5 Mo).
- Exception pendant l'analyse : `parseFileWithLLM` renvoie le message de l'exception ; l'écran l'affiche en phase
  `error` avec « Réessayer ». Un appel qui ne répond pas (connexion coupée, fichier trop lourd pour la requête) donne
  un message propre à l'écran.
- Tableau aux colonnes inconnues : lu par l'IA comme texte CSV (15 000 premiers caractères seulement).
- Réponse de l'IA sans tableau JSON, ou JSON illisible (réponse coupée) : message demandant un fichier plus court ou
  un autre modèle.
- Une offre refusée par Appwrite à la création : listée avec son message (50 premières affichées), les autres sont
  créées.
- Aucun dédoublonnage avec les offres déjà en base : seul le tableur écarte les doublons **du fichier**.

## Tests

- Aucun test pour `actions.ts`, `parseSpreadsheetJobs`, `extractTextFromFile` ni l'écran.
- `readSheets` et `norm` sont exercés indirectement par les tests des tableaux joints aux AO
  ([ao.test.ts](../../../lib/ao/ao.test.ts), via `src/lib/ao/spreadsheet.ts`).
- [job-ownership.test.ts](../../../lib/job-ownership.test.ts) (`jobOwnership`) et
  [job-pay.test.ts](../../../lib/job-pay.test.ts) (`payText`).

Commande : `npm test` (tous les `src/**/*.test.ts`).

## Modifier cette page

- **L'écran vit dans `src/app/recruiter/dashboard/`** (`ImportPanel`, `CreateJobDialog`) : les paramètres
  `openCreateJob=1` et `tab=import` de la redirection doivent rester ceux que lit `CreateJobDialog`.
- **Type `ExtractedJob`** ([actions.ts](actions.ts)) partagé par les actions, `JobCard` et `ImportPanel` ; `SheetJob`
  ([job-import.ts](../../../lib/job-import.ts)) doit garder les mêmes champs (sans `id`).
- **Contrats et télétravail** listés à plusieurs endroits : `CONTRACTS` / `REMOTES` et `IMPROVE_*` (`actions.ts`),
  consignes `SYSTEM` et `IMPROVE_SYSTEM`, types `ImportContract` / `ImportRemote`, `contractOf` / `remoteOf`
  (`job-import.ts`, aussi utilisés par `src/lib/ao/parse.ts`), libellés `CONTRACT_LABELS` / `REMOTE_LABELS`
  (`import-client.tsx`) et `CONTRACT` (`import-panel.tsx`).
- **Montant** : la règle d'unité selon le contrat est dans [job-pay.ts](../../../lib/job-pay.ts) ; la consigne `SYSTEM`
  la reprend pour l'IA.
- **Colonnes reconnues** : `HEADERS` de `job-import.ts` ; le modèle `public/templates/modele-import-offres.xlsx` (et
  `.csv`) et l'export Excel des AO (`src/lib/ao/excel.ts`, au même format) doivent rester lisibles. `readSheets` sert
  aussi aux AO avec leurs propres bornes.
- **Extraction de texte** : `extractTextFromFile` est partagé (admin, export de CV en mode strict, pièces jointes AO) ;
  un nouveau format s'y ajoute une fois, et dans `ACCEPT` de `import-panel.tsx`.
- **Navigation** : la route reste rattachée à la rubrique « Tableau de bord » (`also` de `RECRUITER_SECTIONS`,
  [recruiter-nav.ts](../../../lib/recruiter-nav.ts)) et a le libellé « Import d'offres » dans `PAGE_LABELS`
  ([recruiter-trail.ts](../../../lib/recruiter-trail.ts)) ; tant qu'elle redirige, ces entrées ne servent qu'aux
  anciens liens.
