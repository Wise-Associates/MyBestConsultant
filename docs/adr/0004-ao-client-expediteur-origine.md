# 0004 — AO Offers : client = expéditeur d'origine, date limite sur l'e-mail

- Statut : accepté
- Date : 2026-10-21

## Contexte

Les appels d'offres arrivent souvent sur `ao@wise-associates.fr` **transférés par un collaborateur** : l'expéditeur
de l'e-mail est alors l'un des nôtres, et le vrai émetteur de l'appel d'offres n'apparaît que dans le corps
(« De : Marie Dupont <marie.dupont@client.fr> »). Jusqu'ici, l'IA devait trouver le « client final » cité dans le
texte et ignorer l'historique de transfert : le client restait le plus souvent « Non précisé », et l'expéditeur
d'origine n'était ni connu de la page admin, ni masqué à la publication.

Par ailleurs, certains appels d'offres commencent par un récapitulatif sans libellés :

```
30/10/2026
Mission longue
480,00
Paris
5 ans et plus
```

La date y est la **date limite de réponse** ; l'IA la prenait pour la date de démarrage.

## Décision

1. **Le client d'une offre AO est l'entreprise de celui qui a envoyé l'appel d'offres à l'origine**, même si le
   texte nomme un client final (décision métier du 2026-10-21). `src/lib/ao/origin.ts` :
   - expéditeur d'origine : l'en-tête cité le plus bas dans le corps (le message le plus ancien) dont l'adresse
     n'est pas `@wise-associates`, sinon l'expéditeur de l'e-mail s'il n'est pas des nôtres ;
   - nom de l'entreprise : celui que l'IA lit dans sa signature, si le corps de l'e-mail lui est confié (pas quand
     un tableau joint a été lu à sa place), sinon celui tiré du domaine (`sopra-steria.com` → « Sopra Steria ») ;
   - appliqué à toutes les offres de l'e-mail, lignes de tableau comprises ;
   - entreprise introuvable (messagerie grand public, reconnue par domaine complet) ou appel d'offres écrit par nos
     soins : chaque offre garde le client lu dans le texte ou le tableau.
   L'IA ne reçoit que le **domaine** de l'expéditeur d'origine (minimisation des données personnelles). L'expéditeur
   d'origine est enregistré sur l'e-mail (`origin`, « Nom <adresse> », un seul attribut) : affiché dans la page
   admin, filtrable, et masqué à la publication comme l'expéditeur de l'e-mail.
2. **Les clients cités restent masqués à la publication.** Ils n'apparaissent plus dans le client de l'offre : la
   colonne « Client » des tableaux et le client final lu par l'IA (`endClient`) sont relevés avant de remplacer le
   client, et enregistrés sur l'e-mail (`citedClients`) avant la création des offres.
3. **Date limite de réponse** : champ `deadline`, lu dans les colonnes « Date limite », « Date de clôture »,
   « Échéance » des tableaux, jusqu'ici ignorées. Complément du 2026-10-21 (`src/lib/ao/dates.ts`) : l'IA ne remplit
   `startDate` et `deadline` que pour les dates que le texte désigne lui-même ; les dates citées sans libellé sont
   classées par le code selon leur jour de la semaine — vendredi : date limite, lundi : démarrage, autre jour : date
   limite. Le jour est calculé, pas demandé à l'IA (elle se trompe souvent sur le jour d'une date).
4. **La date limite est enregistrée sur l'e-mail** (`ao_emails.deadline`), pas sur l'offre : `ao_offers` a atteint
   la limite du projet de 16 attributs. Un e-mail en garde une seule, la plus proche de ses offres (répondre trop tôt
   ne fait rien perdre) ; elle s'affiche pour chacune de ses offres. Jamais publiée.

## Conséquences

- Avant de déployer cette version sur un projet Appwrite : `npm run ao:setup -- <fichier .env> --apply` (ajoute
  `ao_emails.origin`, `deadline`, `citedClients`). Sans eux, Appwrite refuse l'enregistrement et les e-mails passent
  en erreur. `ao_emails` est alors à 15 attributs sur 16.
- Les offres déjà extraites gardent leur client et leur date de démarrage : le contenu des e-mails n'est pas
  conservé, elles ne sont pas recalculées. Leur expéditeur reste celui de l'e-mail.
- Le client entre dans l'empreinte de dédoublonnage : un appel d'offres reçu avant ce changement puis renvoyé, ou le
  même appel d'offres transmis par deux intermédiaires différents, n'est plus reconnu comme doublon.
- Un tableau dont les lignes ont des dates limites différentes n'en garde qu'une, la plus proche.
- Un nom tiré du domaine est approximatif (« Bnpparibas ») ; une signature mal lue par l'IA donne un mauvais
  client : l'admin voit le client et l'expéditeur d'origine avant de publier.
