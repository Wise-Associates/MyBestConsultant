# 0009 — Export des CV au format ESN : moteur de la skill porté en TypeScript, IA sans repli, dernière version enregistrée

- Statut : accepté
- Date : 2026-10-23

## Contexte

Wise Associates envoie à ses clients les CV de ses candidats dans son propre modèle Word (« dossier de compétences »),
anonymisés, en français et en anglais. La skill Claude `cv-esn-anonymise` le fait déjà à la main : un agent lit le CV,
écrit un JSON (extraction fidèle, traduction, anonymisation), puis des scripts Python (`python-docx`) le rendent dans
le template de l'ESN décrit par un `template_map.json`, et `check_cv.py` contrôle le résultat avec LibreOffice
(fuites d'identité, expériences coupées entre deux pages). L'admin veut le faire depuis la CV Thèque, en un clic.

Contraintes : la plateforme tourne sur Vercel (Node.js, ni Python ni LibreOffice), 300 s au plus par fonction (plan
Hobby) ; un CV est une donnée personnelle complète ; `callLLM` répondait au plus 4 096 jetons, trop peu pour un CV
entier en JSON.

## Décision

**Périmètre v1 :** admin seulement, depuis `/admin/cvtheque` (bouton « Format ESN » sur chaque candidat qui a un CV),
avec le template Wise Associates fourni par la skill (`src/lib/cv-export/templates/wise-associates/`). Les modèles
propres à chaque organisation (recruteurs) viendront ensuite : il faudra stocker un template et sa cartographie par
organisation, la cartographie étant produite avec la skill.

**Moteur porté en TypeScript** (`render.ts`) : même algorithme et même `template_map.json` que `render_cv.py`, de
sorte qu'un template cartographié avec la skill fonctionne tel quel. XML manipulé avec `@xmldom/xmldom` (0.9.12,
versions antérieures concernées par des avis de sécurité), zip avec `fflate` (0.8.3) : les deux étaient déjà installés
par `mammoth` / `officeparser`. Vérification : sur un CV fictif, `document.xml`, en-têtes, pieds de page et
métadonnées produits sont identiques à ceux du script Python en français ; en anglais, seule différence : python-docx
crée un en-tête par défaut vide en lisant `section.header`, le portage non (rendu identique).

