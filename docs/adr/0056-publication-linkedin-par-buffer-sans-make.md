# 0056. Publication LinkedIn par l'API de Buffer, sans Make

Date : 2026-11-22. Statut : accepté.

## Contexte

Depuis l'ADR 0015, la plateforme prépare chaque publication (textes, affiche `/api/social/poster/<id>.png`) puis
l'envoie au webhook d'un scénario Make. En production, le scénario ne faisait plus que trois choses :

1. webhook, filtré sur `event = job.published` et le mot de passe partagé ;
2. module « HTTP › Buffer » : `POST https://api.buffer.com`, mutation GraphQL `createPost` (canal LinkedIn, texte
   LinkedIn, `schedulingType: automatic`, `mode: shareNow`, affiche en image) ;
3. module HTTP de rappel : `POST /api/social/callback` avec `{"network":"linkedin","status":"published"|"failed"}`.

Le 2026-11-22, le compte Make n'a plus de crédits : plus aucune offre n'est publiée sur LinkedIn. Demande : ne plus
passer par Make et refaire ce scénario dans la plateforme, avec le compte Buffer existant.

## Décision

- **La plateforme appelle Buffer elle-même** (`src/lib/buffer.ts`) : même mutation que le module Make (éprouvée en
  production), clé API personnelle de Buffer (`Authorization: Bearer`, Buffer → Settings → API), délai de 15 s.
- **Le résultat est enregistré par le même code que le rappel de Make** (`handleCallback`, appelé directement par
  `deliverViaBuffer` dans `src/lib/social.ts`) : statuts, suivi des AO, tableau de bord et relances inchangés.
  « Publiée » = Buffer a créé le post (il le publie ensuite sur LinkedIn, en quelques secondes) : c'est ce que le
  scénario Make rappelait déjà. Buffer ne donne pas l'adresse du post LinkedIn à la création : pas de lien.
- **Buffer est prioritaire** : avec `BUFFER_API_KEY` et `BUFFER_LINKEDIN_CHANNEL_ID`, Make n'est plus appelé même
  si ses variables restent définies. Sans elles, l'ancien circuit Make fonctionne comme avant (retour arrière = retirer
  les deux variables). `/api/social/callback` reste en place pour Make.
- **LinkedIn seulement**, comme le scénario en service. Les autres réseaux activés dans `/admin/social` sont
  enregistrés « sautés » avec la raison, pour que la publication se conclue tout de suite au lieu d'attendre un rappel.
- **Erreurs** : clé refusée (401 ou `UNAUTHORIZED`), quota (429 ou `RATE_LIMIT_EXCEEDED`), erreur typée de la mutation
  (ex. image introuvable) ou réponse illisible = LinkedIn « échec » avec la raison, publication relançable.
  **Délai dépassé** : échec aussi, mais le message demande de vérifier sur Buffer avant de relancer (le post a pu être
  créé). Erreur après l'envoi (base injoignable) : la publication reste « envoyée », jamais déclarée en échec (une
  relance publierait deux fois), comme avec Make.
- **« Envoyer un test »** (`/admin/social`) : avec Buffer, lit le canal (`channel(input: { id })`) et vérifie qu'il
  existe et que c'est un canal LinkedIn, **sans rien publier** ; sinon, test envoyé à Make comme avant.

## Conséquences

- Plus de dépendance à Make ni à ses crédits pour LinkedIn ; une étape et un secret partagé en moins.
- Quotas de l'API Buffer par compte (offre gratuite : 150 requêtes par 15 min, 600 par jour) : largement au-dessus du
  volume d'offres publiées.
- La clé API de Buffer donne accès à tous les canaux du compte : variable serveur seulement, jamais `NEXT_PUBLIC_`.
- **Pas de publication depuis un poste local** : Buffer télécharge l'affiche depuis ses serveurs, son adresse doit être
  publique en https. Depuis `http://localhost`, Buffer refusait le post entier sans le créer ; la plateforme le dit
  maintenant avant l'appel (`imageUrlProblem`). En local, « Envoyer un test » (sans image) fonctionne ; une vraie
  publication demande un site déployé ou un tunnel https dans `NEXT_PUBLIC_APP_URL` (puis une nouvelle publication :
  « Relancer » reprend l'adresse d'affiche enregistrée).
- Ajouter un réseau (Instagram, X…) par Buffer = un canal et une variable de plus, et sa ligne dans `deliverViaBuffer`
  (Instagram demande `metadata.instagram`, voir le guide Make de `/admin/social`).
- Mise en place : `BUFFER_API_KEY` et `BUFFER_LINKEDIN_CHANNEL_ID` dans `.env.local`, en portée Preview de Vercel, et
  dans `/etc/mybestconsultant/app.env` sur le VPS (un humain) avant la mise en production ; relancer l'application ;
  « Envoyer un test » sur `/admin/social` ; puis « Relancer » les publications restées en échec pendant la panne.
