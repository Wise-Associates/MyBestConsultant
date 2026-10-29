# 0010 — Export « Format ESN » dans la CV Thèque des recruteurs : un modèle par organisation

- Statut : accepté
- Date : 2026-10-23
- Complète : 0009 (export au format ESN, admin)
- Complétée par : 0014 (le .docx seul au dépôt, cartographie écrite par l'IA), 0016 (CV du vivier des recruteurs)

## Contexte

L'admin exporte déjà les candidats de la CV Thèque dans le modèle Word de Wise Associates (ADR 0009). Les recruteurs
des autres organisations veulent la même chose depuis leur CV Thèque (`/recruiter/cvtheque`). Le modèle Wise porte le
bandeau de Wise Associates et le bloc contact de son commercial : il ne peut pas servir à une autre ESN. Chaque
génération coûte un ou deux appels d'IA à la plateforme, et l'inscription des recruteurs est libre.

## Décision

**Un modèle par organisation** (décision du 2026-10-23), **déposé depuis sa CV Thèque** (décision du 2026-10-24, qui
remplace le dépôt par l'admin dans Admin → Entreprises : cette liste sera réservée au super-admin de la plateforme, les
administrateurs d'une entreprise ne la verront pas) : le .docx de l'ESN et le `template_map.json` produit pour ce
fichier par la skill `cv-esn-anonymise` (Étape 2). Dans `/recruiter/cvtheque`, **tout recruteur** de l'organisation
dépose, remplace ou retire le modèle (organisation lue dans la session) ; dans `/admin/cvtheque`, l'admin dépose celui
de la plateforme, qui garde le modèle Wise Associates du dépôt tant qu'elle n'en a pas déposé d'autre (le retirer y
revient). La cartographie reste à fournir : une organisation qui ne peut pas la produire la demande à l'équipe ; une
cartographie écrite par l'IA au dépôt est une étape ultérieure possible. Le dépôt est vérifié avant d'être enregistré : cartographie au bon format (`parseTemplateMap`, libellés
français et anglais exigés), 2 Mo au plus (un export français + anglais, environ deux fois le modèle, doit rester sous
les 4,5 Mo des réponses des fonctions Vercel), archive saine (décompression réelle bornée, et somme des tailles
annoncées bornée à 50 Mo avant toute décompression — fflate réserve la mémoire d'après elles, ce qui arrête aussi une
archive ZIP64 piégée), puis rendu d'un candidat fictif en français et en anglais (`checkTemplate`, refait avant chaque
génération d'un recruteur, avant le quota et l'IA) — un index ou un prototype qui ne correspond pas au fichier est refusé au dépôt, pas à la
première génération. Celui qui dépose télécharge ensuite cet aperçu fictif pour vérifier la mise en page. Chaque dépôt
coûte deux rendus (jusqu'à 50 Mo décompressés) : adresse e-mail vérifiée (inscription libre) et 20 dépôts par jour et
par organisation pour les recruteurs. Pour préparer un modèle, la fenêtre propose un exemple (.zip) : une copie du
modèle Wise Associates dont le bloc contact — nom, téléphone et e-mail d'un commercial de Wise Associates — est
remplacé par des valeurs fictives (`templates/example/`, testé) ; le modèle Wise lui-même n'est jamais servi aux
recruteurs.

- Stockage : collection `cv_templates` (un document par organisation, d'identifiant celui de l'organisation, « admin »
  pour la plateforme : un seul modèle par construction) et bucket privé `cv_templates` (chiffré, sans permission
  client).
- Organisation sans modèle : pas de bouton « Format ESN » sur les candidats, seulement « Ajouter votre modèle CV ».
  Modèle retiré : le bouton disparaît, les versions déjà enregistrées restent téléchargeables. Plateforme revenue au
  modèle Wise après le retrait du sien : les versions faites avec le modèle retiré ne sont pas signalées comme
  anciennes (la date de dépôt ne distingue pas les modèles).

**Versions enregistrées par organisation** : `cv_exports` reçoit `tenantId` et son index unique devient
(`candidateId`, `tenantId`, `mode`, `lang`) — `candidateId` en premier pour servir aussi la recherche par candidat seul
(suppression avec le compte). Chaque organisation ne voit et ne retélécharge que les siennes, rendues
dans son modèle ; une version antérieure au dépôt du modèle actuel est signalée comme ancienne. Le contrôle des fuites compare au modèle de l'organisation (son bloc contact lui appartient). La
suppression avec le compte du candidat couvre toutes les organisations (fichiers retrouvés par leur nom, qui ne porte
pas l'organisation). Les organisations ne sont jamais supprimées dans l'application : pas de purge par organisation.

**Accès et coût** (décision du 2026-10-23) :

- Route `/api/recruiter/cv-export/[candidateId]` : rôle recruteur, organisation lue dans la session, jamais dans la
  requête. Mêmes candidats que la CV Thèque (candidats inscrits qui ont un CV) ; pas le vivier.
- Générer (POST) : modèle déposé, abonnement de l'organisation `active` ou `trialing` (même règle que l'AO,
  `generationDenial`), adresse e-mail vérifiée, et quota quotidien en places atomiques (`takeDailySlotId`) : 20 par
  organisation, 300 pour toutes les organisations (l'admin n'est pas compté). Les places sont prises juste avant le
  premier appel d'IA (un CV introuvable ou illisible n'en consomme pas) et rendues (`releaseDailySlot`) si l'IA refuse
  sans frais (non configurée, crédits, clé, panne) ; la place de l'organisation est rendue si le plafond de la plateforme
  refuse. Retélécharger (GET) : sans condition d'abonnement ni quota, rien n'est facturé.
