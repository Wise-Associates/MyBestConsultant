# Mon équipe — `/recruiter/equipe`

Membres de l'organisation du recruteur (propriétaire, collaborateurs, invitations en attente), invitation d'un
collaborateur par e-mail, renvoi d'une invitation, retrait d'un membre, et historique des actions de l'équipe dans les
pipelines. Rubrique « Mon équipe » du sous-menu (qui couvre aussi la marque employeur, `recruiter-nav.ts`).
Un collaborateur est un compte recruteur de même `tenantId` : il voit tout ce que voit le propriétaire, sans copie de
données (commentaire de `src/lib/team.ts`) ; une inscription ne rejoint jamais une organisation existante, seule une
invitation le permet.
Décisions : aucun ADR. Règles produit : AGENTS.md, section « Appwrite », point « Sign-up never joins an existing
organisation » ; suppression des données personnelles au retrait : sections « Assistant IA » et « MBC Search ».

## Fichiers

```
page.tsx         composant serveur : session, listTeam + getTeamActivity en parallèle, rôle de propriétaire
data.ts          getTeamActivity : 40 derniers événements du funnel de l'organisation, avec candidat, offre, phase
actions.ts       Server Actions inviteMemberAction, resendInviteAction, removeMemberAction (propriétaire seulement)
team-client.tsx  écran (client) : membres, formulaire d'invitation, historique, encadré « Ce que partage l'équipe »
```

Code partagé :

- [team.ts](../../../lib/team.ts) — `listTeam`, `inviteMember`, `resendInvite`, `removeMember`, et côté page publique
  `getInviteInfo` / `acceptInvite` ; `MAX_TEAM_SIZE`.
- [`(auth)/rejoindre/[token]/`](<../../(auth)/rejoindre/[token]/>) — page publique où l'invité choisit son mot de passe
  (`acceptInviteAction`, `actions.ts`).
