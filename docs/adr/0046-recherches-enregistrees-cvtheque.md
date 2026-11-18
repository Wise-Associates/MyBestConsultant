# 0046. Recherches enregistrées de la CV Thèque et alertes

Date : 2026-11-18. Statut : accepté.

## Contexte

Le PO a demandé le 2026-11-18 une fonction « Search & Alerts » en deux phases (document
`MyBestConsultant_Search_Alerts_AI_Job_Matching.md`). Cet ADR couvre la **phase 1**. La phase 2, la notation automatique
des nouveaux candidats sur les offres ouvertes, s'appuie sur l'ADR 0045.

Besoin de la phase 1 : le recruteur enregistre les filtres de la liste des candidats, puis il est prévenu par e-mail
quand un **nouveau candidat** y répond. La comparaison se fait par les filtres, sans IA. La source est la base candidats
de MBC, pas Apollo.

Décisions prises avec l'utilisateur après l'analyse du projet, le 2026-11-18 :

- la « section Candidats » est la **CV Thèque** (`/recruiter/cvtheque`), la seule liste des candidats de la base. MBC
  Search cherche dans Apollo ;
- les mots sont comparés **en entier**, dans la CV Thèque comme dans les alertes : une recherche enregistrée doit
  redonner exactement la liste vue par le recruteur ;
- la production est sur le VPS (ADR 0027) : le rattrapage passe par la crontab, toutes les 10 minutes, sans file de
  tâches dédiée.

## Décision

### Recherche et filtres

- **Comparaison par mot entier** (`words`, `hasPhrase`, `src/lib/cvtheque-search.ts`) :
  - un mot est une suite de lettres, de chiffres, de « + » et de « # » (C++, C#) ; tout le reste sépare ;
  - « Java » ne trouve plus « JavaScript ». « node » trouve « Node.js » et « spring » trouve « Spring Boot », mais
    « react » ne trouve plus « ReactJS » ;
  - un terme sans lettre ni chiffre (« / », « & ») est ignoré : sinon il répondrait à tous les profils, et l'exclusion
    « stagiaire / alternant » viderait la liste ;
  - la règle s'applique à la barre de recherche, aux compétences, aux langues, à l'entreprise, à la formation, aux
    intitulés et aux expériences. Le lieu garde sa règle par régions (`regions.ts`).
- **Filtres dans l'adresse** de la CV Thèque :
  - paramètres : `q`, `exclure`, `dispo`, `ajout`, `exp`, `rayon`, `lieu`, `competence`, `secteur`, `langue`,
    `entreprise`, `ecole`, `intitule`, `experiences` ;
  - écriture par `history.replaceState`, adresse reprise par `url-list-state.ts` ;
  - fonctions : `filtersFromSearchParams` et `withFilters`. L'adresse et le document enregistré sont lus comme non fiables
    (`sanitizeFilters` : longueurs et nombre de valeurs bornés).

### Recherches enregistrées

- Collection **`saved_searches`** : 9 attributs sur 16, aucune permission client, index `ownerId` et `active`.
  - Contenu : organisation, auteur (profil `users.$id`), nom (100), description (500), filtres en JSON (`filtersJson`),
    `active`, `emailAlerts`, `lastMatchAt`, `lastOpenedAt`.
  - Une recherche est **personnelle**.
  - 50 recherches au plus par recruteur (`SAVED_SEARCHES_MAX`). Le plafond est revérifié après l'écriture : des demandes
    parallèles passent toutes le premier contrôle.
  - `filtersJson` fait 10 000 caractères ; des filtres plus longs sont refusés avec un message (`FILTERS_JSON_MAX`).
- **Adresse e-mail vérifiée exigée** pour créer ou modifier une recherche, ou pour activer une recherche ou ses e-mails
  (revue de sécurité du 2026-11-18). Retirer ou couper reste permis.
  - Raison : l'inscription est libre. Un compte ouvert avec l'adresse d'un tiers lui ferait envoyer par la plateforme
    le texte de ses recherches et des données de candidats.
  - La même règle vaut au moment de l'envoi (`loadOwner`). Elle vaut aussi pour les alertes « profil idéal » de
    l'ADR 0045 : sans adresse vérifiée, l'alerte reste dans la page, sans e-mail.
- **Liste de la CV Thèque** : les 500 candidats avec CV **les plus récents**. Avant, elle lisait 500 candidats sans
  ordre et comptait le CV après la limite. Un candidat signalé par une alerte figure donc toujours dans la liste.
