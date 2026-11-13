# 0033 — Utilisateurs, abonnement et organisation dans l'espace recruteur

- Statut : accepté
- Date : 2026-11-13

## Contexte

L'équipe d'un recruteur se gérait sur « Mon équipe » : seul le propriétaire de l'organisation (`tenants.recruiterId`)
invitait, renvoyait une invitation ou retirait un collaborateur. L'abonnement n'était visible que de l'admin
(`/admin/subscriptions`) et de la page publique `/abonnement` ; le nom et le logo de l'organisation se modifiaient
seulement dans l'éditeur de la marque employeur, par tout membre. Demande du 2026-11-13 : en bas du menu latéral, une
page des utilisateurs de l'organisation (inspirée de la page Utilisateurs de l'admin), une page de l'abonnement et une
page de l'organisation ; le bouton « Réduire le menu » devient une icône.

## Décision

Choix de l'utilisateur (2026-11-13) : « Mon équipe » reste (historique de l'équipe, membres en lecture seule) et la
gestion des comptes passe sur « Utilisateurs » ; le propriétaire peut désactiver / réactiver un compte, transférer la
propriété et nommer des administrateurs ; « Abonnement » montre l'abonnement et ouvre le portail de facturation de
Stripe ; le propriétaire (et les administrateurs) modifient le nom et le logo.

1. **Rôles** (`src/lib/team-roles.ts`, pur, testé) : propriétaire (`tenants.recruiterId`, compte Auth, un seul),
   administrateurs (`tenants.adminUserIds`, comptes Auth), membres.
   - Inviter, modifier le nom et le logo, choisir une formule : propriétaire et administrateurs.
   - Renvoyer une invitation, désactiver, réactiver, retirer : le propriétaire sur tout autre compte, un
     administrateur sur les membres seulement ; jamais sur soi-même ni sur le propriétaire.
   - Changer un rôle, transférer la propriété, portail de facturation : le propriétaire seul ; rôle et transfert vers
     un compte actif seulement (invitation acceptée, compte non désactivé).
   - Transfert : le nouveau propriétaire sort de la liste des administrateurs, l'ancien devient membre. Les e-mails
     adressés au propriétaire (résultats d'entretien, réponses des candidats, liste de l'admin) partent au nouveau.
2. **Stockage des administrateurs** : attribut `tenants.adminUserIds` (texte, 36, tableau, facultatif), le 16e et
   dernier de `tenants`. Sur la collection plutôt que sur chaque profil : la liste se lit avec le document que les
   actions lisent déjà pour le propriétaire, et `users` dépasse déjà la règle des 16 attributs. Pas dans les
   préférences du compte Appwrite : un utilisateur peut écrire les siennes avec sa propre session et se nommerait
   administrateur. Sans l'attribut en base (`schema:push` pas fait), les rôles ne changent pas (message, journal
   « attribut tenants.adminUserIds absent ») ; le transfert ne touche alors que le propriétaire.
3. **Compte désactivé** : statut du compte Appwrite (`users.updateStatus`), sessions fermées
   (`users.deleteSessions`, sans faire échouer l'action : Appwrite refuse déjà les sessions d'un compte bloqué) ; la
   personne ne peut plus se connecter, ses données (offres affectées, vivier, historique) restent. Aucun changement de
   structure.
4. **Contrôles** : chaque Server Action (`src/app/recruiter/utilisateurs/actions.ts`) vérifie le recruteur de la
   session, relit l'équipe de **son** organisation, valide l'identifiant visé (`[\w-]{1,36}`), applique
   `teamActionDenial`, puis appelle `src/lib/team.ts`, qui revérifie que le compte visé est de l'organisation et n'en
   est pas le propriétaire (`requireMemberOfTenant`). L'organisation ne vient jamais du navigateur. Erreurs d'Appwrite
   journalisées, message générique au navigateur (`teamError`).
