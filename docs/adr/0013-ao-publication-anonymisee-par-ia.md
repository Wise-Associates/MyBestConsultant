# 0013 — Offres AO : version publiée rédigée par l'IA, validée par une personne

- Statut : accepté
- Date : 2026-10-27

## Contexte

« Préparer la publication » proposait une copie de l'offre AO où seuls les noms connus (client de l'offre, clients cités,
expéditeurs) étaient remplacés et les coordonnées retirées. Sur les offres réelles, cela laissait passer :

- les sigles et variantes du client (« BNPP » pour BNP Paribas), ses entités (« CIB », « F&S »), ses projets et
  applications internes (« MAIA », « THEMIS ») et les autres sociétés citées dans le texte ;
- les références de la demande (« RFC00094023 », « DH038970 ») ;
- un texte brut : l'appel d'offres recopié, parfois 4 000 caractères en anglais.

Demande du client (2026-10-27) : une version totalement anonyme (aucun nom de société, aucune référence), soignée comme
les publications des réseaux sociaux (accroche, « Au programme », « Profil recherché »), et validée par une personne
avant publication.

## Décision

- **Rédaction par l'IA** de la version publiée (modèle par défaut de Config IA, avec repli : l'offre a déjà été confiée
  à ces modèles pour son extraction). L'IA reçoit l'offre déjà nettoyée (coordonnées et références retirées, clients
  connus remplacés) et la liste des clients, pour reconnaître leurs sigles. Elle répond en JSON : intitulé, secteur
  générique (devient l'« entreprise affichée »), lieu, accroche, missions, profil, modalités, compétences, et les noms
  qu'elle a retirés. Réponse validée strictement (`publication-copy.ts`) ; inutilisable, ou IA en échec ou refusée :
  version des règles automatiques, avec la raison. La publication ne dépend jamais de l'IA.
- **Filet de sécurité inchangé dans son principe** : tout ce qui est publié repasse par l'anonymisation déterministe
  (`anonymize.ts`), qui retire désormais aussi les références d'appel d'offres (1 à 6 majuscules et au moins 4
  chiffres ; normes comme « ISO27001 », « AS9100 » et versions datées comme « AX2012 » exclues). Les noms que l'IA dit
  avoir retirés sont masqués eux aussi, y compris s'ils restent par erreur dans sa version (le cas à rattraper),
  sauf la ville de l'offre ; chacun tel quel, sans variante (« Group IT » ne doit pas masquer « IT » partout), et après
  les noms connus, qu'ils ne peuvent pas empêcher de masquer. Le secteur proposé par l'IA, issu d'un e-mail non
  fiable, n'est affiché que s'il ne contient ni nom à masquer, ni coordonnée, ni référence.
- **Validation humaine obligatoire** : aperçu de l'offre publiée à côté du formulaire, noms et références restants
  signalés en rouge pendant la relecture, case « J'ai relu… » décochée par toute modification ; le serveur refuse une
  publication sans elle. Les éléments signalés ne bloquent pas la publication : ceux que les règles connaissent sont
  de toute façon masqués, et la personne qui relit reste juge.
- **Format** : accroche, puis `### Au programme`, `### Profil recherché`, `### Modalités` en puces, en français, sans
  emoji sur le site (sobriété de la charte) ; les publications sociales gardent leurs emojis (`social-content.ts`).
- **Durée** (ajout du même jour) : préparation et publication prennent de 20 s à plus d'une minute ; elles sont tenues
  par le tableau, pas par le panneau de détail. Fermer le panneau ne les interrompt pas : la ligne affiche
  « Modifications en cours », le panneau rouvert retrouve l'opération ou le brouillon, et un message annonce la fin.
  Quitter la page perd cet affichage, sans interrompre le serveur.
- **Coût** : un appel d'IA par clic (environ 20 s). Pour les recruteurs (inscription libre) : abonnement actif, adresse
  e-mail vérifiée et quota quotidien (30 par organisation, 300 pour toutes) ; un refus donne la version des règles.

## Options écartées

- **Règles seules** (sans IA) : gratuites, mais incapables de reconnaître un sigle ou un projet inconnu, et sans
  reformulation : le texte publié reste celui de l'appel d'offres.
- **Bloquer la publication tant qu'un élément est signalé** : un terme générique signalé à tort empêcherait de publier ;
  la validation reste humaine, le masquage automatique couvre les noms connus.

## Conséquences

- Les offres publiées depuis AO Offers ont un intitulé, une description et un secteur réécrits ; les publications
  sociales, rédigées à partir de l'offre publiée, en héritent.
- Un appel d'IA de plus par préparation, à nos frais ; ses échecs n'empêchent pas de publier.
- Ce que l'IA écrit peut être inexact : la relecture est la garantie, d'où la case obligatoire.
