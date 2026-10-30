# 0018 — MBC Search : recherche de profils par brief, sur la base de personnes d'Apollo.io

- Statut : proposé
- Date : 2026-10-30

## Contexte

Demande du 2026-10-30 : une page « MBC Search » dans l'espace recruteur, inspirée du parcours public de Sherlock
(outil de sourcing de Collective) et alimentée par Apollo.io. Ce qui est public de Sherlock : le recruteur part d'une
fiche de poste ou d'un brief en langage naturel, l'outil en tire une recherche, interroge plusieurs sources, classe
les profils et montre les critères derrière chaque correspondance. Rien de propriétaire n'est repris (ni marque, ni
textes, ni écrans) : seul ce parcours en trois temps sert de modèle.

Le MCP Apollo.io sert à l'assistant Claude, pas à l'application : en production, la page appelle l'API REST d'Apollo
avec une clé de la plateforme.

## Décision

- **Page `/recruiter/mbc-search`**, en trois temps : 1) le recruteur colle un brief ; 2) l'IA (modèle du module
  « matching » de Config IA) en tire des critères — intitulés, compétences, localisations, séniorités — qu'il relit et
  corrige ; 3) la recherche interroge Apollo et classe les profils.
- **Apollo : `POST /api/v1/mixed_people/api_search`** (en-tête `x-api-key`, variable `APOLLO_API_KEY`, serveur
  seulement). Cette recherche ne consomme **aucun crédit** et ne renvoie ni e-mail ni téléphone ; le nom de famille
  est masqué. L'enrichissement d'un profil (coordonnées, payant) n'est pas proposé : à décider à part, avec son coût
  et sa base légale RGPD.
- **Score sur 100 et raisons affichées** (`scoreProfile`, `src/lib/mbc-search/rules.ts`) : intitulé (55), compétences
  visibles dans l'intitulé ou l'employeur (25), e-mail ou téléphone connus d'Apollo (10), profil mis à jour depuis
  moins de 6 mois (10). Apollo filtre déjà lieu et séniorité ; le score ne départage que sur ce qui est visible avant
  enrichissement. Pas d'embeddings : le texte disponible (intitulé, employeur) est trop court pour qu'ils apportent
  quelque chose, et le score reste explicable.
- **Accès** comme « Trouver des candidats » des AO : recruteur d'une organisation à l'abonnement actif (essai compris),
  adresse e-mail vérifiée, quota quotidien partagé entre analyses de brief et recherches (60 par organisation,
  600 pour toute la plateforme ; compteurs `mbcSearchOrg` « k » et `mbcSearchAll` « z » dans `ao_sync_state`).
- **Rien n'est enregistré** : ni brief, ni critères, ni profils. Les journaux ne contiennent que le statut HTTP ou le
  type d'erreur, jamais le brief ni un profil.

## Conséquences

- Mise en place : créer une clé d'API Apollo et la renseigner dans `APOLLO_API_KEY` (Vercel, Preview puis
  Production). Sans clé, la page s'affiche et annonce que la recherche n'est pas activée.
- Si Apollo répond « Need master API key » (403), la clé doit être une clé « master ».
- Les profils sont des données personnelles venant d'un tiers : avant d'ajouter l'enregistrement d'un profil ou
  l'enrichissement, documenter la base légale (intérêt légitime de sourcing) et l'information des personnes.
