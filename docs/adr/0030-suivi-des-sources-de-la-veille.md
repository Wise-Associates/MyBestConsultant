# 0030 — Suivi des sources de la veille dans les statistiques AO

- Statut : accepté
- Date : 2026-11-10

## Contexte

Le scanner `veille-marches-emplois` lit les sources réglées dans `/admin/veille` (BOAMP, TED, recherches chez tous les
acheteurs, Choisir le service public, flux RSS, sites intégrés) et envoie chaque offre à la boîte AO de la plateforme
(ADR 0008). MyBestConsultant ne savait pas de quelle source venait une offre : seulement le canal « Scraping ». L'état
de chaque source (lecture réussie ou en échec, annonces lues, écartées, envoyées) n'était connu que du journal du
scanner et de son récapitulatif par e-mail. Demande du 2026-11-10 : suivre les AO de chaque source configurée.

Seule la plateforme (`tenantId` « admin ») reçoit les offres de la veille, et aucun recruteur n'appartient à cette
organisation (chaque inscription crée la sienne) : le suivi est sur `/admin/candidats/statistiques`, pas sur la page
de statistiques des recruteurs (choix de l'utilisateur, 2026-11-10).

## Décision

1. **Source de chaque offre** : le scanner ajoute l'en-tête `X-Wise-Veille-Source: <identifiant>` (clé des réglages :
   `boamp`, `csp-dgfip`… ; `boamp-tous-acheteurs`, `ted-tous-acheteurs`). `imap.ts` le lit (`veilleSourceOf`,
   `src/lib/veille/run-report.ts` : identifiant `[a-z0-9-]{1,50}` sinon ignoré) ; `sync.ts` l'enregistre dans
   `ao_offer_details.veilleSource` **seulement pour un e-mail reconnu par `fromVeille`** (un en-tête s'écrit par
   n'importe qui). `ao_offers` étant plein, l'attribut va sur les détails (8/16).
2. **Rapport de passage** : après l'enregistrement de son état, le scanner envoie `POST /api/veille/runs` (à côté de
   `/api/veille/config`) avec le **même jeton** `VEILLE_CONFIG_TOKEN` : par source, statut, erreur, annonces lues,
   écartées hors informatique, nouvelles, envoyées, échues, en attente, alertes ; réglages utilisés ; erreur d'envoi.
   La route vérifie le jeton (`hasBearerSecret`, 32 caractères), lit au plus 100 000 octets (sans croire la taille
   annoncée), valide le format avec zod (`RunReportSchema`, même `schemaVersion` que `src/run/source-report.ts` du
   scanner) et les dates (passage commencé dans les 2 derniers jours, fini après son début, rien dans le futur au-delà
   de 10 minutes : un rapport daté de 2099 resterait sinon « le dernier passage » et ferait supprimer les vrais) et l'enregistre dans `veille_runs` (aucune permission client). **Idempotente** : document
   `run_<début du passage>`, un rapport renvoyé (nouvelle tentative) répond `{ ok: true }` sans rien réécrire. 120
   passages gardés (un mois à quatre par jour).
3. **Affichage** (`src/lib/veille/monitoring.ts`, règles pures testées ; `src/components/ao/veille-monitoring.tsx`) :
   une ligne par source des réglages (BOAMP et TED suivis de leur recherche chez tous les acheteurs) avec son état —
   OK, à vérifier (alertes), en échec (et depuis combien de passages), non lue au dernier passage (le scanner ne la lit
   plus : réglages de repli), jamais lue, désactivée (source ou organisme
   éteints, recherche chez tous les acheteurs coupée), retirée des réglages (gardée tant qu'elle a des passages ou des
   offres) —, sa dernière lecture réussie, les chiffres du dernier passage et, sur 30 jours, les annonces envoyées,
   écartées et échues (pas les « nouvelles » : une offre en attente redevient nouvelle à chaque passage), et les offres AO
   qu'elle a apportées par statut. Alertes générales : aucun rapport depuis 13 heures (la plus longue attente normale
   est de 12 heures, 17 h → 5 h UTC), réglages du dernier passage autres que ceux en vigueur, envoi interrompu.

## Options écartées

- **Jeton propre aux rapports** : plus étroit, mais une variable de plus sur les deux serveurs. Le jeton existant ne
  donnait que la lecture des réglages ; il permet en plus d'ajouter un rapport de suivi (pire usage : un faux rapport,
  sans effet sur les offres). Choix de l'utilisateur, 2026-11-10.
