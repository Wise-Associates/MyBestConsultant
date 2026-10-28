# 0014 — Modèle CV « Format ESN » : le .docx seul, cartographié par l'IA au dépôt

- Statut : accepté
- Date : 2026-10-28
- Complète : 0009 (export au format ESN), 0010 (modèle par organisation)

## Contexte

Le dépôt d'un modèle CV (CV Thèques admin et recruteur) exigeait le .docx **et** son `template_map.json`, la
cartographie qui dit au moteur de rendu (`render.ts`, portage de `render_cv.py`) où va chaque rubrique : index des
éléments du corps, prototypes, gabarits par segment de texte, sections, libellés FR / EN, remplacements dans les
en-têtes et pieds de page. Elle s'écrivait à la main avec la skill `cv-esn-anonymise` (Étape 2), hors de la plateforme :
aucun recruteur ne pouvait le faire. Demande du client (2026-10-28) : déposer le .docx seul, par exemple
`Wise_Associates_Template_dossier_de_competences_version_courte.docx`, dont l'identité est dans les en-têtes de page et
les expériences sur trois lignes (entreprise, poste ⇥ dates, « Principales missions : ») — une mise en page que la
cartographie du modèle Wise du dépôt ne couvre pas.

## Décision

- **Le .docx seul**. Au dépôt, le serveur inspecte le modèle (`inspect.ts`, portage de `inspect_template.py`, segments
  découpés exactement comme au rendu, chemins des paragraphes de tableau, largeur utile de la page, morceaux de texte
  des en-têtes et pieds de page) et l'IA écrit la cartographie (`template-mapping.ts`), avec les règles de l'Étape 2 et,
  en exemple, le modèle d'exemple du dépôt et sa cartographie.
- **L'IA ne lit que l'inspection**, jamais le fichier. Modèle : celui d'« Export CV » dans Config IA, ou Claude s'il n'y
  en a pas (`moduleDefault`), **sans repli** comme l'export : un modèle déposé peut être le dossier d'un vrai candidat,
  et le bloc contact du commercial de l'ESN est dans l'inspection. Deux réponses de 120 s au plus (pages de CV Thèque à
  `maxDuration = 300`).
- **Vérifiée avant d'être enregistrée** : format strict (`parseTemplateMap`), puis rendu du candidat fictif en français
  et en anglais (`mappingProblems`) : chaque rubrique présente (identité, résumé, dates, client, rôle, contexte,
  réalisation, environnement, formation, certification, langue, compétence), aucun « [texte d'exemple] » du modèle
  resté (corps, en-têtes, pieds de page), titres de section présents, aucun libellé français dans la version anglaise,
  aucun paragraphe vide ajouté là où le modèle n'en a pas (premier essai sur le modèle « version courte » : un blanc
  sous chaque titre de section, le moteur ajoutant un espaceur sans `<section>_head` ; règle 7 des consignes).
  Un problème est renvoyé à l'IA pour une seconde et dernière tentative ; sinon le dépôt est refusé avec les problèmes.
  Le nom de l'ESN écrit dans les métadonnées est celui de l'organisation (la plateforme : « Wise Associates »), jamais
  celui de l'IA.
- **Bornes** (revue de sécurité du 2026-10-28) : le modèle est un fichier non fiable et la cartographie, écrite par
  l'IA, peut être orientée par un texte du modèle. Texte du modèle limité à 100 000 caractères (`render.ts`),
  inspection à 40 000, e-mails et téléphones masqués dans l'inspection ; cartographie bornée (12 sections, 30 jetons par
  layout, gabarits de 300 caractères… `template-check.ts`) et rendu limité à 5 000 éléments créés ; textes d'exemple
  restés trouvés en une lecture, 20 problèmes au plus renvoyés à l'IA.
- **Coût** : chaque dépôt d'un recruteur prend une place des quotas du jour, 20 par organisation (inchangé) et désormais
  200 pour toutes (`cvTemplateAll`) ; un dépôt refusé ensuite compte. Comme les autres plafonds de la plateforme, des
  comptes gratuits à l'adresse vérifiée peuvent l'épuiser pour la journée (risque accepté ; une part réservée aux
  organisations payantes est possible si besoin).
- L'exemple téléchargeable est le .docx seul.

- **Rendu** : une tabulation écrite dans le même run que le texte (dates alignées à droite du modèle « version
  courte ») sépare deux segments et est gardée au remplissage (`runTabs`, `render.ts`) ; `render_cv.py` la perdait.
  Écart à reporter dans la skill.

## Conséquences

- Un modèle vierge avec un exemple entre crochets dans chaque rubrique donne le meilleur résultat : les contrôles
  reconnaissent alors tout texte d'exemple oublié. Un modèle tiré du dossier d'un vrai candidat (sans crochets) passe
  les contrôles de rubriques, mais un reste de ce candidat dans une zone conservée (en-tête, bloc d'identité) n'est pas
  détecté : relire l'aperçu fictif, proposé après le dépôt.
- Ce que les contrôles ne voient pas : la mise en page (espacements, saut de page). L'aperçu est à relire, comme le
  demandait déjà l'Étape 7 de la skill.
- Les modèles et cartographies déjà enregistrés restent valables (même format) ; le modèle Wise du dépôt garde sa
  cartographie écrite à la main.
- Une cartographie fausse d'une manière que les contrôles ne voient pas se corrige en redéposant le modèle (nouvelle
  réponse de l'IA). Il n'y a plus de dépôt manuel de `template_map.json`.
