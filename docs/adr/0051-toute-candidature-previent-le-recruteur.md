# 0051. Toute candidature reçue prévient le recruteur de l'offre

Date : 2026-11-20. Statut : accepté. Modifie l'[ADR 0045](0045-alertes-profil-ideal.md) et
l'[ADR 0047](0047-correspondances-ia-nouveaux-candidats.md) pour les candidatures.

## Contexte

Jusqu'ici, une candidature ne prévenait le recruteur que si l'IA notait le candidat au moins au seuil du recruteur
(70 par défaut, ADR 0047). Une candidature sous ce seuil, ou dont l'analyse n'avait pas abouti, n'envoyait aucun
e-mail : le recruteur ne la découvrait qu'en ouvrant le tableau de bord ou le pipeline de l'offre.

Demandes de l'utilisateur, le 2026-11-20 : « always send the email when there is application no matter the score »,
puis « the recruiter don't need to configure alert, always he will be notified ».

## Décision

- **Une alerte par candidature reçue, quel que soit son score**, et même sans score : analyse non aboutie (IA
  indisponible, CV illisible) ou screening hors de la formule de l'organisation (`aiInterviews`).
  - Règle pure : `meetsAlertRule` (`src/lib/recruiter-alerts.ts`, testée). Le seuil du recruteur (« Score minimal »)
    ne s'applique plus qu'à la base candidats et aux nouveaux candidats proposés par l'IA.
- **Déclenchée à la réception, et seulement là** : `screenReceivedApplication` (`src/lib/screening-core.ts`) lance
  l'analyse, puis prévient avec le score obtenu, ou sans score. Elle est appelée en tâche de fond (`after()`) par les
  trois chemins qui créent une candidature :
  - `/api/apply` ;
  - `applyToJob` (`src/app/(public)/jobs/actions.ts`) ;
  - la proposition d'un profil par un chasseur (`proposeProfiles`, `src/lib/hunter.ts`). L'e-mail au propriétaire de
    l'organisation (« Un chasseur vous propose un profil ») reste envoyé en plus.
- **Une analyse relancée ne prévient plus** : `autoScreenApplication`, « Relancer » et la relance automatique du
  Matching IA, et le screening de toutes les candidatures n'envoient plus d'alerte de candidature. Sinon une ancienne
  candidature relancée produirait un e-mail « Nouvelle candidature ».
- **Une fois par candidature**, et non plus une fois par personne : le sujet de l'alerte est la candidature
  (`alertSubjectKey` : `candidature:<id>`). Une personne déjà signalée depuis la base qui postule ensuite prévient de
  nouveau : postuler est un autre événement. Avant cette décision, cette seconde alerte était volontairement évitée
  (ADR 0045).
- **Aucun réglage du recruteur** : l'interrupteur des e-mails de la page « Alertes » ne coupe pas l'e-mail d'une
  candidature (`alertEmailWanted`, `src/lib/recruiter-alerts.ts`, testée). L'interrupteur et le « Score minimal » ne
  concernent plus que la base candidats et les nouveaux candidats proposés par l'IA ; la page le dit.
- **Inchangé** :
  - le destinataire (recruteur affecté à l'offre, sinon son auteur, seulement s'il peut ouvrir l'offre) ;
  - pas d'alerte pour une offre partagée de la plateforme ni pour un AO de la plateforme (destinataire admin) ;
  - l'adresse vérifiée exigée pour l'e-mail : l'inscription est libre, et un compte ouvert avec l'adresse d'un tiers
    lui ferait recevoir des données de candidats (revue de sécurité du 2026-11-18). Sans elle, l'alerte reste dans la
    page, à l'état « E-mail non envoyé » ;
  - Appwrite Messaging pour l'envoi.
- **E-mail** (`idealCandidateEmail`, source `candidature`) :
  - objet « Nouvelle candidature — <offre> (<score>/100) », sans score s'il n'y en a pas ;
  - corps « Nouvelle candidature pour votre offre « <offre> » : <nom> », avec le score de l'IA ou « pas encore de score » ;
  - bouton « Voir la candidature » ;
  - sous le bouton, « Voir le Matching IA de l’offre » et le lien « Allez sur l’offre » : le détail de l'offre
    (`/recruiter/offres/<id>`), pas la candidature, déjà derrière le bouton (demandes du 2026-11-24 ; l'adresse n'est
    plus affichée en clair ; même ligne dans les alertes de la base candidats et du vivier, dont le bouton mène déjà
    au profil) ;
  - rappel « pour chaque candidature reçue sur une de vos offres, quel que soit son score ».
- **Alerte sans score** : enregistrée avec `score` vide, attribut déjà facultatif depuis l'ADR 0046. La page
  « Alertes » affiche alors « — ».

## Conséquences

- Le recruteur reçoit un e-mail par candidature : plus d'e-mails qu'avant pour une offre très demandée, et il ne
  peut pas les couper. Le seul moyen de ne plus les recevoir est de ne plus être affecté à l'offre.
- L'e-mail part après l'analyse, soit environ une minute après la candidature, plus si l'IA passe à ses replis.
- Aucune structure ni variable nouvelle : rien à pousser avant le déploiement. Il faut seulement que
  `APPWRITE_COLLECTION_RECRUITER_ALERTS` soit définie, comme pour l'ADR 0045.
- Les alertes de candidature enregistrées avant ce changement (sujet `candidat:<profil>`) restent valables. Elles ne
  sont plus recréées, puisque les analyses relancées ne préviennent plus.
- **Retour arrière** : `git revert`. Aucune donnée à reprendre. Les alertes sans score restent affichées « — ».