- **Déduire la source du lien de l'offre** : impossible de distinguer « BOAMP » de « BOAMP — tous les acheteurs », et
  rien pour les offres d'emploi lues sans lien stable. Les offres reçues avant ce changement restent « sans source
  connue », comptées à part.
- **Lire les chiffres dans le récapitulatif e-mail** : texte destiné à l'équipe, dont le format change librement.

## Conséquences

- **Mise en place, dans cet ordre, pour chaque projet** (DEV puis production ; la production par un humain) :
  1. `npm run schema:check` puis `npm run schema:push -- dev|prod` (attribut `ao_offer_details.veilleSource`, collection
     `veille_runs`) ; en production, après sauvegarde de la base, en relisant toutes les lignes du `schema:check` (il
     pousse aussi les autres ajouts en attente) ;
  2. `APPWRITE_COLLECTION_VEILLE_RUNS=veille_runs` une fois la collection créée (fichier local, portée Preview de Vercel
     pour `pre-dev`, `/etc/mybestconsultant/app.env` sur le VPS) — définie avant, la page affiche « Suivi des sources
     illisible » et la route répond 500 ;
  3. déployer ce code ;
  4. **en dernier**, le scanner (ADR 0012 du scanner), une fois **tous** les projets qui lisent la boîte AO à jour.
- Ordre non respecté : l'**ancien** code ignore l'en-tête et répond 404 aux rapports (signalé dans le récapitulatif du
  scanner, sans faire échouer ses passages). Mais **ce code sur un projet sans l'attribut `veilleSource`**, avec le
  scanner qui envoie déjà l'en-tête : Appwrite refuse l'attribut inconnu, l'offre reste créée sans ses détails (ni canal
  « Scraping », ni lien, ni source) et l'e-mail passe en erreur puis est abandonné. Réparation : pousser la structure,
  puis « Réessayer » sur chaque e-mail concerné (il complète les détails).
- **Retour arrière** : revenir sur le code de MyBestConsultant ou du scanner suffit ; l'attribut et la collection
  restent (`schema:push` ne supprime rien), `veille_runs` ne contient aucune donnée personnelle et est bornée à 120
  documents.
- Sans la variable, le tableau affiche « État des sites de la veille non suivi » (les offres restent comptées par site) et
  la route répond 503.
- Les offres de la veille dédoublonnées avec une offre déjà reçue n'ont pas de source à elles : le suivi compte les
  offres créées, comme les statistiques de la page.
- Un passage interrompu avant l'enregistrement de son état n'envoie pas de rapport : l'alerte « aucun rapport depuis
  13 heures » le révèle, en plus de l'alerte e-mail du scanner.

## Évolution du 2026-11-13 : par site source, filtres de période et de sites

Demande de l'utilisateur : le suivi par site source, pas par organisme, clair, filtrable par date, avec « Tout
sélectionner ». Choix validés le même jour : les filtres s'appliquent à toute la page, BOAMP et TED sont réunis avec leur
recherche chez tous les acheteurs, « E-mails AO » est une source à part entière, la page s'ouvre sur 30 jours.

- **Une ligne par site** (`siteOfSource`, `src/lib/veille/monitoring.ts`) : BOAMP, TED, « Choisir le service public »
  (toutes ses recherches, une par organisme, en détail repliable), chaque site carrières, « E-mails AO », « Veille,
  source non enregistrée ». État du site : le plus grave de ses recherches lues par le scanner (« En échec : 1 sur 7 »),
  avec le message de la recherche en cause. Une recherche retirée des réglages garde son site quand on le connaît
  (identifiant `csp-…` de /admin/veille, sites intégrés), sinon une ligne à son nom.
- **Filtres** (`src/lib/ao/stats-filters.ts`, formulaire GET `src/components/ao/stats-filters.tsx`) : période
  (7 jours, 30 jours, 12 mois glissants, ou dates ; jours UTC comme la liste AO ; 731 jours au plus) et sites. Les
  offres de la période sont lues par l'index de la liste (filtre de dates existant), puis filtrées par site ; chiffres,
  graphique dans le temps (jour, semaine ou mois selon la durée) et tableau les suivent.
- Les totaux « sur 30 jours » deviennent ceux **de la période**. Les chiffres de lecture ne remontent pas avant le plus
  ancien des 120 passages gardés : la page l'indique au lieu de laisser croire à zéro.
