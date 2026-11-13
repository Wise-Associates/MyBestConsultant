# 0034 — Formules, droits des organisations et offres sur mesure

- Statut : accepté (étapes 1 et 2 livrées le 2026-11-13 ; étape 3 à venir)
- Date : 2026-11-13

## Contexte

Demande du 2026-11-13 : une formule « sur mesure » en plus d'Essentiel et Pro, et une meilleure place pour le choix de la
formule. État constaté :

- Les formules ne limitaient rien : seul l'état de l'abonnement (`active` ou `trialing`) ouvrait MBC Search, le suivi des
  appels d'offres et l'export « Format ESN ». Les 3 ou 5 offres actives annoncées sur `/abonnement` n'étaient appliquées
  nulle part ; les quotas du jour et les 15 utilisateurs étaient les mêmes pour toutes les organisations. Les entretiens
  IA et le screening ne vérifiaient pas l'abonnement.
- Deux listes de formules : celle de Stripe et de la page publique (`essentiel`, `pro`, prix dans `stripe.ts` et
  `pricing-client.tsx`) et celle de l'admin (`free`, `gold`, `max`, montants saisis).
- Changer de formule créait un second abonnement Stripe sans résilier le premier : l'organisation payait les deux.
- Le webhook Stripe avalait toute erreur (évènement perdu, paiement sans activation), appliquait les évènements d'un
  ancien abonnement (sa résiliation coupait le nouveau), coupait l'accès sur un premier paiement refusé et remplaçait la
  date de début à chaque paiement.
- `tenants` est à 16/16 attributs.

## Décision

Choix de l'utilisateur (2026-11-13) :

- La page publique `/abonnement` présente les formules et une carte « Sur mesure » (demande de devis) ; une organisation
  connectée choisit, paie, voit son offre sur mesure et ses factures dans `/recruiter/abonnement` (étape 3).
- L'admin prépare une offre sur mesure pour une organisation ; son propriétaire (ou un administrateur) l'accepte
  (étape 2). Paiement par Stripe : carte, ou facture envoyée par Stripe et réglée par virement (au choix de l'admin
  pour chaque offre), au mois ou à l'année. Sur facture, l'accès s'ouvre à l'acceptation ; facture impayée à
  l'échéance (`invoice.overdue`) : « Paiement en retard », fonctions réservées fermées.
- Une offre sur mesure peut changer le prix et la période, le nombre d'utilisateurs et d'offres actives, les quotas du
  jour et les fonctions comprises.
- Les formules standard (gratuite, Essentiel, Pro, anciennes `gold` / `max`) **gardent les droits d'avant** : aucune
  organisation ne perd d'accès. Appliquer la page des formules (3 ou 5 offres actives…) se fera dans `plans.ts`.

### Étape 1 (livrée) : une liste de formules, des droits vérifiés côté serveur, Stripe corrigé

1. **Formules et droits** (`src/lib/plans.ts`, pur, testé) : `PlanId`, prix des formules payées par carte
   (`PLAN_PRICE_CENTS`), noms (`planLabel`), droits (`Entitlements` : utilisateurs, offres actives — `null` sans
   limite —, fonctions `mbcSearch` / `aiInterviews` / `aoSourcing` / `cvExport`, quotas du jour de l'organisation).
   `STANDARD_ENTITLEMENTS` = valeurs d'avant (15 utilisateurs, offres sans limite, tout ouvert, quotas d'avant).
   `entitlementsOf(tenant, customTerms)` : conditions de l'offre sur mesure pour la formule `custom`, sinon standard.
   Les modules gardent leur plafond pour toutes les organisations (`allOrganisations`) ; leur `perOrganisation` vient
   de `STANDARD_DAILY_QUOTAS`, et leurs messages prennent la limite de l'organisation.
2. **Lecture** (`src/lib/tenant-access.ts`, serveur) : `loadTenantAccess(tenantId)` relit l'organisation au moment
   d'agir (plateforme : tous les droits) ; `activeJobsLimitDenial(tenantId)` compte les offres actives non expirées.
   L'étape 2 y lira l'offre sur mesure : les contrôles n'auront pas à changer.
3. **Contrôles**, chacun dans son point d'entrée :
   - utilisateurs : `inviteMember` (`team.ts`) ; pages Utilisateurs et Organisation (« n / max ») ;
   - offres actives : création (`createJobAction`), remise en ligne (`toggleJobStatusAction`), publication d'un AO
     (`publishRecruiterAoOffer`), import (`confirmImport`, `importJobsChunk` : toutes les offres de l'import ou du lot
     comptées). Compte puis écriture sans verrou : deux publications simultanées peuvent dépasser la
     limite d'une offre (limite commerciale, pas de sécurité) ;
   - MBC Search (`searchSlot`, `revealForRecruiter`) ; suivi des appels d'offres (`aoRefusal`, `tenancy.ts` : boîtes
     lues par le passage planifié, route de synchronisation, actions et pages du tableau AO) ; export « Format ESN »
     (`recruiterExportState`, et dépôt ou aperçu du modèle CV : `takeTemplateSlot`) ;
   - entretiens IA et screening (`src/lib/interview-access.ts`, hors des fichiers « use server ») : questions, relances,
     analyse, session, nouvelle analyse, screening manuel et automatique. L'état de l'abonnement n'y est pas exigé
     (droits d'avant). Un entretien déjà envoyé à un candidat se termine normalement (pages `/interview/<session>`, non
     contrôlées) : le candidat n'est pas pénalisé par la formule de l'organisation ;
   - quotas du jour : MBC Search, profils révélés, export, recherche de candidats AO, relances et rédactions AO,
     comparaisons du vivier.
