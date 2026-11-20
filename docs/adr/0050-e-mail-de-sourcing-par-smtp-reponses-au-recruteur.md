# 0050. E-mail de sourcing aux candidats : lien vers l'offre, réponses au recruteur (SMTP direct)

Date : 2026-11-20. Statut : accepté.

## Contexte

À la création d'une offre, les 5 candidats de la base les mieux notés (65/100 ou plus, `sourcing-rules.ts`) reçoivent
un e-mail de prise de contact rédigé par l'IA (`tryAutoSourceCandidates`) ; l'admin peut aussi en envoyer depuis
`/admin/sourcing`. Les deux passent par `sendOutreachEmailCore` (`src/lib/sourcing-core.ts`). Demande du 2026-11-20 :
1. l'e-mail donne le lien vers l'offre ;
2. si le candidat répond à l'e-mail, la réponse va au recruteur qui a créé l'offre.

L'e-mail partait par Appwrite Messaging (serveur 1.7.4, `node-appwrite` 15). `messaging.createEmail` n'accepte pas
d'en-tête Reply-To : l'adresse de réponse est un réglage du fournisseur SMTP dans la console, commune à tous les
e-mails. Une réponse arrivait donc à l'adresse d'envoi de la plateforme, et personne ne la voyait.

Options écartées :
- **Bouton « Répondre » vers une page de la plateforme** (comme les e-mails du pipeline, `/repondre/<jeton>`) : il
  faut une nouvelle collection, et une réponse écrite dans la messagerie reste perdue.
- **Recruteur en copie** : seul « Répondre à tous » l'atteint, et il reçoit chaque prise de contact.
- **Lire la boîte d'envoi (IMAP) et transférer** : il faut relier chaque réponse à son offre. Trop lourd pour le besoin.

## Décision

- **Cet e-mail part par SMTP direct** (`src/lib/smtp.ts`, `nodemailer` 10.3.1 épinglé, sans dépendance, types inclus),
  avec `Reply-To` = le compte du recruteur qui a créé l'offre. Les autres e-mails restent sur Appwrite Messaging.
  Même serveur SMTP et même expéditeur que le fournisseur d'Appwrite, pour garder SPF et DKIM du domaine.
- **Créateur** = `jobs.postedBy` (profil, ADR 0023), même s'il n'est pas le recruteur affecté (offre publiée depuis un
  AO affecté à un autre, offre de la plateforme créée par un admin). Son adresse est celle de son compte Auth.
  Pas de Reply-To si le profil ou le compte n'existe plus (membre retiré de l'équipe), si le compte est désactivé, ou
  si son adresse n'est pas vérifiée : n'importe qui peut s'inscrire comme recruteur et créer une offre sans vérifier
  son adresse, et une faute de frappe enverrait le CV et le téléphone des candidats à une boîte inconnue (revue de
  sécurité du 2026-11-20). L'e-mail part quand même, l'absence est journalisée
  (`[sourcing] auteur de l'offre introuvable ou désactivé`), et la phrase « répondez à cet e-mail » n'est pas affichée.
- **Destinataire** = l'adresse du compte Auth du candidat, celle à laquelle Messaging envoyait. Seuls les candidats qui
  ont un compte sont contactés, comme avant, et plus un compte désactivé. Le rôle candidat et le désabonnement sont
  relus à l'envoi (le candidat a pu se désabonner pendant la notation, qui prend une minute).
- **Erreurs d'envoi** sans le texte de la réponse du serveur, qui contient souvent l'adresse refusée : seulement le
  code, le code de réponse et la commande (`smtpErrorMessage`), dans les journaux comme à l'écran de l'admin.
- **Panne d'Appwrite pendant la recherche du créateur** (autre qu'un document absent) : l'e-mail ne part pas, l'erreur
  est journalisée (sourcing automatique) ou affichée (admin). Partir sans Reply-To perdrait la réponse du candidat.
- **Corps** (`src/lib/outreach-email.ts`, pur, testé) : le message, échappé ; un bouton « Postuler » (la page de l'offre, où le candidat postule) avec le lien en
  clair (`NEXT_PUBLIC_APP_URL/jobs/<id>`, page publique) ; la phrase sur la réponse ; le lien de désabonnement. L'objet,
  repris en titre, est échappé aussi.
- **Réglages** `SMTP_HOST`, `SMTP_PORT` (465 par défaut : TLS dès la connexion ; 587 : STARTTLS exigé), `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`, côté serveur seulement. S'il en manque un, aucun envoi : l'admin voit « SMTP non
  configuré (…) ». Le sourcing automatique ne fait alors pas rédiger les messages par l'IA, et le journalise une fois
  par offre. Délais de connexion 10 s, d'envoi 20 s.

## Conséquences

- Mise en place (DEV puis production, production par un humain) : ajouter les cinq variables (fichier local, portée
  Preview de Vercel pour `pre-dev`, `/etc/mybestconsultant/app.env` sur le VPS) **avant** de déployer ce code, sinon
  les prises de contact s'arrêtent (journalisé, la création de l'offre et le Matching IA continuent). Valeurs : celles
  du fournisseur SMTP d'Appwrite (console → Messaging → Providers). `SMTP_FROM` doit être une adresse que ce compte a
  le droit d'utiliser.
- Ces e-mails n'apparaissent plus dans Appwrite → Messaging → Messages. La trace est dans les journaux de
  l'application (`[sourcing]`).
- Le recruteur reçoit les réponses dans sa messagerie, hors de la plateforme. Rien n'est enregistré : le pipeline ne
  sait pas que le candidat a répondu.
- Retour arrière : `git revert` de ce changement (retour à Appwrite Messaging, réponses à l'adresse d'envoi). Les
  variables `SMTP_*` peuvent rester.
