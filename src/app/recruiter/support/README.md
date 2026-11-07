# Aide & support — `/recruiter/support` et `/recruiter/support/[ticketId]`

Demandes du recruteur au Help Desk de la plateforme : liste de ses demandes, nouvelle demande, fil de discussion d'une
demande (réponse, pièces jointes, « résolu »). On y arrive par le bouton « Support Helpdesk » de la barre du site (pastille
des demandes avec une réponse non lue, `countUnreadForUser` dans `site-navbar.tsx`) ; la page n'appartient à aucune rubrique du sous-menu.
Les deux fichiers de ce dossier ne font que vérifier la session et passer les données aux composants partagés avec
l'espace candidat, l'espace chasseur et l'admin (`/admin/support`).
Décisions : aucun ADR. Règles produit : AGENTS.md, section « Assistant IA » (« Transmettre au support » crée un ticket
du Help Desk).

## Fichiers

```
page.tsx             liste : session, listUserTickets, SupportCenter
[ticketId]/page.tsx  demande : session, getUserTicket (404 si elle n'est pas au recruteur), TicketView mode « user »
```

Le code est ailleurs :

- [support.ts](../../../lib/support.ts) — logique serveur : `listUserTickets`, `getUserTicket`, `createTicket`,
  `userReply`, `userResolve`, `uploadSupportFile`, `readAttachment`, e-mails à la boîte support (et à l'utilisateur quand le support répond, `supportReply`).
- [support-actions.ts](../../../lib/support-actions.ts) — Server Actions et contrôle de l'appelant (`userActor`,
  `anyActor`, `adminActor`).
- [support-shared.ts](../../../lib/support-shared.ts) — types, libellés, `SUPPORT_LIMITS`, `ATTACHMENT_EXTENSIONS`.
- [support-center.tsx](../../../components/support/support-center.tsx), [ticket-view.tsx](../../../components/support/ticket-view.tsx),
  [attachments.tsx](../../../components/support/attachments.tsx) — écrans.
- [`/api/support/files/[fileId]`](<../../api/support/files/[fileId]/route.ts>) — lecture d'une pièce jointe.

## Accès et périmètre des données