- Messages aux recruteurs : une panne ou une configuration de l'IA donne « Génération indisponible pour le moment »,
  sans détail de Config IA (journalisé pour l'admin).
- Le cœur des routes (`http.ts`) et la fenêtre (`src/components/cv-export/esn-export-dialog.tsx`) sont partagés par
  l'admin et les recruteurs ; chaque route vérifie son appelant avant de les appeler.

## Mise en place

En deux temps (étendre, puis resserrer), pour que l'ancien code encore en ligne ne puisse pas créer de doublon :

1. `npm run cv-export:setup -- <env>` (simulation), puis `--apply` : crée `cv_templates` (collection et bucket),
   ajoute `tenantId` à `cv_exports`, rattache les versions existantes à la plateforme, crée le nouvel index unique. L'ancien
   index unique (`candidateId`, `mode`, `lang`) est gardé.
2. Déployer le code.
3. `--apply --drop-old-index` : rattache les versions écrites entre-temps par l'ancien code, puis supprime l'ancien index.
   Une simulation doit ensuite finir par « Rien n'a été modifié. » sans ligne « + », « ~ » ni « - ».
4. Seulement alors, définir `APPWRITE_COLLECTION_CV_TEMPLATES` et `APPWRITE_STORAGE_CV_TEMPLATES` (avant l'étape 3,
   l'ancien index refuserait la version d'un recruteur pour un candidat déjà exporté par la plateforme).

Production (un humain) : les ADR 0009 et 0010 partent ensemble ; déployer sans les variables, sauvegarder la base,
`--prod` puis `--prod --apply` (création complète : rien à rattacher, pas d'ancien index), `--prod` pour vérifier, puis
définir les **quatre** variables (`CV_EXPORTS` et `CV_TEMPLATES`, collection et bucket) en portée Production et
redéployer.

**Retour arrière** : ne jamais revenir sur le code une fois la migration faite — l'ancien code chercherait la version
par candidat seulement et écraserait celle d'une autre organisation. Pour couper la fonction côté recruteurs, retirer
les variables `CV_TEMPLATES` (le bouton disparaît). Si revenir sur le code est inévitable : supprimer d'abord les
documents de `cv_exports` dont `tenantId` n'est pas « admin » et leurs fichiers (régénérables), recréer l'index
`candidateversion`, puis revenir sur le code. Ne plus utiliser d'ancienne URL de preview après la migration.

## Conséquences

- Un modèle mal cartographié peut passer la vérification et rendre mal (alignements, espacements) : l'aperçu fictif est
  là pour ça ; un modèle corrigé remplace l'ancien sans toucher aux versions déjà générées.
- Le coût de l'IA reste à la plateforme ; les quotas se règlent dans `CV_EXPORT_DAILY_LIMITS` (`access.ts`).
- Les organisations gèrent leur modèle elles-mêmes (2026-10-24), mais la cartographie demande encore la skill : une
  cartographie écrite par l'IA au dépôt (inspection du modèle, puis aperçu à valider) reste à faire si elles ne
  peuvent pas la produire.
- Tout modèle déposé est du contenu non fiable rendu sur le serveur : archive vérifiée (tailles réelles, nombres
  d'entrées concordants, pas de zip64), parties XML de 5 Mo au plus, et structure bornée (20 000 éléments, 500 enfants
  sous un même élément : `render.ts`) — sans ces bornes, des paragraphes vides en grand nombre bloquaient le serveur
  des dizaines de secondes à chaque rendu (revue de sécurité du 2026-10-24). Chaque rendu déclenché par un recruteur
  passe par un quota : dépôt (20 par jour), aperçu (30 par jour), génération (le rendu de vérification après la prise
  des places, qui sont rendues si le modèle est inutilisable).
- Les exports perdent le modèle Word d'origine du template (`attachedTemplate`, chemin local avec le nom de session
  Windows de son auteur ; `<Template>` de `app.xml`).