4. **Choix d'une formule payante** (`startSubscriptionCheckout`, règles `checkoutStep` de `src/lib/billing.ts`) :
   aucun abonnement → création ; ouvert jamais payé → annulé (détaché d'abord) puis remplacé ; en cours → la formule
   change sur le même abonnement (`subscriptions.update`, prorata), la formule affichée change aussitôt ; retard de
   paiement → refus. Clés d'idempotence (client par organisation ; abonnement par organisation, formule, abonnement
   remplacé et minute) : deux demandes simultanées n'ouvrent pas deux abonnements. Erreurs Stripe journalisées,
   message générique ; 20 s au plus par appel et une nouvelle tentative réseau (`getStripe`).
5. **Webhook** (`/api/stripe/webhook`, règles `tenantPatchFor`) : abonnement relu chez Stripe (évènements dans le
   désordre) ; évènements d'un autre abonnement que celui de l'organisation ignorés ; une organisation sans abonnement
   enregistré adopte celui qu'elle vient de payer ; un paiement n'ouvre l'accès que si Stripe dit l'abonnement en cours
   (un « paiement réussi » rejoué après une résiliation ne la défait pas) ; `customer.subscription.updated` reprend la
   formule et l'état en cours ; premier paiement refusé ou abandonné sans effet ; date de début gardée ;
   `invoice.overdue` → retard ; erreur → 500, Stripe renvoie l'évènement (écritures en valeurs absolues).
   Remplacement d'un abonnement jamais payé : détaché de l'organisation avant son annulation (sinon son évènement de
   suppression la marquerait « résiliée »), rattaché de nouveau si l'annulation échoue. Facture relue aussi : un
   « paiement échoué » ou un retard traité après le paiement de la facture n'agit plus. Un abonnement payé est adopté si
   celui enregistré n'est plus en cours (deux paiements ouverts en même temps) ; sinon le paiement est journalisé en
   erreur, à rembourser ou rattacher à la main.
6. **État posé par l'admin** (« Suspendre », remboursement : `suspended`, `refunded`, `isAdminHold`) : jamais remplacé
   par un évènement Stripe (l'abonnement Stripe reste actif), et l'organisation ne peut pas changer de formule ; seul
   l'admin le lève. Revue de sécurité du 2026-11-13 : sans cela, changer de formule rouvrait aussitôt une organisation
   suspendue.

### Étape 2 (livrée) : offres sur mesure

1. **Stockage** : collection `plan_offers` (`appwrite.config.json`), un document par organisation (identifiant = celui
   de l'organisation), sans droit côté navigateur ; variable `APPWRITE_COLLECTION_PLAN_OFFERS` (vide : pas d'offre sur
   mesure). Champs : nom, état (`proposed`, `accepted`, `withdrawn`), prix en centimes, période, paiement (`card`,
   `invoice`), délai de paiement, utilisateurs, offres actives (vide : sans limite), fonctions, quotas (JSON), fin de
   validité, dates de proposition et d'acceptation, compte qui l'a acceptée, abonnement Stripe.
2. **Règles** (`src/lib/plan-offers.ts`, pur, testé) : saisie validée (zod ; date réelle, validité de 3 ans au plus),
   relue sans jamais deviner un droit (document illisible : aucune offre ; un quota ajouté après l'offre prend la valeur
   standard, un plafond abaissé ne la rend pas illisible), état affiché (une proposition passée est « expirée »).
   **Une offre acceptée est figée** tant qu'elle est le contrat de l'organisation (formule `custom`) et pendant les 24 h
   d'un paiement par carte en cours ; ensuite (paiement abandonné, organisation passée à une autre formule) l'admin peut
   la remplacer ou la retirer. Une offre acceptée mais impayée ne se paie plus après sa validité. Seules les conditions
   d'une offre acceptée s'appliquent (`acceptedTerms`) ; **formule `custom` qui n'est plus payée** (retard, résiliation,
   suspension) : les plus bas de l'offre et des droits standard (`lowerOf`), ni les conditions négociées sans les payer,
   ni plus de droits que l'offre n'en donnait.
