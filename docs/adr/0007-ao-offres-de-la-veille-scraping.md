# 0007 — Offres de la veille (scraping) dans la page AO

Date : 23 octobre 2026 · Statut : acceptée

## Contexte

Le projet `veille-marches-emplois` relève chaque jour les appels d'offres (BOAMP, TED) et les offres d'emploi de 14
organismes publics et parapublics. Ces offres doivent apparaître dans la page AO (`/admin/candidats`), mises en forme
comme les autres (champs, compétences, technologies, assistance / forfait, séniorité), dédoublonnées, sans les offres
échues, et repérables : la colonne « Source » doit dire « E-mails AO » ou « Scraping ».

Les offres AO sont attachées à leur e-mail : date limite, expéditeur, originaux, reprises en cas d'échec y sont
enregistrés (`ao_emails`, `ao_offers` étant à 16/16 attributs). Une écriture directe en base contournerait ce circuit.

## Décision

1. **La veille passe par la boîte AO** : une offre par e-mail (le texte complet, des libellés que lit la consigne
   d'extraction), envoyé depuis une adresse de nos domaines. MyBestConsultant la traite comme tout e-mail : extraction
   par l'IA, client lu dans le texte (expéditeur de nos domaines, ADR 0004), dédoublonnage par empreinte sur 60 jours
   (une offre reçue aussi d'un client ou d'un intermédiaire n'est créée qu'une fois), statut « à valider ».
2. **Reconnaissance** : en-tête `X-Wise-Veille: scraping` **et** expéditeur d'un de nos domaines exacts ou d'un
   sous-domaine (`fromVeille` : « wise-associates.com » n'est pas « wise-associates.fr »), dans la boîte de la
   plateforme seulement. L'en-tête seul ne suffit pas : n'importe qui peut l'écrire. L'enjeu d'une usurpation reste
   faible : un libellé « Scraping », et les offres échues de ce seul e-mail écartées.
3. **Offres échues** : une offre de la veille dont la date limite, **désignée comme telle par le texte**
   (`deadlineFromText`, posé par `parse.ts`), est antérieure au jour du traitement n'est pas créée (`isPastDeadline`),
   et l'e-mail le note. Une date sans libellé classée en date limite par son jour de la semaine ne suffit pas (la veille
   n'écrit d'ailleurs plus la date de publication). Vérifié après la reprise d'un essai interrompu du même e-mail, qui
   complète toujours l'offre déjà créée. La règle ne s'applique pas aux autres e-mails : leur date limite
   peut venir d'une date sans libellé classée par son jour de la semaine (ADR 0004), et une erreur ferait perdre une
   offre réelle (décision du 23/10/2026). La veille écarte aussi d'elle-même les offres échues avant l'envoi.
4. **Canal** : enregistré dans `ao_offer_details.channel` (« scraping » ; absent pour un e-mail ordinaire, qui
   n'écrit pas l'attribut). Le document de détails est toujours créé pour une offre de la veille.
5. **Colonne « Source »** : « E-mails AO » ou « Scraping » au lieu du nombre d'e-mails ayant apporté l'offre ; ce
   nombre reste dans la carte « Doublons fusionnés » et le panneau de détail, qui indique aussi la source. Largeur
   d'affichage inchangée (dès 1536 px).

## Conséquences

- Mise en place sur chaque projet Appwrite : `npm run ao:setup -- <env> --apply` (attribut `channel`, 4/16 dans
  `ao_offer_details`) **avant** de déployer ce code. Fait sur DEV le 23/10/2026 ; à faire sur PROD à la mise en
  production (étape humaine).
- Chaque offre de la veille coûte une extraction par l'IA, comme tout e-mail. Le premier envoi de la veille
  (environ 780 offres en octobre 2026) s'étale sur plusieurs jours (200 par passage côté veille ; 25 e-mails par
  passage planifié ici).
- Une offre déjà reçue par e-mail avant d'être relevée par la veille garde la source « E-mails AO » (premier
  e-mail), et inversement : le canal est celui du premier e-mail, comme l'expéditeur affiché.
- Avant de publier une offre de la veille, vérifier que c'est une mission que l'on peut pourvoir (une offre d'emploi
  d'un organisme public est un recrutement de cet organisme) et les conditions de réutilisation de sa source (voir
  l'ADR 0003 du projet `veille-marches-emplois`).
