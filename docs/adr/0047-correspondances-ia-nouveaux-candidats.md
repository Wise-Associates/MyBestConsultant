# 0047. Correspondances IA des nouveaux candidats

Date : 2026-11-18. Statut : accepté. Modifie l'[ADR 0045](0045-alertes-profil-ideal.md) (seuil, alertes du vivier).
Modifié par l'[ADR 0051](0051-toute-candidature-previent-le-recruteur.md) : le seuil ne s'applique plus aux candidatures.

## Contexte

Phase 2 de la demande du PO (« Search Alerts & AI Job Matching ») : quand un nouveau candidat s'inscrit, le comparer
automatiquement aux offres actives, l'associer à celles qui lui correspondent (« AI Match », distinct d'une candidature),
prévenir le recruteur de chaque offre, et laisser le recruteur passer ces correspondances en revue dans l'offre.

Ce qui existait :

- `job_matches` garde déjà « tel candidat de la base noté X pour telle offre », affiché par le Matching IA de l'offre
  (type « Base candidats ») et alimenté par « Rafraîchir » (`runPoolMatching`, une offre contre la base).
- La notation d'un CV pour une offre de « Rafraîchir » (`cvScorer`) : barème « matching » (ADR 0036), score calculé par
  le code, intitulés vérifiés, cache des notations (ADR 0044).
- Le pré-score par le code d'un profil pour une offre (`preScore`, ADR 0044) et le cron `recruiter-alerts` (ADR 0046).

## Décision

Décisions de l'utilisateur du 2026-11-18 : barème de l'ADR 0036 gardé, seuil de 70 réglable par recruteur, préfiltre
avant l'IA, alertes du vivier retirées, cron toutes les 10 minutes. D'abord notées par lots de 5 offres (comme le vivier
général, 20 offres au plus), les offres le sont **une par une depuis le 2026-11-19** (décision de l'utilisateur, 10 offres
au plus) : sur DEV, un même CV était noté 60 par lot et 75 offre par offre pour la même offre (l'IA jugeait « secteur :
non » une offre sans secteur exigé, plafond à 60) — deux scores pour une même personne, ce que l'ADR 0029 interdit.

### Déclenchement et fiabilité

- **Au premier CV** d'un candidat (`saveCvFileId`, `firstCv`), comme les recherches enregistrées : un candidat qui
  remplace son CV ou modifie son profil n'est pas recomparé (coût ; règle de réévaluation ci-dessous).
- **Candidats exclus** : désinscrit des sollicitations (`optedOutOfOutreach`, même règle que la base candidats), sans CV,
  autre rôle (`isAutoMatchable`, testé), compte bloqué. **Adresse vérifiée exigée** (revue de sécurité du 2026-11-18 :
  inscription libre, des comptes jetables épuiseraient le quota et feraient écrire la plateforme aux recruteurs de toutes
  les organisations) : tant qu'elle ne l'est pas, la tâche attend sans essai compté et le cron la reprend (72 h au plus).
- **Tâche persistante** : un document de `ao_sync_state` par candidat (genre `automatch`, identifiant fixe
  `autoMatchTaskId`, état dans `holder` : en file, en cours, faite, en échec, abandonnée ; essais dans `count` ; fin de
  tenue dans `expiresAt`), créé **avant** la réponse, puis l'analyse tourne après la réponse (`after()`). Le cron
  `recruiter-alerts` reprend les tâches en file, en échec ou dont la tenue (15 min) a expiré, 120 s par passage
  (`sweepAutoMatching`). 3 essais au plus, 72 h au plus, puis « abandonnée » (journalisé) ; un passage encore tenu n'est
  jamais abandonné sous lui. Tâches finies purgées après 30 jours. Règles : `autoMatchDecision` (`src/lib/ai-matches.ts`,
  testé). Associations d'un essai interrompu avant ses alertes : alertées à l'essai suivant (identifiant d'alerte fixe).

### Préfiltre et notation

- Offres : toutes les offres actives non expirées (`getActiveJobs` : toutes les organisations et la plateforme, 500 les
  plus récentes), sauf celles auxquelles le candidat a postulé ou déjà associé.
- **Préfiltre sans IA** : profil extrait du CV (postes exercés et visés, compétences, ville ; `cvProfileJson`) contre
  chaque offre, par `preScore` (métier 45 %, compétences 45 %, ville 10 %) ; seules les offres à 0,2 ou plus, les 10 plus
  proches, passent à l'IA (`pickOffersForCandidate`, testé). Profil vide : aucune offre (pas d'appel au hasard).
