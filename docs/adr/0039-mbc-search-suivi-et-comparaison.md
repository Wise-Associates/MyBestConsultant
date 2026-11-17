# 0039 — MBC Search : suivi des personnes enregistrées et comparaison

- Statut : accepté
- Date : 2026-11-17

## Contexte

Phase 3 du sourcing « à la Sherlock » (ADR 0037, 0038) : suivre les candidats retenus (statut, notes, étiquettes) et
les comparer. La sélection existe déjà : les personnes enregistrées (`mbc_saved_people`, ADR 0018), révélées, gardées
pour le recruteur jusqu'à ce qu'il les retire ou que son compte soit supprimé, et que lui seul voit.

## Décision

- **Suivi gardé avec la personne enregistrée** : trois attributs facultatifs de `mbc_saved_people` (6 → 9/16) —
  `followStatus` (30), `followNote` (2 000), `followTags` (tableau, 40 par étiquette, 10 au plus). Pas de nouvelle
  collection : le suivi vit et meurt avec la personne (« Retirer », suppression du compte, retrait d'un membre), sans
  autre règle de conservation à tenir. Règles pures `src/lib/mbc-search/follow.ts` (testées) : statuts « À examiner »
  (par défaut), « Présélectionné », « Contacté », « Intéressé », « Entretien prévu », « Entretien passé », « Refusé »,
  « Embauché » ; note et étiquettes bornées, caractères de contrôle remplacés, étiquettes sans doublon ; un document
  sans ces attributs (avant leur création, valeurs null) se lit « À examiner », sans note ni étiquette ; une valeur
  invalide reprend sa valeur par défaut **champ par champ** (un statut retiré de la liste ne fait pas perdre la note).
  Non chiffrés, comme les autres attributs du projet (`profileJson` contient des données comparables) : le chiffrement
  ne se change plus après la création de l'attribut.
- **Action `updateMbcFollow`** : recruteur de la session, seulement une personne de **sa** liste (identifiant du
  document dérivé de son compte, propriétaire revérifié), ni crédit ni quota. **Version vérifiée** : l'écran renvoie le
  `$updatedAt` du document qu'il a lu ; s'il a changé (suivi enregistré dans un autre onglet), rien n'est écrit et la
  page demande de recharger — sans quoi une note serait écrasée sans prévenir (revue de sécurité du 2026-11-17 ;
  Appwrite 1.7 n'a pas d'écriture conditionnelle, il reste un intervalle de quelques millisecondes, acceptable pour la
  liste d'un seul recruteur). Attributs absents sur le projet (« Unknown attribute ») : message « pas encore activé » et
  journal (« schema:push »), la recherche et l'enregistrement des personnes marchent.
- **Écran** : section « Suivi » du panneau d'une personne enregistrée (statut, étiquettes, note, « Enregistrer le
  suivi ») ; statut et étiquettes sur sa ligne (recherche et sélection) ; filtre par statut dans l'onglet « Sélection ».
- **Comparer** (`mbc-compare-dialog.tsx`) : dans l'onglet « Sélection », 2 ou 3 personnes cochées, côte à côte —
  données d'Apollo, score de classement, évaluation par l'IA si elle a été faite pendant la visite (critère par
  critère), ce qui n'est pas visible, parcours récent, suivi. Affichage seulement.
- **Pipeline** (décision de l'utilisateur, 2026-11-17) : une personne de MBC Search entre dans le pipeline d'une offre
  **avec son CV**, comme tout candidat — le recruteur le demande (les brouillons d'e-mail et de WhatsApp le demandent),
  puis l'importe dans le vivier de l'offre (Matching IA, « Ajouter dans le funnel », score final). Pas de score final
  sur les données d'Apollo, pas de candidature sans CV ; le panneau le rappelle.

## Conséquences

- **Mise en place** : `npm run schema:push -- dev` (dans un terminal : l'identifiant du projet est demandé), puis
  vérifier dans la console que les trois attributs sont « available » (`schema:check` ne voit pas leur état) ; production
  (un humain), **avant** la mise en production du code : sauvegarde de la base, `schema:check -- prod` (attendu :
  exactement les trois lignes « + mbc_saved_people.follow… »), `schema:push -- prod`, « available » dans la console.
  Avant, le suivi ne s'enregistre pas (message à l'écran). Retour arrière : revenir sur le code suffit (l'ancien code
  ignore ces attributs) ; ne pas supprimer les attributs, ce serait effacer les notes des recruteurs.
- La note est une donnée personnelle sur un tiers écrite par le recruteur : gardée comme la personne enregistrée
  (jusqu'à « Retirer » ou la suppression du compte), jamais journalisée, jamais envoyée à l'IA.
