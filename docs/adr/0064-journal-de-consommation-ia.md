# 0064. Journal de consommation de l'IA : jetons, modèle, coût, par fonction et par organisation

- Statut : accepté
- Date : 2026-11-26

## Contexte

MyBestConsultant appelle des modèles d'IA dans une trentaine de fonctions (notation des CV, export CV, appels d'offres,
entretiens, MBC Search, assistant…), choisis ligne par ligne dans Config IA, avec replis automatiques. Rien ne disait
combien de jetons chaque fonction consommait, quel modèle répondait vraiment (repli), combien d'appels échouaient, ni
pour quelle organisation : impossible de surveiller les coûts ou de voir un modèle en panne caché par ses replis.

## Décision

Une ligne par **essai** d'un modèle (le modèle choisi, puis chaque repli), écrite :

1. dans les journaux du serveur : `[llm-usage] {…}`, un objet JSON sur une ligne (`usageLogLine`) ;
2. dans la collection Appwrite `llm_usage` si `APPWRITE_COLLECTION_LLM_USAGE` est définie, gardée **90 jours**
   (`LLM_USAGE_RETENTION_DAYS`) : purge au fil des écritures (au plus 500 lignes par heure et par serveur) et purge
   complète chaque jour par la route de purge `/api/cron/assistant-purge` (deploy/crontab), même sans nouvel appel
   d'IA (revue de sécurité du 2026-11-26) ;
3. lue par la page admin **« Consommation IA »** (`/admin/ia-consommation`, section INTELLIGENCE) : période de 7, 30 ou
   90 jours ; requêtes, replis, échecs, jetons, coût estimé, durée médiane ; tableaux par fonction, par modèle et par
   organisation ; requêtes par jour ; 20 derniers échecs.

Contenu d'une ligne (`LlmUsageRecord`, `src/lib/ai/usage.ts`) : fonction (`feature`, kebab-case), ligne de Config IA
(`module`), organisation (`tenantId`), fournisseur et modèle, résultat (`ok`, `http-<statut>`, `timeout`, `unreachable`,
`not-configured`, `error`), numéro d'essai, jetons (entrée hors cache, sortie, cache lu, cache écrit ; null si le
fournisseur ne les donne pas), durée, coût estimé, réponse coupée à la longueur maximale. **Jamais** le texte de la
demande ou de la réponse, un identifiant de personne, ni un message d'erreur (il peut citer la demande). Une
organisation peut toutefois être un recruteur seul : son identifiant désigne alors une personne (donnée pseudonyme,
90 jours, page réservée aux admins). Dans Appwrite, le coût est un entier en millionièmes de dollar (`costMicroUsd`).

Où c'est écrit :

- `callLLM` (`src/lib/ai/llm-router.ts`) : une ligne par essai, réussi ou non, et pour un appel strict refusé avant tout
  essai. Le choix du modèle et les replis sont dans `callWithConfig`, testé sans base ni clé (essais, journal et heure
  remplacés). Chaque appelant passe `usage: { feature, tenantId }` ; `callLLMForModule` le prend en troisième argument.
- Les appels faits sans `callLLM` écrivent leur ligne eux-mêmes (`directCallRecord`) : lecture des scans des AO
  (Claude, OpenAI), test de Config IA avec des valeurs saisies, import d'offres de l'admin, groupes LinkedIn.
- L'écriture n'est jamais attendue par l'appel d'IA et ne le fait jamais échouer (journalisée si elle échoue). Sur
  Vercel (previews), une fonction arrêtée juste après sa réponse peut perdre le document (la ligne des journaux est
  déjà écrite) ; en production, le serveur Node du VPS reste en vie et termine l'écriture.

**Organisation** : celle pour qui l'appel est fait — le recruteur qui le déclenche (Rafraîchir, critères, screening,
MBC Search…), sinon celle de l'offre, de la boîte d'AO ou du CV du vivier ; `admin` pour la plateforme (offre sans
organisation, action d'un admin, script) ; vide pour un appel fait pour un candidat ou un visiteur. Elle suit la
notation par `OfferForMatching.tenantId`, sans entrer dans le message envoyé à l'IA.

**Coût estimé** (`src/lib/ai/prices.ts`) : tarifs publics relevés le 2026-11-26 pour Claude (Opus, Sonnet, Haiku 5.5
et précédents ; écriture dans le cache 1,25 × l'entrée ; palier de Haiku 5.5 au-delà de 100 000 jetons) et OpenAI
(GPT-4o, GPT-4o mini) ; prix saisis dans Config IA pour les modèles open source (0 = hébergé en interne). **Un modèle
absent de la table n'a pas de coût** (la page compte ces essais à part), jamais un prix deviné.

## Conséquences

- Un document Appwrite écrit par essai d'IA : quelques milliers par jour au plus aujourd'hui. La page lit 50 000 lignes
  au plus (`USAGE_READ_CAP`) et le dit au-delà ; totaux calculés sur le serveur (Appwrite ne fait pas de sommes).
- Les prix changent : mettre `prices.ts` à jour avec un nouveau modèle ou un nouveau tarif (date en tête du fichier).
- Non compté : synthèse et transcription de la voix (entretiens), images des publications sociales (facturées au
  caractère, à la seconde ou à l'image) ; recherches web de l'outil des groupes LinkedIn (facturées à part). Le coût de
  l'enseignant de l'affinage (scripts `finetune:*`, clé dédiée) n'est pas non plus dans ce journal.
- Une fonction ajoutée reçoit un libellé dans `src/lib/ai/usage-labels.ts` (un test vérifie que chaque `feature` du
  code en a un).

## Mise en place

1. DEV : `npm run schema:push -- dev` (collection `llm_usage`, 14 attributs, aucune permission client), puis
   `APPWRITE_COLLECTION_LLM_USAGE=llm_usage` (fichier local, portée Preview de Vercel).
2. Production, par un humain : `npm run schema:check -- prod`, `npm run schema:push -- prod`, la variable dans
   `/etc/mybestconsultant/app.env`, puis le déploiement. Sans la variable, seules les lignes des journaux sont écrites.
3. Retour arrière : **ne pas retirer la variable tant que la collection contient des lignes** (plus de purge) ;
   supprimer la collection dans la même opération que le retrait de la variable (aucune autre donnée n'en dépend ; les
   lignes des journaux restent).
