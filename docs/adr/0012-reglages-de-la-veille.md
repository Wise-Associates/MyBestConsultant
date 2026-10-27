# 0012 — Réglages de la veille marchés et emplois dans l'admin

- Statut : accepté
- Date : 2026-10-27

## Contexte

Le projet `veille-marches-emplois` (scanner lancé par GitHub Actions, ADR 0008) relève les appels d'offres et offres
d'emploi d'organismes publics et les envoie à la boîte AO. Ses organismes suivis, ses sources et son filtre
informatique étaient écrits dans son code : chaque changement demandait un développeur. Demande : les régler depuis
l'admin de MyBestConsultant, stockés dans Appwrite.

## Décision

- **Page `/admin/veille`** (menu « Veille », admin seulement) : onglets Organismes (nom, suivi ou non, règles de
  reconnaissance des acheteurs : SIREN, noms, exclusions, texte exigé, raison), Sources (BOAMP, TED et sites intégrés :
  activés ou non ; Choisir le service public : codes ; flux RSS de sites carrières) et Filtre informatique. Une
  copie locale est modifiée, puis « Enregistrer » crée la version suivante : jamais de réglages à moitié modifiés.
- **Stockage en versions** : collection `veille_config` (aucune permission client), un document `v<numéro>` par
  enregistrement (réglages en JSON, 100 000 caractères au plus, auteur), le plus récent en vigueur, 50 gardés.
  Un enregistrement part de la version affichée : si une autre a été enregistrée entre-temps (autre onglet, autre
  admin), il est refusé (même identifiant de document, index unique sur `version`) et l'admin recharge. Choix d'un
  document JSON plutôt que de collections par organisme ou par source : réglages petits, toujours lus en entier,
  modifiés ensemble, et historique gratuit.
- **Validation** : `src/lib/veille/config.ts` (règles pures, testées), appliquée à l'enregistrement, au chargement et
  par le script de chargement ; même format que le scanner (`src/settings/veille-settings.ts`, `schemaVersion`).
  Identifiants (clés d'état du scanner) fixés à la création, sources rattachées à un organisme existant, BOAMP, TED et
  sites intégrés toujours présents (désactivables), flux en https sur un nom de domaine public.
- **Lecture par le scanner** : `GET /api/veille/config` avec `Authorization: Bearer $VEILLE_CONFIG_TOKEN` (32 caractères
  au moins, comparé en temps constant, `hasBearerSecret` de `src/lib/cron-auth.ts`), qui ne renvoie que la version en
  vigueur. Pas de clé Appwrite côté scanner : une clé ne se limite pas à une collection.
- **Premier chargement** : `npm run veille:seed -- <env> --file ../veille-marches-emplois/config/defaults.json`
  (simulation, puis `--apply` ; `--prod` pour la production, par un humain) : la version 1, si aucune n'existe.
- **Mots-clés des appels d'offres** (ajout du 2026-10-27, ADR 0006 du scanner) : quatrième onglet, champ
  `tenderKeywords` (tous les acheteurs oui / non, familles d'expressions et de sigles, « infrastructure seule »), avec
  une valeur par défaut (recherche limitée aux organismes suivis) : les versions enregistrées avant restent lisibles et
  `schemaVersion` reste 1 (un scanner plus ancien ignore le champ). Sur DEV, ajoutés à la version 1 par un script
  ponctuel (version 2) ; la production les reçoit avec son premier chargement (`config/defaults.json` du scanner).
  Le 2026-10-27, le scanner a resserré la règle d'envoi (ADR 0007 du scanner : code CPV principal informatique et
  mot-clé dans l'intitulé) sans changer le format ; seuls les textes des onglets ont changé ici.

## Conséquences

- Mise en place, DEV : `npm run schema:push -- dev` (collection `veille_config`, dans un terminal), variable
  `APPWRITE_COLLECTION_VEILLE_CONFIG`, `veille:seed --apply`, `VEILLE_CONFIG_TOKEN` (portée Preview) ; production : un
  humain sauvegarde la base, `schema:check -- prod` (seule différence : la collection) puis `schema:push -- prod`,
  `veille:seed -- .env --file … --prod` (simulation) puis `--prod --apply`, variables en portée Production, déploiement,
  puis les secrets `VEILLE_CONFIG_URL` / `VEILLE_CONFIG_TOKEN` du scanner.
- **`schema:push` arrêté en cours de création** de `veille_config` (collection créée, attribut ou index manquant) : un
  nouveau `schema:push` refuse alors tout (attribut obligatoire ou index unique ajoutés à une collection existante), y
  compris pour les autres collections. La collection est vide : la supprimer dans la console, puis relancer.
- **Auteur des versions** : nom et identifiant de l'admin (jamais son e-mail), gardés aussi longtemps que la version
  (50 versions au plus ; tant que personne n'enregistre, les anciennes restent).
- Un changement s'applique au passage suivant du scanner. MyBestConsultant indisponible : le scanner garde la dernière
  version qu'il a lue (ADR 0005 du scanner) et le signale.
- Changer le format = les deux projets en même temps, `schemaVersion` augmenté si un ancien scanner ne peut pas lire le
  nouveau format (il garderait alors sa dernière version connue, en le signalant).
- Retour arrière : retirer la page et la route ne gêne pas le scanner (il garde sa dernière version) ; la collection
  peut être supprimée une fois le scanner repassé sur `config/defaults.json` (exporter d'abord les versions si besoin ;
  `schema:push` ne supprime jamais : console, puis `schema:pull` sur DEV). Revenir sur le code après un changement de
  `schemaVersion` : la page et la route refuseraient les versions au nouveau format ; les exporter puis les supprimer
  dans la console. Aucune restauration d'une ancienne version depuis la page : la ressaisir. Revenir sur le code
  d'avant les mots-clés : la page lirait les versions en ignorant `tenderKeywords`, et un enregistrement les
  supprimerait (le scanner reviendrait aux seuls organismes suivis).
