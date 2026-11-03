# 0026 — Matching IA d'une offre : correspondances du vivier général indexées (vivier_offer_matches)

- Statut : accepté
- Date : 2026-11-03
- Note : le numéro 0025 est pris par une décision non fusionnée (procédure de mise en production).

## Contexte

Le Matching IA d'une offre (`/recruiter/pipeline/<offre>/matching`) montre trois types : « Candidature », « Base
candidats » et « Vivier de <recruteur> » (demande du 2026-11-03). Un vivier est personnel : seuls les CV du recruteur
connecté y figurent, aucun collègue ne les voit (décision du même jour). Les CV du vivier général n'y apparaissaient pas : seul
le vivier de l'offre était lu. Leurs scores sont enregistrés sur chaque CV (`vivier_cvs.offerMatchesJson`, JSON de
toutes les offres comparées, toutes notes confondues).

Une première version les cherchait par sous-chaîne (`Query.contains('offerMatchesJson', <offre>)`, 200 CV au plus) :

- **résultat faux** : la recherche renvoie tous les CV comparés à l'offre (presque tout le vivier, chaque CV importé
  étant comparé aux offres ouvertes), 200 dans un ordre quelconque, puis seuls ceux notés 65 ou plus étaient gardés ;
  un CV noté 90 pouvait manquer, sans avertissement ;
- **lecture lourde** : `LIKE '%…%'` sans index sur un texte de 20 000 caractères, sans index sur `tenantId`, documents
  entiers (profil compris) relus à chaque affichage et à chaque actualisation de 8 s.

Les autres listes de la page étaient aussi plafonnées en silence (200 candidatures, 200 CV du vivier de l'offre, 100
noms de candidats).

## Décision

- **Collection dérivée `vivier_offer_matches`** : une ligne par CV du vivier général et par offre notée 65 ou plus
  (`VIVIER_MATCH_MIN_SCORE`, le seuil de « Correspond à » sur la carte du CV) : organisation, offre, CV, score, raison.
  Index sur l'offre et sur le CV. Aucune permission client. Identifiant = empreinte du couple CV / offre
  (`matchRowId`) : deux écritures simultanées font une seule ligne. Règles pures : `src/lib/vivier-offer-matches.ts`
  (testé) ; lecture et écriture : `src/lib/appwrite/vivier-offer-matches.ts`.
- **Copie de `offerMatchesJson`**, qui reste la source : à chaque enregistrement des scores d'un CV
  (`compareWithNewOffers`, seul endroit qui les écrit), les lignes sont réécrites d'après les scores tels qu'ils vont
  être enregistrés, **avant** eux. Si elles échouent, les scores ne sont pas enregistrés non plus : la comparaison est
  signalée « n'a pas abouti » et la prochaine synchronisation la refait (l'IA et le quota sont consommés deux fois,
  plutôt qu'un CV absent du Matching sans que rien ne le dise).
- **Suppression** : `deleteVivierCv` supprime les lignes d'un CV du vivier général **après** le CV. Avant, un échec de
  la suppression du CV l'aurait laissé sans lignes, absent du Matching IA sans que rien ne les recrée (la comparaison
  ne réécrit les lignes que s'il y a des offres nouvelles). Un échec après est journalisé : les lignes restées sont
  écartées à la lecture (CV absent) et purgées par le script.
- **Lecture** (`getJobMatches`) : lignes de l'offre et de l'organisation de l'appelant, puis les CV par lots de 100,
  organisation, recruteur (`vivierOwner` : celui qui a importé le CV ; tous pour l'admin de la plateforme) et vivier
  général revérifiés sur le CV. Les lignes ne portent pas le recruteur : celles des CV des collègues sont lues puis
  écartées (une ligne d'un CV supprimé entre-temps est écartée), seulement
  les champs affichés. Toutes les listes de la page sont lues en entier, page par page (`listAllDocuments`,
  `listAllByValues`).
- **Reconstruction** : `npm run vivier:matches -- <env> [--apply] [--prod]` recrée les lignes depuis les scores
  enregistrés, corrige celles qui diffèrent et supprime celles sans CV ou sans correspondance ; idempotent, chaque CV à
  corriger relu avec ses lignes juste avant d'écrire, une ligne plus récente que son CV (comparaison en cours) laissée.
- **Collection vérifiée avant l'IA** : une comparaison lit d'abord la collection (`assertVivierOfferMatchesReady`),
  avant la place de quota et l'appel d'IA ; collection ou variable absente = échec sans comparaison payée perdue.
- **Raison** coupée à 300 caractères entiers, moitiés d'emoji retirées : celles des scores du CV sont coupées en unités
  UTF-16 et Appwrite refuserait le champ.

## Mise en place

DEV : `npm run schema:push -- dev` (dans un terminal), variable `APPWRITE_COLLECTION_VIVIER_OFFER_MATCHES` dans les
fichiers locaux qui visent `bestconsultant-dev` et en portée Preview de Vercel, `npm run vivier:matches -- .env.dev`
(simulation) puis `--apply`, déploiement, de nouveau `--apply` (CV comparés par l'ancien code entre-temps), simulation
à `+ 0 ~ 0 - 0`. Production, par un humain : sauvegarde de la base, `schema:check -- prod` puis `schema:push -- prod`,
variable en portée Production, `vivier:matches -- .env --prod` (simulation) puis `--prod --apply`, mise en production,
de nouveau `--prod --apply`, puis simulation `--prod` à `+ 0 ~ 0 - 0` (sinon relancer `--apply`) ; aucune erreur
« collectionId » ni « Collection not found » dans les journaux. Retour arrière : l'ancien code ne lit ni n'écrit la
collection, elle et la variable peuvent rester ; au retour du nouveau code, relancer `--apply`.

**La collection et la variable doivent exister avant le code** : sans elles, le Matching IA de chaque offre, la
comparaison des CV du vivier général aux offres et la suppression d'un CV du vivier général échouent.

## Conséquences

- Les lignes copient les scores enregistrés sur le CV, offres fermées ou supprimées comprises : celles-ci n'en sortent
  qu'à la prochaine comparaison du CV (qui retire les offres fermées), le script les garde comme le CV. Les lignes
  vivent donc exactement aussi longtemps que les scores du CV (aucune conservation de plus) et sont supprimées avec lui.
- Deux comparaisons simultanées du même CV peuvent laisser des lignes de l'une et des scores de l'autre (la fenêtre
  existait déjà pour les scores) ; une comparaison qui se termine pendant la suppression du CV peut laisser des lignes
  sans CV, écartées à la lecture. Le script répare les deux.
- Une comparaison dont l'écriture des lignes échoue est refaite par l'IA à la synchronisation suivante.
- Écart restant : les candidats de la base (`job_matches`, 30 au plus par offre) gardent leur collection propre ; le
  vivier de chaque offre garde son score sur le CV (`matchScore`).
