# 0005 — AO Offers : boîtes de réception par organisation

- Statut : accepté (phase A : socle serveur et migration ; phases B à D : écrans)
- Date : 2026-10-21

## Contexte

AO Offers ne lisait qu'une boîte, `ao@wise-associates.fr`, configurée par variables d'environnement (`AO_IMAP_*`).
L'application est multi-organisations : chaque organisation doit pouvoir faire lire ses propres boîtes, et nous
voulons pouvoir en lire d'autres que `ao@`. L'IA qui lit les e-mails est à nos frais : les organisations la paient
par leur abonnement.

## Décision (avec le métier, 2026-10-21)

- **Qui configure** : le propriétaire de l'organisation (`tenants.recruiterId`) saisit ses boîtes IMAP (serveur,
  identifiant, mot de passe, dossier) ; plusieurs boîtes par organisation. Authentification par mot de passe.
- **Qui voit** : tous les recruteurs de l'organisation voient et publient ses offres AO (en offres de leur
  organisation). L'admin de la plateforme voit et exporte les offres de toutes les organisations (filtre par
  organisation), sans agir sur elles ; il garde la main sur les boîtes de la plateforme.
- **Qui a droit** : organisations dont l'abonnement est `active` ou `trialing`, offre gratuite comprise — décision
  prise en sachant que l'inscription publique crée les organisations en `free` / `active` (`canUseAoSourcing`, une
  seule fonction à modifier quand les offres seront unifiées), et la plateforme. Une organisation créée par l'admin
  n'a pas de statut : la passer « active » dans Admin → Abonnements.
- **Stockage** : collection `ao_sources` (une boîte par document, `tenantId` « admin » pour la plateforme).
  `ao_offers` étant à 16/16 attributs, une offre est rattachée à son organisation par son e-mail :
  offre → `emailId` → `ao_emails.sourceId` → `ao_sources.tenantId`.
- **Secrets** : mot de passe chiffré AES-256-GCM avec `AO_CREDENTIALS_KEY` (serveur seulement), lié à sa boîte, à
  son serveur et à son identifiant (changer le serveur oblige à ressaisir le mot de passe : il ne peut pas être
  envoyé à un autre serveur sans être connu) ; jamais renvoyé au navigateur. C'est le premier secret saisi par une organisation : pas de stockage
  en clair, contrairement aux clés de Config IA (à corriger à part).
- **Serveur saisi par une organisation** : nom d'hôte dont toutes les adresses sont publiques (ni privées, ni
  locales, ni réservées), port 993 avec TLS et certificat vérifié, connexion à l'adresse vérifiée (SNI = nom) :
  une organisation ne peut pas faire sonder notre réseau interne par le serveur. Réponses bornées à 26 Mo, connexion
  coupée après 150 s : un serveur hostile ou lent ne retient pas le passage des autres.
- **Isolation** : e-mails suivis par boîte (index unique `sourceId` + `messageId` : le même appel d'offres envoyé à
  deux organisations est traité pour chacune) ; empreinte de dédoublonnage préfixée par l'organisation (celles de la
  plateforme gardent leur forme, déjà en base) ; verrou de synchronisation et compteurs quotidiens (lectures
  d'images, offres de tableaux) par organisation ; la règle « expéditeur d'origine » (ADR 0004) écarte les domaines
  de l'organisation de la boîte, et la consigne de l'IA son nom.
- **Passage planifié** : toutes les organisations ayant droit, celle dont une boîte a été tentée le moins récemment
  d'abord (tentative notée avant la lecture : une boîte qui fait échouer le passage passe en fin de file), 2 minutes
  au plus chacune. Une boîte en erreur est journalisée et notée (`lastError`) sans arrêter les autres ; si toutes les
  boîtes tentées échouent, la route cron répond 502. L'IA indisponible arrête tout le passage (elle est commune).
- **Admin** : n'agit que sur les boîtes de la plateforme (vérifié avant toute écriture) ; l'affichage des offres des
  organisations (lecture et export seulement) vient en phase D.

## Conséquences

- **Mise en place** (développement maintenant, production lors de la mise en production) :
  1. Arrêter tous les déclencheurs : `npm run ao:poll:stop`, le worker IMAP IDLE (`ao-idle`, branche `ao-realtime`),
     les autres previews qui embarquent l'ancien code AO (ou leur retirer les variables AO) ; pas de « Synchroniser ».
  2. Sauvegarder la base Appwrite (dump MariaDB, ou export de `ao_emails` et `ao_sync_state`).
  3. `AO_CREDENTIALS_KEY` (la même partout) et `APPWRITE_COLLECTION_AO_SOURCES` définies (fichier local et Vercel).
  4. `npm run ao:setup -- <env>` (simulation : `ao_emails` à 16/16), puis `--apply` (attend que les index soient
     « available »).
  5. `npm run ao:migrate-sources -- <env> --apply` : boîte de la plateforme, e-mails rattachés. L'ancien index unique
     sur `messageId` est **gardé** : tant qu'il existe, l'ancien code ne peut pas créer de doublon que le nouveau ne
     verrait pas. Le script détient les verrous de synchronisation (ancien et nouveau) pendant qu'il tourne.
  6. Déployer, puis relancer `ao:migrate-sources --apply` (déclencheurs toujours arrêtés) : 0 e-mail attendu.
  7. Vérifier : un « Synchroniser » ne laisse pas d'erreur sur la boîte de la plateforme ; redémarrer les déclencheurs.
  8. Avant la phase B, quand plus aucun ancien code ne peut écrire : `ao:migrate-sources --apply --drop-old-index`
     (refusé tant qu'un e-mail est sans boîte). Sans cette étape, un même e-mail reçu par deux organisations ne
     serait traité que pour la première.
  Mot de passe de la plateforme erroné ou changé : `--apply --reseal`. Ne jamais supprimer la boîte de la plateforme
  pour la recréer : ses e-mails y sont rattachés par son identifiant.
- **Retour arrière** : l'ancien code fonctionne sur le nouveau schéma (il ignore `sourceId`) tant que l'ancien index
  existe ; garder `AO_IMAP_*` dans Vercel et les documents `sync_lock` / point de reprise de `ao_sync_state`.
- `ao_emails` est à 16/16 attributs : une donnée de plus devra aller dans une autre collection.
- Perdre ou changer `AO_CREDENTIALS_KEY` rend les mots de passe illisibles : les boîtes passent en erreur et doivent
  être ressaisies (pas de rotation automatique en phase A) ; une clé absente fait échouer tout le passage.
- Offre gratuite comprise : aucune limite quotidienne d'e-mails lus par l'IA par organisation (seulement images /
  PDF scannés et lignes de tableaux) ; à ajouter si le coût le demande.
- Le passage planifié lit les organisations l'une après l'autre dans un budget de 4 minutes : au-delà d'une
  dizaine d'organisations actives, il faudra des passages plus fréquents ou en parallèle (voir aussi le worker IMAP
  IDLE de la branche `ao-realtime`).
- Le point de reprise de la boîte de la plateforme repart de zéro : le premier passage relit 7 jours, sans
  retraiter les e-mails déjà suivis.
