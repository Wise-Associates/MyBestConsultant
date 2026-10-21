# 0006 — AO Offers : e-mails d'origine relus dans la boîte, jamais conservés

- Statut : accepté
- Date : 2026-10-21

## Contexte

Pour vérifier l'authenticité d'un appel d'offres (expéditeur réel, signature DKIM, pièce jointe d'origine), l'admin
veut télécharger l'e-mail reçu et ses pièces jointes depuis la page AO Offers. Jusqu'ici, le contenu des e-mails
n'était pas conservé (seulement le nom des pièces jointes lues), par minimisation des données personnelles.

## Décision

L'e-mail d'origine (.eml, en-têtes et signatures compris) et ses pièces jointes sont **relus dans la boîte au moment
du téléchargement** (`src/lib/ao/originals.ts`), jamais copiés en base ni dans le stockage :

- l'UID enregistré désigne le message, dont le Message-ID est revérifié (boîte reconstruite : refus) ;
- route `/api/admin/ao-offers/original/[emailId]` : admin, boîtes de la plateforme seulement ; pièce jointe choisie
  parmi celles enregistrées à la lecture de l'e-mail ;
- contenu venant d'un expéditeur extérieur : toujours en téléchargement (`application/octet-stream`,
  `Content-Disposition: attachment`, `nosniff`, CSP `sandbox`), jamais affiché par le navigateur.

## Conséquences

- Aucune donnée personnelle de plus en base ; le .eml téléchargé est la pièce d'origine, signatures comprises.
- L'original n'est disponible que tant que l'e-mail est dans la boîte (AO Offers n'y supprime rien, mais un
  utilisateur de la boîte le peut) et que la boîte est enregistrée (boîte supprimée : mot de passe effacé, plus
  d'accès). Message clair dans le panneau dans ces cas.
- Chaque téléchargement ouvre une connexion IMAP (45 s au plus).
- La page des organisations (phase C) aura sa propre route, limitée aux boîtes de l'organisation.