**IA :** ligne « Export CV (format ESN) » de Config IA, **sans repli** (`callLLM` strict, comme l'assistant) : le CV
complet ne part que chez le modèle choisi, jamais chez les autres modèles configurés. Deux appels au plus : extraction
fidèle et anonymisation dans la langue du CV, puis traduction si l'autre langue est demandée. `callLLM` accepte
désormais `maxTokens` (16 000 ici) et `timeoutMs` (140 s puis 120 s, sans nouvel essai automatique, pour tenir dans
les 300 s de la route ; les deux appels finissent au plus tard 265 s après le début, pour laisser le temps
d'enregistrer la version) ; les appelants existants gardent les valeurs par défaut. Le CV est lu en mode strict
(`extractTextFromFile(…, { strict: true })`) : un fichier illisible (protégé, abîmé, faux format) est refusé au lieu
d'envoyer ses octets bruts à l'IA ; au-delà de 40 000 caractères, l'IA est prévenue que la fin manque et le compte
rendu le signale. Réponses validées **strictement** par zod (révisé après revue, 2026-10-23) : une rubrique absente ou
d'un autre type, une clé renommée, une langue autre que `fr` / `en` ou une liste de termes d'identité vide font
refuser la réponse (l'admin réessaie) au lieu de livrer un dossier où la rubrique manque ; aucun texte n'est coupé ;
caractères invisibles et de contrôle retirés. Réponse tronquée détectée. Traduction refusée si un texte rempli dans
l'original est vide ou si une liste n'a pas la même longueur (`structureGap`), ou si elle est identique à l'original.
Échecs de l'IA traduits par cause (crédits, clé, modèle, panne : `claudeProblem` / `openAiProblem`).
L'identifiant (initiales) est calculé par le code depuis la fiche du candidat, jamais par l'IA.

**Contrôle avant livraison, sans LibreOffice** (`leak-check.ts`, portage de la partie « fuites » de `check_cv.py`) :
prénom, nom (dans les deux ordres, et collés : « camillefontaine.fr »), e-mail et téléphone de la fiche, plus les
termes d'identité relevés par l'IA, cherchés en mots entiers dans tout le paquet (texte, attributs, métadonnées),
caractères invisibles retirés ; le téléphone connu comparé sur ses chiffres, quel que soit son découpage ; tout autre
e-mail ou téléphone ; tout lien (adresse web, profil ou prise de contact : LinkedIn, Malt, Calendly, WhatsApp…) ;
auteurs de révisions ; commentaires. Ce que contient déjà le template vierge (bloc contact du commercial, espaces de
noms XML) appartient à l'ESN : un terme n'est une fuite que s'il apparaît plus souvent dans le CV rendu que dans le
template. **Une fuite bloque l'export** (le fichier n'est pas livré, l'admin voit ce qui a été trouvé ; le journal ne
garde que le type). La génération (POST) n'est acceptée que depuis une page du site (`Sec-Fetch-Site: same-origin`).
Le contrôle de pagination de `check_cv.py` n'est pas porté : chaque bloc reste insécable dans Word (« solidaire du
suivant », lignes de tableau non sécables), mais personne ne vérifie le rendu page par page — l'admin relit le
document dans Word avant de l'envoyer (rappelé dans la fenêtre).

**Écarts assumés avec la skill :** le template Wise Associates n'a pas de rubrique Certifications ; plutôt que de les
perdre, elles rejoignent la rubrique Formation (`fitToTemplate`) et le compte rendu le signale. Les contenus sans
rubrique (projets personnels, publications…) sont signalés dans le compte rendu (en-tête `X-Cv-Export-Notes`). Pas de
PDF : le document reste un Word modifiable.

**Dernière version enregistrée** (révisé le 2026-10-23, à la demande de l'admin : régénérer à chaque téléchargement
coûtait 1 à 3 min et un ou deux appels d'IA) : les .docx livrés sont gardés, un par candidat × anonymisation × langue
(collection `cv_exports`, index unique ; bucket privé `cv_exports`, chiffré, sans permission client). Une nouvelle
génération remplace la version précédente (pas d'historique : le minimum de données personnelles). La fenêtre propose
« Télécharger » quand la version existe, « Générer une nouvelle version » sinon ou quand le candidat a remplacé son CV
depuis (version signalée, toujours téléchargeable). On garde le fichier rendu et non le JSON anonymisé : le
téléchargement livre exactement ce qui a passé le contrôle des fuites, sans dépendre d'un changement ultérieur du
moteur ou du template. Conservation : jusqu'au remplacement ou à la suppression du compte du candidat
(`deleteUserAccount`, qui échoue plutôt que de laisser des exports derrière lui), comme le CV d'origine. Un
enregistrement en échec n'empêche pas de livrer le fichier généré (l'IA a déjà été payée) ; la fenêtre le signale.
Facultatif : sans les deux variables, rien n'est enregistré. Pas de quota quotidien : réservé à l'admin.

## Conséquences

- Coût : un ou deux appels d'IA par génération ; les téléchargements suivants n'en coûtent aucun. Un changement du
  template ne s'applique pas aux versions enregistrées : il faut les régénérer.
- Deux générations simultanées de la même version : l'index unique évite le doublon, mais un fichier peut rester sans
  document ; il porte le nom `<candidat>_<mode>_<langue>.docx` et est supprimé avec le compte.
- Un nom de candidat qui est aussi un mot du CV (prénom « Paris », nom identique à un client) bloque l'export en
  anonymisation standard : l'admin peut choisir l'anonymisation renforcée ou préparer ce dossier dans Word. Pas de
  contournement. De même, un lien conservé par l'IA (site d'un client) bloque l'export.
- Limites connues, non traitées : la troncature est déduite de la réponse (le motif d'arrêt du modèle n'est pas lu par
  `callLLM`) ; pour une API compatible OpenAI, le délai ne couvre que l'attente des en-têtes de la réponse (code partagé
  de `llm-router.ts`) ; un modèle local à contexte court (Ollama, TeckiA) peut couper un long CV sans prévenir —
  choisir un modèle à grand contexte pour « Export CV ».
- Un CV scanné (PDF sans texte) est refusé avec un message ; la lecture par l'IA des scans (`vision.ts` de l'AO) n'est
  pas branchée ici.
- Tout changement du moteur doit rester aligné sur `render_cv.py` de la skill (tests `render.test.ts` sur le vrai
  template). Changer de template = remplacer `template.docx` et `template_map.json` par ceux produits par la skill.
