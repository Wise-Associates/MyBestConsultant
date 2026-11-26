# 0058. Post LinkedIn d'un appel d'offres relu avant sa publication, contexte unifié

Date : 2026-11-23. Statut : accepté. Complète l'ADR 0013 (publication anonymisée d'un AO) et l'ADR 0056 (LinkedIn par
Buffer).

## Contexte

« Préparer la publication » d'un AO montre la version à publier à côté de l'aperçu de l'offre publique ; la personne qui
publie la relit et coche « J'ai relu » (ADR 0013). Le post LinkedIn, lui, était rédigé après le clic sur « Publier », en
arrière-plan (`tryAutoPublishJob` → `prepareSocialPost` → `generateCopy`) : personne ne relisait son contexte avant qu'il
parte (pôle et « 🧭 Le projet » choisis par l'IA, hashtags).

Demandes du 2026-11-23 :

- voir, dans l'aperçu, les contextes qui seront publiés sur les réseaux ;
- le contexte donné par David (direction) est le même pour toutes les offres de Wise Associates : « Wise Associates est
  un cabinet de conseil en management… » puis « Dans le cadre de son développement, Wise Associates recherche un
  consultant [intitulé du poste] pour rejoindre son pôle d'expertise [nom du pôle] et intervenir auprès de ses clients du
  secteur financier et de l'assurance. » (en place depuis le 2026-11-17 pour les offres de la plateforme) ;
- pour les offres des autres organisations, un contexte construit à partir de ce texte (proposition validée le même
  jour).

## Décision

### Contexte du post

- **Offre de la plateforme** (`fromPlatform`) : inchangé, texte de David (présentation : réglage de `/admin/social`,
  `DEFAULT_PUBLISHER_INTRO` ; phrase de recrutement avec le pôle), puis « 🧭 Le projet ».
- **Offre d'une organisation cliente**, sur le même modèle (`buildContent`, `social-content.ts`) :
  1. sa présentation, **écrite par elle** dans sa marque employeur : les premières phrases entières de son « À propos »
     qui tiennent en 300 caractères, sinon son accroche, sinon rien (`brandPresentation` ; aucune présentation inventée
     par l'IA). Lue même si la page de la marque n'est pas publiée : l'organisation l'a écrite pour se présenter, et la
     relecture du post la montre ;
  2. « Dans le cadre de son développement, [organisation] recherche un consultant [intitulé] pour intervenir sur une
     mission. » (mission, freelance) ou « … pour rejoindre ses équipes en CDI / CDD. » : sans ce qui n'est vrai que de
     Wise (pôles, clients du secteur financier et de l'assurance) ;
  3. « 📣 Offre diffusée via MyBestConsultant, la plateforme de recrutement de Wise Associates. » ;
  4. « 🧭 Le projet ».

  « 🔎 Pourquoi cette publication » est retiré (doublon de la phrase de recrutement). S'applique à toutes les offres
  d'organisation diffusées, pas seulement aux AO.

### Post relu avant la publication d'un AO

- **Le post relu est celui qui part.** Pour une offre avec description (toujours le cas d'un AO), le post LinkedIn ne
  dépend, parmi les textes rédigés, que de « Le projet », du pôle et des hashtags (`SocialEdits`). Ils sont préparés
  pendant « Préparer la publication » (`withSocialPreview`, `offer-actions.ts`), relus, envoyés avec la version validée
  (`PublicationDraft.social`) et remplacent ceux de l'IA à la diffusion (`prepareSocialPost({ edits })`). Les autres
  textes (affiche, autres réseaux) sont rédigés à la diffusion, comme avant.
- **Une seule fabrication de la version publiée** : `publicVersion` (`src/lib/ao/publication-social.ts`), utilisée par
  `publishAoOfferOf` et par l'aperçu (validation `parseDraftFields`, anonymisation ou retrait des coordonnées,
  entreprise affichée `publicLabel`, textes du post nettoyés par `toPublicSocial` / `rawPublicSocial`). L'aperçu lit
  ensuite la version comme la diffusion (`liteOfPublished` = `jobLiteOf`, `normalizeCopy`, `buildContent`) : « Le
  projet » saisi sur deux lignes ou un nom du client resté dans le texte s'affichent comme ils partiront. Pour que
  l'anonymisation tourne dans le navigateur, `LEGAL_SUFFIXES` est sorti de `fingerprint.ts` (`node:crypto`) dans
  `legal-suffixes.ts`. Le serveur fournit les noms à masquer (`PublicationPreview.hiddenNames`, les mêmes que
  `hiddenNamesFor`) et les réglages (`linkedInPreviewOf`, `social.ts` : présentation, hashtags, Calendly, adresse du
  site, organisation et sa présentation, identifiant fixe `publicJobIdOf`).
- **Écran** : onglets « Offre publique » | « Post LinkedIn » dans la colonne d'aperçu. Se modifient « Le projet »
  (320 caractères) et, pour une offre de la plateforme, le pôle (les 5 pôles, ou aucun : « ses équipes ») ; toute
  modification décoche « J'ai relu » ; un nom du client resté dans « Le projet » est signalé en rouge. Les flèches ← →
  changent d'onglet sans changer d'offre (`defaultPrevented` respecté par `ao-offer-page.tsx`).
- **IA et quotas** : version de l'IA, « Le projet », pôle et hashtags rédigés par `generateCopy` (même prompt qu'à la
  diffusion) ; côté recruteurs, une place sur des quotas à part (`aoSocialOrg` au nombre des rédactions de la formule,
  `aoSocialAll` 300 ; `socialSlot`), un refus donnant le repli sans IA avec la raison. Version des règles (IA refusée ou
  indisponible) et « Publier sans anonymiser » (sans quota) : repli sans IA (`fallbackCopy` : « Le projet » vide,
  l'accroche de l'offre en tient lieu ; aucun pôle ; hashtags des compétences), modifiable.
- **Aucun post prévu** (publication automatique désactivée, ni Buffer ni Make, LinkedIn non coché) ou réglages
  illisibles : rien n'est préparé, l'onglet dit pourquoi ; la diffusion fait comme avant.
- **Sécurité** : textes reçus du navigateur validés (`parsePublishInput`, zod : « Le projet » à 320 caractères, pôle,
  10 hashtags), nettoyés par `publicVersion`, bornés de nouveau par `normalizeCopy` (pôle de la liste seulement). Un
  hashtag qui colle le nom du client ne part pas : la diffusion ne garde que ceux présents dans l'offre publiée.

## Conséquences

- Une préparation de la version de l'IA fait un appel d'IA de plus (les textes du post) ; la diffusion en fait toujours
  un (affiche, autres réseaux).
- Le texte montré suppose les réglages de `/admin/social` et la marque employeur inchangés entre la relecture et la
  publication.
- Les autres publications (« Publier » du tableau de bord, offres importées, « Relancer ») rédigent toujours les textes
  au moment de la diffusion, avec le nouveau contexte des organisations. L'affiche, Facebook, Instagram et X ne sont pas
  prévisualisés.

## Mise à jour du 2026-11-26 : seule l'organisation qui publie est nommée

- La ligne « 📣 Offre diffusée via MyBestConsultant, la plateforme de recrutement de Wise Associates. » (point 3 du
  contexte des offres d'organisation) est retirée : une offre ne nomme que l'organisation qui la publie, jamais Wise
  Associates ni MyBestConsultant, sauf quand c'est la plateforme qui publie (sa présentation et sa phrase de
  recrutement restent).
- Même règle pour tout le post : le lien Calendly (celui d'un consultant de Wise Associates par défaut) n'est mis que
  sur les posts de la plateforme ; la légende Instagram renvoie au « lien dans la bio » sans nommer le site ; l'affiche
  n'a plus le logo MBC ni la bande « My Best Consultant · mybestconsultant.fr », et son bouton dit « Postulez en
  ligne ». Le lien de l'offre reste sur le site, qui l'héberge.
- La consigne de rédaction d'un AO ne cite plus le site et interdit de le mentionner ; « MyBestConsultant » et « My Best
  Consultant » rejoignent « Wise Associates » parmi les noms signalés en rouge à la relecture et refusés à la
  publication d'une version anonymisée (`PLATFORM_NAMES`, `publication-copy.ts`).
- **Ouverture au nom de l'organisation qui publie** (demande de David du 2026-11-25) : dans la version de l'IA, la
  première phrase du contexte, « <client décrit> recrute un profil pour … » (ADR 0060), devient « <organisation> recrute
  pour <client décrit> un profil pour … » : « Altrion recrute pour un grand groupe bancaire… », « Wise Associates recrute
  pour… » pour la plateforme (`withRecruiterOpening`, `recruiter-opening.ts`, sans appel d'IA ; nom du document de
  l'organisation, comme le post ; autre forme : laissée telle quelle). Ajoutée après l'anonymisation. Ce nom ne doit être
  ni masqué (le domaine de l'expéditeur, Wise Associates quand il transfère l'e-mail, fait partie des noms à masquer) ni
  refusé comme mention de la plateforme : seule cette ouverture est mise de côté pendant l'anonymisation
  (`takeOpening` / `putOpening` dans `publicVersion`, partagée par l'aperçu et la publication), dans le contrôle des
  mentions de la plateforme et dans le signalement en rouge de la relecture ; ailleurs, la règle de l'ADR 0060 reste.
  Le post s'ouvre ainsi par cette phrase (première phrase du contexte).
