# 0048. Bandeau « session expirée » du scraper Partenaire GC

Date : 2026-11-19. Statut : accepté.

## Contexte

Le scraper d'appels d'offres (dépôt `french-tender-scraper`, sur le même serveur que la production) lit l'espace abonné
de Partenaire GC avec une session ouverte à la main : le formulaire de connexion refuse les robots, et la session expire
environ toutes les trois semaines. Tant qu'elle n'est pas renouvelée, aucune offre Partenaire GC n'arrive dans la boîte
AO. Le scraper prévenait déjà par e-mail (son ADR 0005) ; demande du 2026-11-19 : « l'e-mail ne suffit pas », un
bandeau d'alerte sur `/admin/candidats`, la page où l'équipe traite les offres chaque jour.

Le scraper tourne dans un conteneur sans port publié et son API n'a pas d'authentification : MyBestConsultant ne peut
pas l'interroger. La veille envoie déjà ses rapports de passage à MyBestConsultant (ADR 0030).

## Décision

- **Le scraper envoie l'état** après chaque passage d'un site à session manuelle : `POST /api/scraper/status`,
  `{ schemaVersion: 1, site, state: "ok" | "session_expired", checkedAt }` (format :
  `src/lib/veille/scraper-status.ts`, même format que `src/alerts/mbc-status.ts` du scraper, modifiés ensemble).
  « Expirée » quand le passage s'arrête sur la session ; « ok » quand la liste et les pages d'offres ont été lues ; une
  autre panne (site indisponible) n'envoie rien : le dernier état connu reste.
- **Jeton propre** `SCRAPER_STATUS_TOKEN` (32 caractères au moins, `hasBearerSecret`), distinct de
  `VEILLE_CONFIG_TOKEN` (la route refuse s'ils sont égaux) : il ne permet que d'écrire cet état, pour un site de la
  liste fermée `SCRAPER_SITES` (aujourd'hui `partenaire-gc`) dont le nom affiché est fixé par MyBestConsultant —
  même un jeton divulgué ne peut ni créer d'autres documents, ni écrire le texte d'un bandeau de l'admin. Nouveau site
  à session manuelle dans le scraper : l'ajouter à `SCRAPER_SITES`. Corps lu jusqu'à 2 000 octets, validé (format, contrôle
  dans les 2 derniers jours, 10 minutes de décalage d'horloge tolérées), erreurs sans la valeur reçue.
- **Stockage** : collection `scraper_status` (aucune permission client, `src/lib/veille/scraper-status-store.ts`,
  `server-only`), un document par site identifié par sa clé (`partenaire-gc`) : état, `since` (premier contrôle qui a
  constaté l'état actuel), `checkedAt` (dernier contrôle). Un état pas plus récent que celui gardé est
  ignoré : une nouvelle tentative ou un envoi arrivé dans le désordre ne ramène jamais un état passé.
- **Affichage** : bandeau rouge (`Banner`, comme les boîtes en erreur) en tête de `/admin/candidats` pour chaque site
  dont la session est expirée, avec la date du constat, la commande à lancer et le dernier contrôle
  (`scraperSessionAlerts`, pur, testé). Lu en même temps que les offres ; une lecture impossible devient un bandeau, les
  offres restent affichées. Collection non configurée : pas de bandeau. Admin seulement (la page recruteur ne le reçoit
  pas : seule la plateforme reçoit les offres du scraper).

## Conséquences

- Mise en place, dans cet ordre (DEV puis production, production par un humain) : 1. `npm run schema:push -- dev|prod`
  (collection `scraper_status`), puis `schema:check` qui ne doit plus la lister ; 2. **seulement ensuite**
  `APPWRITE_COLLECTION_SCRAPER_STATUS=scraper_status` et `SCRAPER_STATUS_TOKEN` (fichier local, portée Preview de
  Vercel pour `pre-dev`, `/etc/mybestconsultant/app.env` sur le VPS) ; 3. déployer ce code ; 4. **en dernier**,
  `MBC_STATUS_URL` et `MBC_STATUS_TOKEN` dans `scraper.env` du scraper. Scraper configuré avant MyBestConsultant : il
  journalise des refus (401, 503) et prévient son opérateur par e-mail, sans autre effet. Variable de collection définie
  avant que la collection existe : chaque envoi répond 500 et `/admin/candidats` affiche « État de la session …
  indisponible » — rien n'est abîmé ; retour arrière : retirer la variable (route en 503, plus de bandeau ; la
  collection peut rester, sinon la retirer aussi de `appwrite.config.json`).
- Un site retiré du scraper alors que sa session était expirée garde son bandeau : supprimer son document dans la
  console.
- Le bandeau reste jusqu'au premier passage qui relit le site (4 par jour) : quelques heures après la reconnexion au
  plus, ou tout de suite avec `tender-scraper-deploy run`.
- Un scraper arrêté laisse son dernier état affiché : ce bandeau ne détecte pas un scraper qui ne tourne plus.
