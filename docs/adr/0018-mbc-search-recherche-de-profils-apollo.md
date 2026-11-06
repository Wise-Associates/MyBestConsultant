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
  est masqué.
- **Profil complet à la demande** (demande du 2026-11-06 : « we need whole info of them ») : « Profil complet » sur
  une ligne, ou « Révéler N profils complets » pour la page (10 au plus par appel), appelle
  `POST /api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false` avec les seuls identifiants
  Apollo (`toRevealRequest`, identifiant vérifié `APOLLO_PERSON_ID`). Affiche nom complet, photo, intitulé, accroche,
  employeur et son site, lieu, LinkedIn, **e-mail professionnel** et son statut, 8 expériences au plus
  (`parseApolloMatches` : liens https seulement, adresse simple seulement). **1 crédit Apollo par personne trouvée.**
  Ni e-mail personnel ni téléphone (RGPD ; le téléphone coûte 8 crédits et n'arrive que par webhook). Quota du jour
  par profil demandé : 100 par organisation, 1 000 pour toute la plateforme (`MBC_REVEAL_DAILY_LIMITS`, compteurs
  `mbcRevealOrg` « j » et `mbcRevealAll` « l » ; places rendues si le quota refuse). Pas d'enrichissement automatique
  de toute la liste : il coûterait 25 crédits par page.
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

- **Espace de travail et suites** (2026-11-06, maquette validée par le client) : trois colonnes (critères, profils,
  profil choisi), compétences obligatoires (seules envoyées en mots-clés), secteur de l'employeur, filtres e-mail et
  profil récent, présélection, sélection multiple à révéler, jauge des profils complets du jour, recherches enregistrées
  dans le navigateur. Un profil révélé peut être **ajouté au vivier** (général ou d'une offre) : CV du vivier sans
  fichier, comparé aux offres comme un import ; c'est le seul enregistrement d'un profil (durée de conservation : celle
  du vivier). « Rédiger une approche » : brouillon par l'IA, sans e-mail ni lien envoyé au modèle, rien d'envoyé.

## Conséquences

- Mise en place : créer une clé d'API Apollo et la renseigner dans `APOLLO_API_KEY` (Vercel, Preview puis
  Production). Sans clé, la page s'affiche et annonce que la recherche n'est pas activée.
- Si Apollo répond « Need master API key » (403), la clé doit être une clé « master ».
- Les profils sont des données personnelles venant d'un tiers : base légale à documenter (intérêt légitime de
  sourcing) et information des personnes contactées. Les profils complets ne sont pas enregistrés : ils disparaissent
  avec la page. Avant d'ajouter leur enregistrement, décider de la durée de conservation.
