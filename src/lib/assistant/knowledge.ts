// Contenu d'aide de l'assistant IA : la seule source de ses réponses (src/assistant/core/rules.ts, buildSystemPrompt).
// Rédigé d'après le code au 2026-10-22. À tenir à jour quand une page, un libellé ou une règle change : l'assistant
// répète ce qui est écrit ici. Ne rien promettre que le code n'applique pas (ex. limites d'annonces des formules).

/** Règles communes aux deux rôles ; la durée de conservation vient du site (ASSISTANT_RETENTION_DAYS, host.ts). */
const common = (retentionDays: number) => `COMPTE ET CONNEXION
- Inscription sur /register : onglet Candidat ou Recruteur, prénom, nom, e-mail, mot de passe de 8 caractères minimum. Un recruteur indique aussi le nom de son entreprise et un téléphone. « Continuer avec Google / LinkedIn » existe pour les candidats. Une adresse déjà utilisée est refusée.
- Un recruteur qui s'inscrit crée toujours sa propre organisation. Pour rejoindre l'équipe d'un collègue, il faut une invitation de son propriétaire de compte (lien valable 7 jours).
- Connexion sur /login (e-mail et mot de passe, ou Google / LinkedIn). Après connexion, on arrive sur son espace.
- Mot de passe oublié : lien « Mot de passe oublié ? » sur /login, puis « Envoyer le lien » ; le lien reçu mène à /reset-password (nouveau mot de passe de 8 caractères minimum). Il n'y a pas de changement de mot de passe depuis l'espace connecté : utiliser ce même lien.
- Vérification de l'e-mail : un e-mail part à l'inscription. Le bandeau « Votre adresse email n'est pas encore vérifiée » mène à /verify-email, où « Renvoyer l'email de vérification » en renvoie un. Lien expiré : en redemander un.
- Nom, prénom ou adresse e-mail à modifier, suppression du compte : ce n'est pas possible depuis l'espace ; faire une demande au support (catégorie « Mon compte ») ou écrire à contact@mybestconsultant.fr.

AIDE ET SUPPORT
- Bouton « Support Helpdesk » dans la barre du site : page « Aide & support ». « Nouvelle demande », choisir la catégorie (Un problème technique, Mon compte, Facturation & abonnement, IA & matching, Offres & candidatures, Suggestion, Autre demande) et l'importance, puis un titre et une description.
- Jusqu'à 5 pièces jointes de 8 Mo (images, PDF, documents Office, CSV, ZIP). 10 demandes ouvertes au plus : au-delà, attendre une réponse ou en clôturer une.
- Les réponses arrivent dans la demande et par e-mail. Pour répondre, utiliser le bouton du message, pas la réponse à l'e-mail. « C'est résolu » clôt la demande ; y répondre la rouvre.
- Le bouton « Transmettre au support » de l'assistant crée une demande avec cette conversation.
- Les conversations avec l'assistant sont conservées ${retentionDays} jours, puis supprimées automatiquement ; elles sont aussi supprimées avec le compte. « Nouvelle conversation » ne supprime pas la précédente. Une conversation transmise au support devient une demande d'aide.
- Contact : page /contact ou contact@mybestconsultant.fr. Mentions légales et droits RGPD (accès, rectification, suppression) : page /legal.`

const CANDIDATE = `L'UTILISATEUR EST CANDIDAT.

ESPACE CANDIDAT (/candidate/dashboard, menu « Mon compte »)
- Compteurs Candidatures, Entretiens, En cours ; liste « Mes candidatures » ; état du CV.
- Statuts d'une candidature : En attente, Screening IA, Entretien, Accepté, Refusé, Vivier. « Offre supprimée » si l'offre n'existe plus. Un candidat ne peut pas retirer lui-même une candidature : passer par le support.

CV
- « Uploader le CV » / « Changer le CV » dans l'espace candidat : PDF, DOC ou DOCX, 10 Mo au plus. L'IA tente ensuite de pré-remplir les compétences et l'expérience du profil ; si elle n'y arrive pas, le CV est quand même enregistré.

PROFIL
- « Modifier mon profil » : biographie, photo (ou récupérée depuis LinkedIn ou le CV), « En recherche de mission » activé ou non, téléphone, WhatsApp (facultatif : le renseigner autorise les recruteurs à vous contacter par WhatsApp), URL LinkedIn, ville, mobilité en km, secteur et missions recherchés, compétences. Puis « Enregistrer ».

TROUVER UNE OFFRE ET POSTULER
- Page « Offres » (/jobs) : postes, compétences ou mots-clés (combinables en ET / OU), mots à exclure, localisation, séniorité, type de contrat (Mission, Freelance, CDI, CDD), télétravail (Full remote, Hybride, Présentiel). « Rechercher les offres », « Effacer tous les filtres ».
- Sur une offre, « Postuler » : un CV est obligatoire (celui du profil, ou un fichier PDF/DOC/DOCX de 10 Mo au plus), ainsi qu'un message de motivation ; documents complémentaires possibles (PDF, DOC, DOCX, PNG, JPG). « Envoyer ma candidature ».
- Une seule candidature par offre. Chaque candidature est analysée automatiquement par l'IA de la plateforme (screening) pour le recruteur.

RECOMMANDATIONS
- Panneau « Recommandations » de l'espace candidat, « Demander une recommandation » : nom et e-mail de la personne (l'e-mail n'est jamais affiché), entreprise, lien avec vous, expérience concernée, période, expertises (1 à 8), message (« Générer avec l'IA » possible). La personne reçoit un lien, sans créer de compte, et donne une note de 1 à 5 étoiles et un commentaire, une seule fois. La recommandation apparaît « En attente » puis avec ses étoiles ; elle est visible des recruteurs.

ENTRETIEN IA
- Un recruteur peut vous envoyer un lien d'entretien (/interview/…), sans connexion. « Alex », recruteur IA, pose les questions (15 à 20 minutes environ) ; réponse à la voix ou par écrit. Pour la voix, utiliser Chrome ou Edge, ou passer en mode texte. À la fin, ne pas fermer la page pendant l'envoi ; un e-mail confirme la réception.

E-MAILS DE PROPOSITIONS DE MISSIONS
- Le lien de désabonnement présent dans ces e-mails les arrête.`

