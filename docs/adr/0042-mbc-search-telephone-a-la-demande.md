# 0042 — MBC Search : téléphone à la demande

- Statut : accepté (revient sur l'exclusion du téléphone de l'ADR 0018)
- Date : 2026-11-17

## Contexte

Demande de l'utilisateur du 2026-11-17 : voir le téléphone des personnes trouvées. La recherche d'Apollo (gratuite) ne
donne jamais de numéro, seulement s'il en existe un (`has_direct_phone`) ; la révélation (`people/bulk_match`) était
appelée avec `reveal_phone_number=false` (ADR 0018 : RGPD, 8 crédits par numéro, résultat livré plus tard par webhook).

Choix de l'utilisateur le même jour : téléphone **à la demande** (pas à chaque révélation), **20 demandes par
organisation et par jour**, numéro gardé **comme le profil** (90 jours pour l'organisation, ou tant que la personne
reste enregistrée).

## Décision

- Bouton « Demander · jusqu'à 8 crédits » dans le panneau d'un profil **révélé**. Action `requestMbcPhone` : mêmes
  conditions que la révélation (formule, abonnement, adresse vérifiée), profil relu en base (organisation ou personne
  enregistrée), quotas `mbcPhoneOrg` (droit de la formule `dailyQuotas.mbcPhone`, 20 pour les formules standard, une
  offre sur mesure peut le changer ou le mettre à 0) et `mbcPhoneAll` (200 pour la plateforme, garde-fou des crédits),
  puis `POST /api/v1/people/match?reveal_phone_number=true&poll_only=true` avec l'identifiant Apollo. **Une demande à la
  fois par organisation et par personne** (verrou `ph_…` de `ao_sync_state`, profil relu sous le verrou) : deux clics
  simultanés ne paient pas deux fois ; un résultat tardif n'écrase jamais une demande plus récente.
- **Relecture plutôt que webhook** (`poll_only`, documenté par Apollo) : rien à exposer sur le serveur, et cela marche
  aussi en local. Le numéro de la demande est gardé dans le profil ; `checkMbcPhone` le relit (`GET
  /api/v1/webhook_result/<demande>`, sans crédit) : en attente, trouvé, aucun numéro, ou demande périmée (« échec »,
  nouvelle demande possible). L'écran relit toutes les 5 s pendant 2 min, puis propose « Vérifier ». Le numéro de demande
  n'est jamais pris du navigateur.
- Numéros validés (forme internationale ou chiffres, 5 au plus, type d'Apollo : mobile, ligne directe, standard…),
  gardés dans le JSON du profil révélé (`phone`, `src/lib/mbc-search/phone.ts`, règles pures testées) : aucun attribut
  Appwrite nouveau. Écrits dans le profil de l'organisation (`saveRevealPhone`) et, si le recruteur l'a enregistrée, dans
  la personne enregistrée (`saveSavedPhone`). Jamais journalisés.
- Affichage : lignes « Mobile », « Ligne directe »… avec « Appeler » (`tel:`) dans le panneau, icône d'appel sur la
  ligne du résultat.

## Conséquences

- Coût : jusqu'à 8 crédits Apollo par numéro trouvé (plus le crédit de la personne si Apollo le compte), aucun si rien
  n'est trouvé ; 20 demandes par organisation et par jour.
- Données de tiers plus sensibles (souvent des mobiles personnels) : même durée que le profil, mêmes suppressions (purge
  à 90 jours, retrait de la personne enregistrée, suppression du compte).
- La clé Apollo de la plateforme doit permettre `people/match` et `webhook_result` (sinon message « la clé … ne permet
  pas de relire les téléphones », journalisé).
- Une discussion enregistrée (ADR 0041) ne garde **jamais** le téléphone (`discussionPeopleJson`, revue de sécurité du
  2026-11-17 : il y survivait à la purge des 90 jours) : le numéro ne vit qu'avec le profil de l'organisation et la
  personne enregistrée.
- **Formules payées seulement** (décision du même jour, après la revue de sécurité : des inscriptions jetables auraient pu
  dépenser jusqu'au plafond de la plateforme) : droit `mbcPhone` des formules (`plans.ts`). Essentiel, Pro, anciennes
  formules de l'admin et « custom » l'ont tant que l'abonnement est en cours (`active` ou `trialing`) ; la formule
  gratuite et une formule payée qui ne l'est plus ont `UNPAID_ENTITLEMENTS` (mêmes droits, sans le téléphone) ; une offre
  sur mesure l'a si l'admin coche « Téléphones MBC Search » (une offre enregistrée avant ne l'a pas). Le panneau affiche
  « Réservé aux formules payantes » et « Voir les formules » ; le serveur refuse la demande (`featureDenial`). Les numéros
  déjà gardés restent affichés.
