# 0003 — AO Offers : tableaux d'offres joints lus sans IA

- Statut : accepté
- Date : 2026-10-21

## Contexte

Des clients envoient leurs appels d'offres sous forme de **tableau de suivi** joint à l'e-mail (Excel, une
ligne par poste : 4, 17 lignes ou plus). Jusqu'ici, tout l'e-mail était confié à l'IA, qui devait réécrire
chaque offre avec une description de 150 à 400 mots. Sa réponse est limitée (4 096 jetons dans `callLLM`) :
au-delà d'une dizaine d'offres elle est coupée, et l'e-mail était abandonné (« Réponse IA tronquée »). Le
repli suggéré, « Offres → Importer », passe aussi par l'IA (8 000 jetons) et bute sur la même limite.

Le projet sait déjà lire un tableau d'offres sans IA : l'import en masse (`src/lib/job-import.ts`).

## Décision

Les pièces jointes tableur (xlsx, xls, csv, tsv) sont lues **colonne par colonne, sans IA**
(`src/lib/ao/spreadsheet.ts`) : chaque ligne devient une offre « à valider ».

- Lecture du fichier par `readSheets` de `job-import.ts`, bornée (500 lignes, 64 colonnes, 1 Mo de texte) et sans
  croire la taille annoncée par le fichier, après les mêmes contrôles que les autres pièces jointes (10 Mo,
  décompression bornée) et une vérification du contenu par ses premiers octets (une archive renommée « .xls »
  ou « .csv » échapperait sinon au contrôle de décompression). Pas d'ODS : SheetJS y développe les cellules
  « répétées » pendant la lecture, avant toute limite. Valeurs validées comme les réponses de l'IA
  (`parseOfferFields`).
- Colonnes reconnues par leur nom, avec une table de synonymes propre aux tableaux d'AO (`COLUMNS`), essayée
  dans un ordre qui lève les ambiguïtés. Plusieurs colonnes de description (contexte, missions, profil…) sont
  réunies en sections `### <en-tête>`. Les colonnes de suivi interne, celles qui nomment des personnes
  (interlocuteur, profil positionné, manager…) et les coordonnées sont ignorées.
- Un tableau aux colonnes inconnues reste lu par l'IA, comme avant.
- Quand un tableau a été lu, le corps de l'e-mail n'est pas envoyé à l'IA : il ne fait que présenter le
  tableau, et l'IA en tirerait des quasi-doublons des lignes.
- 50 offres reprises au plus par e-mail (au lieu de 20), et 500 offres de tableaux par jour : gratuites et
  instantanées, elles permettraient sinon à un envoi en masse de noyer la file « à valider ».

## Options écartées

- **Relever la limite de réponse de l'IA** (16 000 jetons) et raccourcir les descriptions : 1 à 2 minutes par
  e-mail, coût plus élevé, descriptions inventées pour combler des colonnes courtes, et toujours une limite.
- **Découper le tableau en lots confiés à l'IA** : plusieurs appels par e-mail, à reprendre d'un passage à
  l'autre (budget de 4 min) — beaucoup de code pour un résultat moins fidèle que les cellules elles-mêmes.

## Conséquences

- Les offres tirées d'un tableau reprennent le texte des cellules : descriptions plus courtes que celles
  rédigées par l'IA, mais fidèles. L'admin les relit avant publication, comme toutes les offres AO.
- Un champ absent du tableau reste vide (lieu…) ; contrat et télétravail inconnus prennent les valeurs par
  défaut de l'import (`mission`, `hybrid`).
- Un nouveau nom de colonne se gère en l'ajoutant à `COLUMNS` (et à un test), sans toucher au reste.
- Une offre décrite seulement dans le corps d'un e-mail qui joint aussi un tableau n'est pas reprise.