const RECRUITER = `L'UTILISATEUR EST RECRUTEUR.

ESPACE RECRUTEUR (/recruiter/dashboard, menu « Mon espace »)
- Tuiles : Publier une offre, Reporting, Mon vivier, Screening CV, Entretiens IA, CV Thèque, Suivi des annonces, Processus de recrutement, Marque employeur, Mon équipe, Appels d'offres. Statistiques : offres actives, candidatures, score moyen IA, taux de sélection.
- « Mes offres » : cliquer une offre ouvre son matching ; « N candidatures » ouvre ses candidats. Icônes Modifier, Archiver / Réactiver, Supprimer. « Publier sur les réseaux » apparaît si ce service est configuré.

PUBLIER UNE OFFRE
- « Publier une offre » : saisie manuelle ou « Import IA / Excel ». Champs : titre, localisation, type de contrat (Mission, Freelance, CDI, CDD), télétravail, TJM ou salaire, compétences, description. « Générer l'annonce » ou « Améliorer l'offre » font rédiger l'IA ; « Bibliothèque » repart d'une offre déjà publiée.
- Une offre est visible 1 mois puis désactivée automatiquement ; seule l'administration de la plateforme peut changer cette durée.
- Import : CSV, TXT, TSV, MD, DOC, DOCX, XLS, XLSX, PDF, PPTX, RTF, ODT, ODS, ODP, 5 Mo au plus par fichier ; « Télécharger le modèle Excel », puis « Analyser avec l'IA ».

SUIVRE LES CANDIDATS
- Suivi des annonces (/recruiter/annonces) : filtres Toutes / Actives / Archivées, tris, export CSV ou PDF, rapport par annonce.
- Fiche d'une candidature : CV, entretien complet, export PDF.
- Pipeline d'une offre : colonnes d'étapes, cartes à glisser-déposer ; sur une carte : lancer un screening IA, lancer un entretien IA, envoyer un e-mail personnalisé, contacter par WhatsApp, supprimer la candidature. « Ajouter une étape ».
- Processus de recrutement (/recruiter/funnel) : vos processus, phases et statuts, à partir de modèles (pipeline par défaut, plusieurs entretiens, minimal). Jusqu'à 15 processus, 20 phases, 12 statuts par phase.
- Matching d'une offre : sources Base candidats, Mon vivier, Candidature ; « Lancer le matching », « Ajouter dans le funnel ».

CV THÈQUE ET VIVIER
- CV Thèque (/recruiter/cvtheque) : candidats inscrits qui ont un CV ; filtres par mots-clés, mobilité, séniorité, localisation, secteur, disponibilité ; « Voir le CV », « Contacter » (e-mail), WhatsApp.
- Modèle CV (CV Thèque, bouton « Modèle CV » / « Ajouter votre modèle CV » en haut de la page) : tout recruteur de l'organisation dépose le modèle Word de dossier de compétences de l'organisation (.docx, 2 Mo au plus) avec sa cartographie template_map.json, qui indique où va chaque rubrique ; elle se prépare avec la skill Claude cv-esn-anonymise, sinon contactez le support. Un exemple à adapter est téléchargeable dans la même fenêtre. Le modèle est vérifié en y mettant un candidat fictif en français et en anglais (aperçu téléchargeable) ; adresse e-mail vérifiée, 20 dépôts et 30 aperçus par jour. « Retirer » enlève « Format ESN » de la CV Thèque.
- « Format ESN » (CV Thèque) : quand votre organisation a déposé son modèle CV, le CV du candidat est mis dans ce modèle par l'IA, anonymisé (nom, coordonnées, liens retirés ; en anonymisation renforcée, clients et employeurs aussi), en français et/ou en anglais. Génération en 1 à 3 minutes : abonnement actif (essai compris), adresse e-mail vérifiée, 20 générations par jour et par organisation. La dernière version est enregistrée pour votre organisation et se retélécharge sans nouvelle génération. Relisez toujours le document dans Word avant de l'envoyer.
- Vivier (/recruiter/vivier) : vos propres CV par offre, visibles de vous seul. Dépôt de plusieurs CV à la fois (PDF, DOC, DOCX, 10 Mo chacun) ; l'IA crée les fiches. « Analyser à nouveau », « Profil complet », « Supprimer ».

IA
- Screening IA (/recruiter/screening) : score de 0 à 100 par CV selon vos critères (expérience, disponibilité, langues, compétences prioritaires, instructions), « Analyser N CV », résultats de « Top profil » à « À rejeter », export CSV, « Inviter à un entretien IA ». Les meilleurs candidats toutes offres confondues : /recruiter/screening/best.
- Entretiens IA (/recruiter/interviews) : création depuis une candidature ou via « nouvel entretien » (nom, e-mail, poste, compétences, description, résumé du CV facultatif, format audio ou vidéo), « Générer les questions », « Envoyer l'entretien au candidat » ou « Copier le lien ». Questions génériques ajoutées à chaque entretien : /recruiter/interviews/questions. Ensuite « Analyser avec l'IA », « Télécharger le rapport ».
- Les résultats de l'IA aident à trier ; la décision reste celle du recruteur.

REPORTING
- /recruiter/reporting : par offre et par période (7, 30, 90 jours, tout) ; entonnoir, entretiens, temps par étape, e-mails, matching ; export CSV.

MARQUE EMPLOYEUR
- /recruiter/marque-employeur : logo (PNG, JPG, WebP), accroche, secteur, siège, année, site, LinkedIn, couverture, « À propos » (30 caractères minimum pour publier), valeurs, avantages, vidéo YouTube ou Vimeo. « Publier la page », « Enregistrer », « Voir la page ». Page publique dans l'annuaire /entreprises.

ÉQUIPE
- /recruiter/equipe : seul le propriétaire du compte invite, relance ou retire un collaborateur (prénom, nom, e-mail professionnel, « Envoyer l'invitation »). Si l'e-mail n'a pas pu partir, le lien s'affiche pour le transmettre. 15 membres au plus ; une adresse qui a déjà un compte ne peut pas être invitée ; retirer un membre supprime son compte.
- Partagé dans l'équipe : annonces, candidatures, pipelines, entretiens, reporting, marque employeur. Personnel : le vivier de CV.

BOÎTES D'APPELS D'OFFRES
- /recruiter/parametres/boites-ao : appels d'offres reçus dans les boîtes de votre organisation, lus automatiquement (tableau, filtres, commentaires internes, statistiques, export Excel, e-mail d'origine). Tous les recruteurs de l'organisation y ont accès. Chaque offre arrive « À valider » : « Préparer la publication » fait rédiger par l'IA une version totalement anonymisée et mise en forme (sans nom de société, de projet ni référence ; accroche, « Au programme », « Profil recherché », « Modalités » ; environ 30 secondes ; abonnement actif et adresse e-mail vérifiée, 30 par jour pour l'organisation, sinon une version préparée sans IA), avec un aperçu et les éléments à retirer signalés en rouge ; après relecture, cochez « J'ai relu… » (toute modification la décoche), puis « Publier » en fait une offre de votre organisation, diffusée et sourcée comme vos autres offres ; « Ignorer » la masque ; la corbeille la supprime (pas une offre publiée). Dans le détail d'une offre, « Trouver des candidats » montre les 5 meilleurs candidats de la base notés 65 ou plus (environ une minute ; abonnement actif et adresse e-mail vérifiée, 20 recherches par jour pour l'organisation). « Synchroniser maintenant » lit les boîtes tout de suite (elle continue si vous changez de page de l'espace recruteur : un bandeau l'indique, « Arrêter » est sur la page des appels d'offres), sinon elles sont lues automatiquement. Abonnement actif exigé pour la lecture des boîtes.
- /recruiter/parametres/boites-ao/boites (bouton « Boîtes de réception ») : boîtes e-mail lues pour récupérer les appels d'offres reçus. Seul le propriétaire ajoute ou modifie ; adresse e-mail vérifiée exigée. Serveur IMAP, identifiant, mot de passe, dossier lu, domaines de votre organisation. « Enregistrer » teste d'abord la connexion. 10 boîtes au plus, 30 tests de connexion par jour. Les boîtes ne sont lues que si l'abonnement est actif.

ABONNEMENT
- Page /abonnement : formules affichées Essai (gratuit), Essentiel (99 € par mois) et Pro (199 € par mois) ; paiement par carte. Pour le détail des formules, la résiliation, un changement de formule ou une facture : demande au support, catégorie « Facturation & abonnement ».`

/** Contenu d'aide pour un rôle : celles de son espace, puis les règles communes. */
export function assistantKnowledge(role: 'candidate' | 'recruiter', retentionDays: number): string {
  return `${role === 'recruiter' ? RECRUITER : CANDIDATE}\n\n${common(retentionDays)}`
}
