# 0041 — MBC Search : discussion enregistrée avec les personnes révélées

- Statut : accepté
- Date : 2026-11-17

## Contexte

Demande de l'utilisateur du 2026-11-17 : « save discussion on my search, not only the title but the whole discussion,
with person that I unveiled ». Jusque-là, l'historique (`mbc_searches`, ADR 0018) ne gardait que le besoin, les critères
et le nombre de profils ; la conversation n'était pas enregistrée et rouvrir une recherche la relançait.

Choix de l'utilisateur le même jour :

1. Seules les recherches **enregistrées** (marque-page, nommées) gardent leur discussion ; les autres restent comme avant.
2. Les personnes révélées pendant la discussion gardent leur **profil complet** (nom, LinkedIn, e-mail, parcours)
   **tant que la recherche reste enregistrée**, comme les personnes enregistrées : liste personnelle, effacée quand la
   recherche est retirée ou supprimée, et avec le compte. 50 personnes au plus par discussion.
3. À la réouverture, la discussion et les personnes s'affichent tout de suite ; la liste complète des profils d'Apollo
   ne revient que sur « Relancer la recherche » (une place du quota par requête, comme toute recherche).

## Décision

- Deux attributs facultatifs sur le document de la recherche enregistrée (`mbc_searches`, 10/16) plutôt qu'une
  collection : `conversationJson` (100 000 : besoin et critères au dernier état, messages) et `peopleJson`
  (1 000 000 : ligne de recherche et profil de chaque personne). Ils suivent déjà le document : effacés avec lui, avec le
  compte (`deleteMbcSearchesForUser`), jamais lus par la liste de l'historique (`Query.select`), seulement à l'ouverture.
- Règles pures `src/lib/mbc-search/discussion.ts` (testées) : forme validée par zod, discussion coupée à 120 messages
  et 95 000 caractères en gardant le besoin et la fin (`fitDiscussion`), personnes sans doublon, 50 et 950 000
  caractères au plus (`mergeDiscussionPeople`), profils relus avec les garanties d'un profil révélé (liens https, adresse
  simple : `parseRevealedJson`).
- `saveMbcDiscussion` (recherche du recruteur et épinglée seulement) : le navigateur envoie les messages et les
  **lignes** des personnes révélées ; le profil complet d'une nouvelle personne est **relu en base** (profils révélés de
  l'organisation, ou personne enregistrée du recruteur), jamais pris du navigateur : une personne non révélée, ou dont
  l'organisation n'a plus le profil (90 jours), est ignorée ; et aucun profil n'est copié si l'organisation n'a plus
  accès à MBC Search (mêmes conditions que la révélation : formule, abonnement, adresse vérifiée). Ni crédit ni quota,
  mais un débit propre (30 enregistrements par minute et par recruteur) ; nouvelles personnes lues en une requête, pas
  plus que les places libres. Après l'écriture, l'épinglage est revérifié (retrait dans un autre onglet : effacée).
- L'écran envoie la discussion une seconde après chaque changement (message, critères, personne révélée par « Révéler »
  ou « Enregistrer »), seulement si elle a changé ; « Recherches précédentes » rouvre une recherche enregistrée avec sa
  discussion (`openMbcDiscussion`), ou la relance si rien n'est gardé (enregistrée avant le 2026-11-17).
- Retirer le marque-page demande confirmation puis efface la discussion et ses personnes (`setMbcSearchPinned`).

## Conséquences

- **Données de tiers** : le profil complet d'une personne révélée dans une discussion enregistrée est gardé au-delà des
  90 jours des profils révélés de l'organisation, tant que le recruteur garde la recherche enregistrée (décision 2) ;
  20 recherches enregistrées × 50 personnes au plus par recruteur.
- Seules comptent les personnes que le recruteur révèle (ou enregistre) pendant la discussion : un profil affiché
  révélé parce que l'organisation l'avait déjà payé n'est pas gardé avec elle.
- **Mise en production** : `npm run schema:push -- dev` puis prod (sauvegarde d'abord) **avant** le déploiement. Sans
  les attributs, tout marche comme avant, et l'enregistrement de la discussion affiche « la base de MBC Search doit
  être mise à jour » (journalisé).