5. **Abonnement** (`/recruiter/abonnement`, règles d'affichage `src/lib/subscription-view.ts`, testées) : formule
   (noms de Stripe et de l'admin), état, montant, date de début, fonctions réservées ouvertes ou non ; « Changer de
   formule » (`/abonnement`) pour le propriétaire et les administrateurs ; « Factures et moyen de paiement » ouvre le
   portail Stripe du client de l'organisation (`openBillingPortalAction` : propriétaire seul, client lu dans
   l'organisation de la session, adresse de retour fixe, 15 s au plus). Payé par carte = client Stripe **et** formule
   de Stripe (écrite par le webhook après un paiement réussi) : le client est créé dès l'ouverture du paiement. Notes
   de l'admin jamais montrées.
6. **Organisation** (`/recruiter/organisation`) : nom, logo, page publique, propriétaire, date de création, nombre
   d'utilisateurs, formule, rôle de la personne connectée. Nom et logo modifiables par le propriétaire et les
   administrateurs (`saveOrganisationAction` : nom de 2 à 120 caractères, logo du bucket des logos seulement) ; le
   slug ne change jamais (liens publics stables).
7. **Revue de sécurité du 2026-11-13** :
   - Invitation : le jeton est dans les préférences du compte, que l'utilisateur peut réécrire avec sa propre session ;
     elle exige désormais aussi l'étiquette `invited`, posée par le serveur (`inviteMember`, `resendInvite`) et retirée
     à l'acceptation. Sans elle, n'importe qui se fabriquait une invitation pour faire vérifier son adresse, et un membre
     se faisait passer pour une invitation en attente, qu'on ne peut pas désactiver. État d'un compte : désactivé
     d'abord, puis en attente (étiquette, ou jeton sur un compte jamais utilisé : invitations d'avant l'étiquette, qui
     la reçoivent au prochain « Renvoyer » ; leur ancien lien ne marche plus).
   - Le lien d'invitation n'est rendu à celui qui invite que si l'e-mail n'est pas parti.
   - Rôle d'administrateur et transfert : compte revérifié actif juste avant l'écriture ; liste des administrateurs
     relue juste avant la mise à jour qui suit un retrait.
   - Nom et logo : la même règle dans l'éditeur de la marque employeur (`saveBrandAction` : un membre enregistre le
     reste de la page, pas un nom ou un logo changés ; champs en lecture seule pour lui) ; logo = fichier du bucket des
     logos du projet seulement (`isLogoFileUrl`, `brand.ts`, testé : origine et chemin résolu).
   - Choisir une formule (`startSubscriptionCheckout`) : propriétaire et administrateurs.
8. **Menu** (maquette du 2026-11-13) : organisation, utilisateurs et abonnement sont les rubriques du groupe `compte`
   de `recruiter-nav.ts`, derrière le **sélecteur de l'organisation** en bas de la colonne (son nom et une flèche ; un
   petit menu s'ouvre au-dessus), à côté de l'icône qui réduit ou rouvre le menu ; menu réduit : les deux boutons
   empilés, le menu s'ouvre à droite. Dans la liste des écrans étroits, sous un titre « Compte ».

## Conséquences

- **Mise en place** : `npm run schema:push -- dev` (attribut `tenants.adminUserIds`) avant ou avec le déploiement ;
  production : `schema:check -- prod` puis `schema:push -- prod` par un humain. Aucune variable d'environnement
  nouvelle ; le portail Stripe doit être activé dans le tableau de bord Stripe (Paramètres → Portail client), sinon le
  bouton affiche « Portail de facturation indisponible ».
- Invitations en attente envoyées avant ce changement : leur lien ne marche plus, « Renvoyer » en envoie un nouveau.
- `tenants` est à 16/16 attributs : toute nouvelle donnée de l'organisation devra aller ailleurs.
- Écritures de rôle en lecture puis écriture de `adminUserIds` : deux changements simultanés par le propriétaire
  peuvent en perdre un (rare, un seul acteur) ; la page relue montre l'état réel.
- Un compte supprimé par l'admin de la plateforme (`deleteUserAccount`) reste dans `adminUserIds` d'une organisation
  (identifiant sans compte, sans effet).