- **Notation** : une offre par appel, 5 à la fois, par `cvScorer` comme « Rafraîchir » du Matching IA (même score dans
  l'alerte et dans l'offre ; une notation déjà faite pour le même CV et la même offre est reprise du cache sans appel),
  texte du CV comme toute notation (12 000 caractères, coordonnées masquées), raison gardée jusqu'à 1 000 caractères
  (détail du score affiché par le Matching IA). Une offre dont la notation échoue n'est pas associée ; toutes en échec :
  la tâche est réessayée.
- **Coût** : 300 candidats par jour au plus pour la plateforme (`AUTO_MATCH_DAILY_LIMIT`, compteur `autoMatchAll`) ;
  au-delà, la tâche reste en file sans essai compté. Place rendue si le CV est illisible ou sans texte, ou si toutes les
  comparaisons échouent (IA indisponible : sinon chaque essai d'une panne en prendrait une).

### Association (« AI Match »)

- Offre notée **70 ou plus** (`AUTO_MATCH_MIN_SCORE`, demande du PO) : ligne `job_matches` d'identifiant fixe
  (`poolRowId`), `origin: 'auto'`, `reviewStatus: 'nouveau'`. Déjà présente (Matching IA de l'offre) : gardée telle
  quelle, jamais de doublon.
- **Réévaluation** : « Rafraîchir » du Matching IA renote ces lignes comme les autres (score et raison seulement) : le
  statut de revue et l'origine restent. Un candidat qui postule ensuite, ou qu'on ajoute au funnel, sort de la base
  candidats comme avant (ligne retirée au « Rafraîchir » suivant, avec son statut : il est alors dans le funnel), de
  même qu'un candidat qui se désinscrit des sollicitations.
- Distinction visible : badge « Proposé par l'IA » (type « Base candidats ») ; une candidature reste une candidature.

### Revue par le recruteur

- Statuts Nouveau, Retenu, Contacté, Écarté (`src/lib/match-review.ts`, sans dépendance serveur) sur toute ligne de la
  base candidats : boutons « Retenir », « Contacté », « Écarter » (recliquer revient à « Nouveau »), filtre « Revue »
  (adresse : `revue`), compteur des nouveaux proposés par l'IA, lignes écartées en retrait. « Ajouter dans le funnel »
  passe la ligne à « Retenu ». Recherche étendue à la ville et aux compétences.
- Action `setMatchReviewAction` : offre ouverte par le recruteur (`requireJobAccess`, ADR 0043), ligne de cette offre.
- **Offres de l'organisation seulement** : les correspondances d'une offre partagée de la plateforme (`tenantId ''`) sont
  vues par toutes les organisations ; une revue de l'une s'imposerait aux autres et dirait qui elle retient (revue de
  sécurité du 2026-11-18). Sur ces offres : ni boutons, ni statut lu, ni passage à « Retenu », action refusée.

### Alertes

- **Seuil par recruteur** : préférence `alertThreshold` de son compte (70 par défaut ; 70 à 95), lue **avant**
  d'enregistrer l'alerte (un score sous le seuil n'en crée pas). Remplace le 85 fixe de l'ADR 0045, pour toutes les
  alertes d'offre (candidature, base candidats, nouveau candidat). Réglage dans « Alertes », à côté des e-mails.
- **Alertes du vivier retirées** (vivier d'une offre et vivier général) : le recruteur a importé ces CV lui-même.
- E-mail d'une correspondance IA (`highlights`) : compétences demandées que le candidat a, phrase de l'IA, critères à
  moins de la moitié des points (« à vérifier »), liens vers le profil et le Matching IA de l'offre ; source `base`,
  donc une seule alerte par candidat et par offre, que la correspondance vienne de l'inscription ou de « Rafraîchir ».
  Pas d'e-mail pour une offre partagée de la plateforme (pas de recruteur d'organisation), comme avant.

### Données

- `job_matches` : 4 attributs facultatifs (`origin` 10, `reviewStatus` 12, `reviewedAt`, `reviewedBy` 36), 9/16, et un
  index `candidateId_idx`.
- **RGPD** : les lignes `job_matches` d'un candidat (elles citent son CV), sa tâche et les alertes des recruteurs qui le
  concernent (`recruiter_alerts`, par `candidateId`) sont maintenant supprimées avec son compte
  (`deleteJobMatchesOfCandidate`, `deleteAlertsAboutCandidate` : avant le compte — un échec bloque —, puis second passage
  après la suppression de sa fiche). Elles ne l'étaient pas. Une analyse en cours relit la fiche après ses écritures et
  retire ses associations, sans alerte, si elle a disparu. `reviewedBy` (identifiant du recruteur) reste après la
  suppression de ce recruteur : simple référence.

## Conséquences

- Variable `AI_AUTO_MATCHING_ENABLED=true` (vide : rien ne change, ni comparaison ni revue ; la suppression des
  correspondances et des alertes avec le compte, elle, s'applique toujours). Le code peut être déployé avant ou après la
  structure ; seule la variable vient après.
- **Prérequis de sécurité, avant de poser la variable où que ce soit** (réglage de collection, hors `schema:push`, par un
  humain) : `job_matches` a les permissions `any` en lecture, création, modification et suppression — n'importe qui
  muni de l'identifiant du projet lit les raisons des scores (jugement de l'IA sur un CV) et peut modifier statuts et
  lignes, ou en créer d'avance pour empêcher une association. Aucune page ni aucun script ne la lit depuis le navigateur
  (vérifié le 2026-11-18) : passer ses permissions à `[]` **en production et sur DEV en même temps** (un DEV corrigé puis
  repris par `schema:pull` ferait refuser tout `schema:push -- prod` par la ligne « réglages de collection » tant que la
  production ne l'est pas), puis `schema:pull`.
- **Mise en place** : DEV — `npm run schema:push -- dev` (4 attributs et l'index `candidateId_idx` sur `job_matches`,
  aucune ligne « ✗ »), attributs et index « available » dans la console, permissions (ci-dessus), puis la variable ;
  essai : premier CV d'un candidat à l'adresse vérifiée, revue dans le Matching IA, suppression du compte (plus aucune
  ligne `job_matches` ni alerte pour lui). Production, par un humain : sauvegarde, `schema:check -- prod` (exactement ces
  ajouts sur `job_matches`, plus ceux des ADR 0045 et 0046 s'ils ne sont pas encore en production ; aucune ligne « ✗ »),
  `schema:push -- prod`, « available », permissions, puis la variable dans `/etc/mybestconsultant/app.env` et
  redémarrage. Variable sans les attributs : chaque association échoue (tâche en échec, journalisée, abandonnée après
  3 essais), la revue renvoie une erreur ; aucune donnée perdue.
- **Retour arrière** : retirer la variable (comparaison, revue et pastilles s'arrêtent ; les lignes restent des
  correspondances ordinaires de la base). Revenir sur le code est sans risque (l'ancien code ignore les nouveaux champs),
  mais retire la suppression des correspondances et des alertes avec le compte. Attributs et index peuvent rester.
- Coût : au plus 10 notations par nouveau candidat (une par offre, plus la comparaison des intitulés de chacune ; une
  notation déjà en cache ne coûte rien), 300 candidats par jour.
- Limites : pas de réévaluation automatique quand une offre est modifiée ou créée (« Rafraîchir » et le sourcing à la
  publication le font pour la base) ; pas d'e-mail groupé ; une offre au-delà des 500 offres actives les plus récentes
  n'est pas comparée ; un candidat qui ne vérifie pas son adresse sous 72 h n'est jamais comparé ; des comptes à
  adresse vérifiée peuvent encore épuiser le quota du jour (fonction suspendue jusqu'au lendemain, pas de coût au-delà).
- Tests : `src/lib/ai-matches.test.ts`, `src/lib/recruiter-alerts.test.ts`, `src/lib/matching-filters.test.ts`.