- Une recherche doit avoir **au moins un critère qui retient des profils** (`hasSearchCriteria`). Avec seulement
  « disponibles », « ajoutés depuis » ou une exclusion, chaque nouveau candidat déclencherait une alerte.
- **CV Thèque** :
  - « Nouvelle recherche » vide les filtres et ferme la recherche ouverte ;
  - « Enregistrer la recherche » ouvre une fenêtre : nom obligatoire, description, e-mails activés par défaut, rappel des
    critères ;
  - une recherche ouverte affiche « Modifier la recherche », puis « Enregistrer les modifications » ou « Enregistrer
    comme nouvelle recherche ».
- **Page « Alertes »** (`/recruiter/alertes#recherches`) : chaque recherche avec son nom, sa description et ses critères
  (`filtersSummary`).
  - Chiffres affichés :
    - les candidats qui y répondent **aujourd'hui**, recalculés sur toute la base et pas seulement sur les 500 de la
      liste ;
    - les nouvelles correspondances depuis la dernière ouverture ;
    - les dates de création et de dernière correspondance, et l'état.
  - Actions :
    - Ouvrir : la CV Thèque avec `?recherche=<id>` et ses filtres, recalculée sur la base actuelle ;
    - Activer ou désactiver, couper les e-mails ;
    - Supprimer : ses alertes restent, affichées « Recherche supprimée ».
- **Actions serveur** : `src/app/recruiter/cvtheque/saved-search-actions.ts`.
  - Chacune vérifie le recruteur de la session.
  - La recherche d'un autre est « introuvable ».
  - Entrées validées : `SavedSearchInputSchema`, identifiants contrôlés.

### Alertes

- **Quand** : juste après le dépôt d'un CV par le candidat (`saveCvFileId`), après une modification de son profil
  (`updateCandidateProfile`) et après une relecture du CV par l'admin (`scanCandidateCv`).
  - `newCv` vaut vrai pour un **premier** CV seulement. Un CV remplacé ne rend pas le candidat nouveau : le recruteur le
    voyait déjà.
  - Le tout tourne en `after()` : le candidat n'attend ni la comparaison ni les e-mails.
- **Règle** (`shouldAlert`, `src/lib/saved-searches.ts`) :
  - la recherche est active et a des critères ;
  - le candidat passe ses filtres, avec la règle de la liste (`filterCandidates`). Une information absente, comme les
    années d'expérience ou le rayon, ne l'écarte pas, comme dans la liste ;
  - il est **nouveau pour elle** : inscrit après sa création, ou qui vient de déposer son CV. Un candidat déjà dans la
    liste au moment de l'enregistrement, donc déjà vu, ne déclenche rien quand il modifie son profil.
- **Une alerte par recherche et par candidat**.
  - Elle va dans la collection `recruiter_alerts` (ADR 0045), source `recherche`, avec `searchId`.
  - Son identifiant est fixe (`searchAlertDocId`) : une seconde création échoue en 409, donc pas de doublon même si la
    comparaison est rejouée.
- **Un e-mail par recruteur et par candidat**, qui liste toutes les recherches retenues (`savedSearchEmail`).
  - Contenu : nom, poste, lieu, expérience et compétences du candidat, c'est-à-dire ce que la CV Thèque montre déjà à
    tout recruteur.
  - Liens : le profil (`/recruiter/candidate-preview/pool/<id>`) et la page des alertes.
  - Envoi par Appwrite Messaging, au compte Auth du recruteur.
- **Destinataire** : l'auteur de la recherche, s'il est toujours recruteur de la même organisation, que son compte est
  actif et que son adresse est vérifiée. Sinon, aucune alerte.
- Les alertes déjà enregistrées sont lues d'abord, en une requête. Le cron repasse ainsi sur les mêmes candidats sans
  relire le recruteur ni tenter d'écritures vouées au 409.
- **Suivi de l'envoi** sur l'alerte : `emailStatus` (`pending`, `sent`, `failed`, `off`), `emailedAt`, `emailError`
  (300 caractères) et `emailAttempts`.