- Pages : `redirect('/login')` si `!user || user.role !== 'recruiter'` (pas d'organisation exigée).
- Une demande appartient à un **compte** (`support_tickets.userId` = compte Auth, `user.userId`), pas à l'organisation :
  un collègue ne voit pas les demandes d'un autre. `listUserTickets` filtre sur ce compte (100 au plus) ;
  `getUserTicket` renvoie `null` (→ `notFound()`) si `ticket.userId` diffère, et ne renvoie pas les notes internes du
  support (`kind: 'note'`).
- Actions de l'utilisateur : `userActor()` = recruteur, candidat ou chasseur connecté ; l'acteur (compte, nom, e-mail,
  rôle, organisation) vient de la session. `userReply` et `userResolve` revérifient que la demande est à ce compte.
- Pièces jointes : bucket privé `support` ; fichier nommé par le serveur `<compte>__<horodatage>__<nom>` à l'envoi, et
  seuls les fichiers dont le nom commence par le compte de l'acteur sont joints à un message (`resolveAttachments`).
  La route de lecture exige l'auteur de la demande (ou un admin) et un fichier cité dans un message visible de lui.
- Client `createAdminClient()` partout.

## Chargement de la page

- Liste : `listUserTickets(user.userId)` (tri par dernier message), puis `SupportCenter` avec
  `basePath="/recruiter/support"`, `backHref="/recruiter/dashboard"` et l'heure du serveur. Sans aucune demande, le
  formulaire de nouvelle demande est ouvert d'emblée.
- Demande : `getUserTicket(ticketId, user.userId)`, qui **marque la demande comme lue** (`unreadUser: false`) avant de
  renvoyer le fil (500 messages au plus) ; `TicketView` en mode `user`.
- Pas de `loading.tsx` propre : celui de l'espace recruteur ([`../loading.tsx`](../loading.tsx)).

## Logique et algorithmes

### Nouvelle demande (`createTicket`)

1. Titre de 4 à 200 caractères, description de 10 à 5 000 (`SUPPORT_LIMITS`) ; catégorie et priorité inconnues →
   `other` / `normal`.
2. 10 demandes ouvertes au plus par compte (`maxOpenPerUser` ; ouverte = ni `resolved` ni `closed`).
3. Pièces jointes vérifiées (5 au plus, `maxAttachments`).
4. Référence `T-AAMMJJ-XXXX` (4 caractères sans 0, O, 1, I), 5 essais en cas de collision sur l'index unique.
5. Document `support_tickets` (`status: 'open'`, `unreadSupport: true`, page d'origine `pageUrl` = chemin du
   `document.referrer` s'il est du site et hors `/support`), premier message dans `support_messages`.
6. E-mail à la boîte support (`notifySupport`) ; l'écran ouvre la page de la demande.

### Réponse et « résolu »

- `userReply` : message ou pièce jointe obligatoire ; une demande `resolved` ou `closed` est rouverte (événement
  « Ticket rouvert par l'utilisateur ») ; statut `in_progress` gardé, sinon `open` ; `unreadSupport: true` ; e-mail au
  support.
- `userResolve` : demande encore ouverte → `resolved` avec l'événement « Marqué comme résolu par l'utilisateur ».

### Boîte support et e-mails

Les notifications partent par Appwrite Messaging vers le compte Auth qui porte l'adresse `SUPPORT_EMAIL`
(`contact@tdidigital.io` par défaut) ; s'il n'existe pas, `supportInboxId` le crée (étiquette `support-inbox`, adresse
vérifiée), identifiant gardé 10 minutes en mémoire. `SUPPORT_EMAILS=off` coupe toutes les notifications. Un échec
d'envoi est journalisé (`[support]`) et ne bloque jamais la demande.

### Pièces jointes

Envoi (`uploadSupportFileAction` → `uploadSupportFile`) : 8 Mo au plus, extension parmi `ATTACHMENT_EXTENSIONS`
(images, PDF, texte, CSV, Office, zip ; « pas de SVG/HTML : risque XSS »). Lecture (`/api/support/files/<id>?t=<demande>`) :
images et PDF affichés, tout le reste téléchargé, avec `X-Content-Type-Options: nosniff` et une CSP `sandbox`.

## Actions serveur

| Action | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|
| `createTicketAction` | nouvelle demande | `userActor` ; règles de `createTicket` | `support_tickets`, `support_messages`, e-mail au support ; `revalidatePath` des pages support recruteur, candidat, admin |
| `replyTicketAction` | répondre | `userActor` ; demande du compte | message, statut, e-mail au support |
| `resolveTicketAction` | marquer résolu | `userActor` ; demande du compte | statut `resolved`, événement |
| `uploadSupportFileAction` | envoyer une pièce jointe | `anyActor` (admin compris) ; taille, extension | fichier dans le bucket `support` |

## Erreurs et cas limites

- Demande d'un autre compte ou inexistante : 404.
- Le compte des demandes ouvertes est lu avant la création, sans verrou : deux envois simultanés peuvent dépasser 10.
- Un fichier envoyé mais jamais joint à un message reste dans le bucket.
- Les erreurs des actions reviennent en `{ error }` et s'affichent dans le formulaire.

## Tests

Aucun test du Help Desk. Proche : [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) (noms « Support » et
« Demande au support »). Commande : `npm test`.

## Modifier cette page

- Les écrans et la logique sont communs aux espaces recruteur, candidat (`src/app/candidate/support/`), chasseur
  (`src/app/hunter/support/`) et admin (`src/app/admin/support/`) : un changement de `support.ts` ou des composants les
  touche tous.
- Libellés et catégories : `support-shared.ts` ; aussi décrits dans [knowledge.ts](../../../lib/assistant/knowledge.ts)
  (« Bouton « Support Helpdesk » »).
- Noms de page dans « ← Retour » : `PAGE_LABELS` de [recruiter-trail.ts](../../../lib/recruiter-trail.ts).