3. **Admin** (`/admin/subscriptions`) : une seule liste de formules (Gratuite, Essentiel, Pro, Sur mesure ; Gold et Max
   restent lisibles et proposées à l'abonné qui les a), saisie validée (zod) ; bouton « Offre sur mesure » par
   organisation (`custom-offer-modal.tsx`) : proposer, modifier ou retirer une proposition (`saveCustomOfferAction`,
   `withdrawCustomOfferAction`, session admin vérifiée, organisation existante).
4. **Organisation** (`/recruiter/abonnement`, carte « Votre offre sur mesure ») : conditions, puis acceptation par le
   propriétaire ou un administrateur après une case « J'accepte… » (`acceptCustomOfferAction` : conditions et prix lus
   sur l'offre enregistrée, jamais dans la demande ; organisation suspendue refusée). Stripe (produit
   `mbc-plan-custom`, `metadata.planId: custom`) :
   - **facture** : abonnement `collection_method: send_invoice` (délai de l'offre), facture envoyée par Stripe ; la
     formule `custom` s'ouvre tout de suite, une facture impayée à l'échéance la ferme (`invoice.overdue`) ;
   - **carte** : formulaire de carte ; la formule s'ouvre au paiement confirmé par le webhook ;
   - abonnement standard déjà payé par carte : changé sur place (prix de l'offre, prorata), sans second abonnement.
   L'offre est réécrite en entier avec les conditions facturées (`acceptedDocument`), qui a accepté et quand. Une
   écriture qui échoue après Stripe se refait : un abonnement de l'offre déjà en cours chez Stripe (enregistré, ou
   retrouvé parmi ceux du client) n'est jamais doublé, et son prix est remis à celui de l'offre ; facture : clé
   d'idempotence liée à l'offre. Carte sur un abonnement déjà payé : `error_if_incomplete`, l'accès ne s'ouvre que si
   Stripe accepte le paiement. Organisation et offre relues juste avant d'écrire : une suspension posée entre-temps
   n'est pas effacée (abonnement Stripe journalisé, à annuler à la main). Une organisation réglée sur facture ne passe
   pas seule à une formule payée par carte (« contactez-nous »). Webhook : un abonnement que Stripe met « en retard »
   (`customer.subscription.updated`, facture impayée à l'échéance) ferme l'accès, sans dépendre d'`invoice.overdue`.
   Erreurs Stripe journalisées par leur type et leur code seulement (leur message peut citer une adresse e-mail).
5. **Droits** : `loadTenantAccess` et le passage planifié des boîtes AO (`loadOrganizations`, `sources.ts`) lisent
   l'offre acceptée d'une organisation `custom`. Collection ou base introuvable (variable posée avant la création de la
   collection) : une panne qui remonte, jamais « aucune offre » ; dans le passage planifié, seules les organisations
   `custom` du lot sont alors tenues pour non abonnées.

### Étape 3 (à venir) : pages

`/recruiter/abonnement` : formule actuelle, cartes des formules, paiement, offre sur mesure. `/abonnement` : carte
« Sur mesure » (devis), « Gérer mon abonnement » pour un recruteur connecté.

## Conséquences

- **Stripe** : le webhook doit recevoir `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.overdue`,
  `customer.subscription.updated` et `customer.subscription.deleted` (Développeurs → Webhooks). Sans les deux nouveaux,
  le changement de formule reste affiché (écrit par l'action) et le retard sur facture n'est pas vu.
- Aucune variable d'environnement ni aucun changement de structure à l'étape 1. **Étape 2** : collection `plan_offers`
  (`npm run schema:push -- dev`, production par un humain : `schema:check -- prod` puis `schema:push -- prod`) et
  variable `APPWRITE_COLLECTION_PLAN_OFFERS=plan_offers` (`.env.local`, `app.env` du VPS), posée **après** la création
  de la collection. Dans Stripe : envoi par e-mail des factures finalisées (Paramètres → Facturation), virement bancaire
  parmi les moyens de paiement des factures, et passage « en retard » d'un abonnement dont la facture n'est pas payée à
  l'échéance (Paramètres → Abonnements et e-mails), pour les offres réglées sur facture.
- Organisations qui payent déjà deux abonnements (ancien défaut) : à repérer et résilier dans Stripe à la main ; seul
  celui enregistré sur l'organisation agit sur elle.
- Les plafonds pour toutes les organisations restent : une offre sur mesure aux quotas élevés reste bornée par eux.
- **Mise en production de l'étape 2** : déployer le code variable vide (fonction coupée), créer la collection
  (`schema:check` puis `schema:push`, attributs « available » et aucune permission dans la console), puis seulement
  poser la variable et redéployer. Retour arrière : vider la variable (les organisations `custom` repassent aux droits
  standard alors que Stripe facture encore l'offre : les traiter dans Stripe d'abord) ; ne jamais supprimer la
  collection tant qu'une offre est acceptée (conditions du contrat, lien Stripe) : l'exporter d'abord.
- **Concurrence** : Appwrite n'a pas d'écriture conditionnelle. Admin et organisation relisent juste avant d'écrire ;
  il reste un instant où une proposition enregistrée par l'admin pendant une acceptation est remplacée par les
  conditions acceptées (journalisé).
- `plan_offers` a 15 attributs sur 16 : une donnée de plus (historique, demande de devis) ira dans une autre collection.
- **Données personnelles** : `acceptedBy` est l'identifiant du compte qui a accepté (preuve du contrat), gardé avec
  l'offre ; la suppression d'un compte ne le retire pas (identifiant sans compte). Durée de conservation à fixer avec
  le responsable des données (proposition : durée du contrat puis 5 ans).