- **Rattrapage** : `GET /api/cron/recruiter-alerts`, avec le secret du cron, toutes les 10 minutes (`deploy/crontab`).
  1. Les e-mails en échec, ou restés « en cours » plus de 15 minutes, des dernières 48 h sont renvoyés, 3 essais au plus
     (`isRetryDue`, `MAX_EMAIL_ATTEMPTS`). Ils passent en premier, pour qu'un rattrapage long ne les prive pas de leur
     essai.
  2. Les candidats modifiés depuis 6 h (500 au plus, dépassement journalisé) sont comparés de nouveau. Une coupure du
     serveur de quelques heures est encore rattrapée. Sans `newCv`, seul un candidat inscrit après la recherche peut
     alerter.
  - Un envoi interrompu juste après le départ de l'e-mail, ou dont l'état « envoyé » n'a pas pu être écrit, peut partir
    deux fois. C'est choisi plutôt qu'un e-mail perdu.
  - Le rattrapage ne tourne que sur le VPS : « Déployer en production » y déploie chaque jour, et le domaine ne pointe
    plus vers Vercel (vérifié le 2026-11-18). Sur la preview `pre-dev`, appeler la route à la main avec `CRON_SECRET`.
- **Une alerte ne fait jamais échouer le dépôt d'un CV** : chaque erreur est journalisée (`[recherches]`).
- **Suppression** :
  - recherches supprimées avec le compte (`deleteUserAccount`, avant le compte, l'échec bloque) et au retrait d'un membre
    (`removeMember`), puis une seconde fois après le compte, comme les personnes enregistrées de MBC Search ;
  - leurs alertes restent, comme celles de l'ADR 0045.

### Changements de la collection `recruiter_alerts` (pas encore créée, ADR 0045)

- `jobId` et `score` deviennent facultatifs : une alerte de recherche n'a ni offre ni score.
- Ajouts : `searchId` (index `searchId_idx`), `emailedAt`, `emailError`, `emailAttempts`. La collection passe à
  12 attributs sur 16.

## Conséquences

- La CV Thèque change pour tous : « Java » ne trouve plus « JavaScript », « react » ne trouve plus « ReactJS ». Elle
  montre désormais les 500 candidats avec CV les plus récents.
- Le nombre de la page « Alertes » porte sur toute la base : au-delà de 500 candidats, il peut dépasser ce que la liste
  montre.
- L'extraction du profil au dépôt du CV reste faite pendant que le candidat attend (code d'avant). Seules la comparaison
  et les e-mails passent en arrière-plan.
- Un candidat inscrit avant une recherche n'est pas signalé dans deux cas : sa comparaison au dépôt du premier CV a
  échoué, ou l'extraction de ce CV a échoué et le profil a été rempli ensuite. « Nouveau » dépend du moment du dépôt,
  que le cron ne connaît pas. La collection `users` a 19 attributs : on n'y ajoute pas de date de dépôt.
- L'adresse e-mail doit être vérifiée : un recruteur qui ne l'a pas fait ne peut pas enregistrer de recherche.
- La page « Alertes » relit tous les candidats avec un CV pour compter les correspondances. À surveiller si la base
  grossit beaucoup.

### Mise en place, dans cet ordre

1. `npm run schema:push -- dev` : collections `saved_searches` et `recruiter_alerts`. Vérifier dans la console que les
   attributs sont « available ».
2. Les variables `APPWRITE_COLLECTION_RECRUITER_ALERTS=recruiter_alerts` et
   `APPWRITE_COLLECTION_SAVED_SEARCHES=saved_searches` (fichier local, portée Preview de Vercel). Sans elles,
   « Enregistrer la recherche » n'apparaît pas et le cron répond `configured: false`.
3. Le déploiement.

Production, par un humain :

1. sauvegarde, `schema:check -- prod` (relire chaque ligne « + » : le push envoie tous les ajouts en attente),
   `schema:push -- prod`, puis vérifier que les attributs sont « available » ;
2. les deux variables dans `/etc/mybestconsultant/app.env` ;
3. la mise en production, qui installe aussi la nouvelle crontab ;
4. vérifier `journalctl -t mbc-cron` : `recruiter-alerts : HTTP 200`.

Ne jamais définir les variables avant la création des collections : la suppression d'un compte de recruteur serait
refusée.

### Retour arrière

- Retirer les deux variables et redéployer : tout le code devient sans effet, et les collections restent.
- Ou bien exporter les collections, puis les supprimer **dans la même opération** que le retrait des variables.
- Ne jamais retirer `APPWRITE_COLLECTION_SAVED_SEARCHES` seule tant que `saved_searches` contient des recherches : la
  suppression avec le compte en dépend.
- Conservation de `recruiter_alerts` : aucune purge pour l'instant (ADR 0045). À décider, par exemple 12 mois.