- [funnel.ts](../../../lib/appwrite/funnel.ts) — `logFunnelEvent` (écrit l'historique), `getFunnelStages`.
- [funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) — `resolveStatus`, `withOrphanStages`.
- Suppressions au retrait : `deleteAssistantTurnsForUser` ([host.ts](../../../lib/assistant/host.ts)),
  `deleteMbcSearchesForUser` ([history-store.ts](../../../lib/mbc-search/history-store.ts)),
  `deleteSavedPeopleForUser` ([saved-store.ts](../../../lib/mbc-search/saved-store.ts)).

## Accès et périmètre des données

- Page : layout de l'espace recruteur, puis `getCurrentUser` et `redirect('/login')` si
  `!user || user.role !== 'recruiter' || !user.tenantId`. **Tout recruteur** de l'organisation ouvre la page et voit
  les membres et l'historique.
- Propriétaire = `tenants.recruiterId`, un identifiant de **compte Auth** (`users.userId`, pas le profil `users.$id`).
  `page.tsx` calcule `isOwner` à partir de `listTeam` ; l'écran n'affiche les boutons de gestion et le formulaire qu'au
  propriétaire. Ce n'est pas le contrôle : chaque Server Action appelle `requireOwner()` (`actions.ts`), qui relit
  `tenants` et refuse si `tenant.recruiterId !== user.userId`.
- Membre visé : `requireMemberOfTenant` (`team.ts`) exige un profil `users` de ce compte, du même `tenantId`, de rôle
  `recruiter`, et refuse le propriétaire (« Le propriétaire du compte ne peut pas être modifié »).
- Organisation toujours prise dans la session : `inviteMemberAction` ne recopie que `firstName`, `lastName`, `email`
  (un `tenantId` ou un `invitedBy` envoyé par le navigateur est ignoré, commentaire de l'action).
- Client Appwrite : `createAdminClient()` partout (Databases, Users, Messaging).

## Chargement de la page

1. `Promise.all([listTeam(tenantId), getTeamActivity(tenantId)])`.
2. `listTeam` : document `tenants` et profils `users` de l'organisation (100 au plus), gardés s'ils sont de rôle
   `recruiter`. Pour chacun, `users.get(userId)` : invitation en attente si ses préférences Auth portent `invite`
   (`status: 'pending'`, `inviteExpiresAt`), dernière connexion = `accessedAt` ; compte Auth illisible : affiché
   « actif ». Tri : propriétaire, puis actifs, puis invitations en attente, puis prénom (`localeCompare` français).
3. `getTeamActivity` (`data.ts`) : voir ci-dessous.
4. Props de `TeamClient` : membres, activité, `currentUserId` (compte Auth), `isOwner`, `now` (heure du serveur, pour
   « il y a … » et les jours restants d'une invitation).
5. Pas de `loading.tsx` propre : celui de l'espace recruteur ([`../loading.tsx`](../loading.tsx), `SectionPageSkeleton`).
   Une exception de `listTeam` (organisation illisible) n'est pas rattrapée : page d'erreur par défaut de Next.js.

## Logique et algorithmes

### Historique de l'équipe (`getTeamActivity`)

1. En parallèle : toutes les candidatures de l'organisation, ses offres (`getJobsByTenant`, offres partagées de la
   plateforme comprises) et ses phases (`getFunnelStages`).
2. Événements `funnel_events` par lots de 100 identifiants de candidature, chaque lot trié du plus récent et limité à
   `limit` (40 par défaut) ; lots réunis, triés, 40 gardés. Un lot en échec donne une liste vide (sans journal).
3. Noms des candidats de ces événements (100 premiers identifiants), titres des offres, phase de l'événement passée par
   `resolveStatus` puis `withOrphanStages` (libellé et couleur, même pour une phase supprimée).
4. Chaque élément : auteur (`actorName`, « Un membre de l'équipe » s'il est vide), type (`stage_change`, `screening`,
   `interview`, `contact` = WhatsApp), candidat, offre, phase, note, date.

L'auteur est écrit par `logFunnelEvent` : nom passé par l'appelant, sinon celui du recruteur de la session ; vide pour
un autre rôle (« un candidat qui termine un entretien n'est pas un acteur d'équipe »). L'historique ne s'enrichit que
des actions qui appellent `logFunnelEvent`.

### Invitation (`inviteMember`)

1. Saisie : e-mail en minuscules, prénom et nom coupés à 100 caractères et obligatoires, e-mail vérifié par
   l'expression `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`.
2. Équipe pleine : `listTeam` compte au moins `MAX_TEAM_SIZE` (15) membres, propriétaire et invitations en attente
   compris → refus.
3. Un compte Auth existe déjà avec cette adresse (`users.list`) → refus : on n'invite pas un compte existant.
4. Création du compte Auth avec un mot de passe aléatoire inutilisable, étiquette `recruiter`, profil `users`
   (`role: 'recruiter'`, `tenantId` de l'organisation).
5. `issueInvite` : secret de 24 octets aléatoires ; seule son empreinte SHA-256 est gardée, dans les préférences du
   compte Auth (`invite` = `hash`, `expiresAt` à 7 jours — `INVITE_TTL_MS` —, `invitedBy`, `tenantId`). Lien :
   `<NEXT_PUBLIC_APP_URL>/rejoindre/<compte>.<secret>` (`https://mybestconsultant.fr` sans la variable).
6. `sendInviteEmail` : e-mail par Appwrite Messaging au compte créé (nom de l'organisation et de l'invitant échappés) ;
   un échec renvoie `emailSent: false` et l'écran affiche le lien à copier et transmettre.
7. Échec après la création du compte Auth (étiquette, profil, invitation) : le compte Auth est supprimé (« sans profil
   complet, le compte deviendrait un orphelin qui bloque l'adresse email »), l'erreur est affichée.

« Renvoyer » (`resendInvite`) : seulement si l'invitation est encore en attente ; un nouveau secret remplace l'ancien
(l'ancien lien ne marche plus) et un nouvel e-mail part.

### Acceptation (page publique `/rejoindre/<jeton>`)

`verifyInvite` : jeton `compte.secret`, identifiant de compte conforme (`^[\w-]{1,36}$`), invitation présente et non
expirée, empreinte comparée en temps constant (`timingSafeEqual`). `acceptInvite` fixe le mot de passe (8 à 128
caractères, `acceptInviteAction`), marque l'adresse comme vérifiée, retire `invite` des préférences ; l'action ouvre
alors la session et redirige vers `/recruiter/dashboard`.

### Retrait d'un membre (`removeMember`)

Le compte du membre est **supprimé**, dans cet ordre :

1. Conversations avec l'assistant IA (`deleteAssistantTurnsForUser`, si la collection est configurée), historique MBC
   Search (`deleteMbcSearchesForUser`), personnes enregistrées MBC Search (`deleteSavedPeopleForUser`) — clés : le
   compte Auth. Une erreur ici arrête tout : rien d'autre n'est supprimé et le propriétaire peut recommencer
   (commentaire RGPD de `removeMember`).
2. Profil `users`.
3. Compte Auth (`users.delete`, erreur ignorée : « déjà supprimé »).
4. Second passage sur les personnes enregistrées (une sauvegarde faite pendant la suppression) ; un échec est journalisé
   `[mbc-search] … à supprimer à la main`.

`removeMember` ne touche à aucune autre donnée : offres affectées au membre (`jobs.recruiterId`, `jobs.postedBy`),
CV de vivier qu'il a importés (`vivier_cvs.recruiterId`), commentaires AO, noms dans l'historique restent tels quels.
AGENTS.md, tableau de bord : « une offre affectée à un recruteur parti n'apparaît que sans filtre ».

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `inviteMemberAction` | `actions.ts` → `inviteMember` | invite un collaborateur | `requireOwner` ; champs repris un par un, chaînes exigées ; validation dans `inviteMember` ; 15 membres ; adresse sans compte existant | compte Auth, étiquette `recruiter`, profil `users`, préférences `invite`, e-mail Appwrite Messaging ; `revalidatePath('/recruiter/equipe')` |
| `resendInviteAction` | `actions.ts` → `resendInvite` | nouveau lien d'invitation | `requireOwner` ; `requireMemberOfTenant` ; invitation encore en attente | préférences `invite` remplacées, e-mail |
| `removeMemberAction` | `actions.ts` → `removeMember` | retire un membre | identifiant de compte `^[\w-]{1,36}$` avant tout (« un tableau ferait de `Query.equal` un « ou » ») ; `requireOwner` ; `requireMemberOfTenant` | suppressions décrites ci-dessus ; `revalidatePath` |

Les trois renvoient `{ error }` au lieu de lever une exception ; l'écran affiche le message dans l'encadré du
formulaire.

## Erreurs et cas limites

- E-mail non parti (invitation ou renvoi) : compte créé quand même, lien affiché avec « Copier ».
- Invitation expirée : badge « expirée » ; « Renvoyer » en donne une nouvelle.
- Membre dont le compte Auth est illisible : affiché « actif », sans dernière connexion.
- `inviteMember` vérifie la taille de l'équipe puis crée le compte sans verrou : deux invitations simultanées peuvent
  dépasser 15 membres.
- Le retrait demande confirmation dans le navigateur (`window.confirm`) ; l'écran retire la ligne sans relire la page.
- Presse-papiers indisponible : « Copier » ne fait rien (erreur ignorée dans `copy`).

## Tests

Aucun test de `team.ts`, de `data.ts` ni des actions. Proches : [tenant-slug.test.ts](../../../lib/tenant-slug.test.ts)
(organisation créée à l'inscription), [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts).
Commande : `npm test`.

## Modifier cette page

- Toute nouvelle donnée personnelle rattachée à un compte recruteur doit être supprimée dans `removeMember` **et** dans
  `deleteUserAccount` (`src/app/admin/users/actions.ts`), avant le compte (même règle dans AGENTS.md pour l'assistant
  et MBC Search).
- Nouveau type d'événement d'historique : `FunnelEventKind` (`@/types`), l'appel à `logFunnelEvent`, et le texte de
  chaque `kind` dans `team-client.tsx`.
- Limite d'équipe : `MAX_TEAM_SIZE` ; durée d'une invitation : `INVITE_TTL_MS` (aussi annoncée dans l'écran, dans
  l'e-mail « valable 7 jours » et dans [knowledge.ts](../../../lib/assistant/knowledge.ts)).
- L'encadré « Ce que partage l'équipe » est un texte fixe de `team-client.tsx` : à garder conforme au code (vivier
  personnel, etc.).
