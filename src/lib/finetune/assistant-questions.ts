// Questions d'utilisateurs inventées pour les exemples de l'assistant IA (ADR 0063) : l'assistant n'a que quelques
// échanges réels (conservés 30 jours). Écrites d'après son contenu d'aide (src/lib/assistant/knowledge.ts) : questions
// couvertes, questions hors du contenu (la bonne réponse est « je ne sais pas » et le support), situations personnelles
// (orienter vers le support), fautes de frappe et style oral, et quelques suites de conversation (`followUp`).

export interface AssistantQuestion {
  role: 'candidate' | 'recruiter'
  question: string
  /** Seconde question posée après la réponse de l'assistant : exemple de conversation à deux tours. */
  followUp?: string
}

const candidate = (question: string, followUp?: string): AssistantQuestion => ({ role: 'candidate', question, followUp })
const recruiter = (question: string, followUp?: string): AssistantQuestion => ({ role: 'recruiter', question, followUp })

export const ASSISTANT_QUESTIONS: AssistantQuestion[] = [
  candidate('Comment je change mon CV ?'),
  candidate('Quels formats de CV sont acceptés et quelle taille max ?'),
  candidate("J'ai oublié mon mot de passe, je fais comment ?", 'Et si le lien a expiré ?'),
  candidate("je n'ai jamais reçu l'email de vérification"),
  candidate('Comment modifier mon adresse e-mail ?'),
  candidate('Je veux supprimer mon compte et toutes mes données.'),
  candidate('Comment postuler à une offre ?', 'Je peux joindre des documents en plus du CV ?'),
  candidate('Est-ce que je peux postuler deux fois à la même offre ?'),
  candidate("Comment retirer ma candidature ? Je me suis trompé d'offre"),
  candidate('Que veut dire le statut « Vivier » sur ma candidature ?'),
  candidate('Ma candidature est en « Screening IA » depuis une semaine, c’est normal ?'),
  candidate('Comment chercher uniquement des missions en full remote ?'),
  candidate('Je peux combiner plusieurs mots-clés dans la recherche d’offres ?'),
  candidate("C'est quoi l'entretien IA ? On m'a envoyé un lien"),
  candidate("L'entretien vocal ne marche pas sur Safari", 'Je peux répondre par écrit à la place ?'),
  candidate('Combien de temps dure l’entretien avec Alex ?'),
  candidate('Comment demander une recommandation à un ancien manager ?'),
  candidate('Le recruteur verra-t-il l’e-mail de la personne qui me recommande ?'),
  candidate('Comment arrêter de recevoir les e-mails de propositions de missions ?'),
  candidate('Pourquoi mon profil n’a pas été rempli automatiquement après l’upload du CV ?'),
  candidate('Comment indiquer que je ne suis plus disponible ?'),
  candidate('Mettre mon numéro WhatsApp, ça sert à quoi ?'),
  candidate('Quel est mon score IA pour l’offre de chef de projet ?'),
  candidate('Pourquoi ma candidature a été refusée ?'),
  candidate('Combien de candidats ont postulé à la même offre que moi ?'),
  candidate('Quel salaire je peux demander pour un poste de data engineer à Lyon ?'),
  candidate('Pouvez-vous m’aider à rédiger ma lettre de motivation ?'),
  candidate('Comment contacter le support ?', 'Je peux joindre une capture d’écran ?'),
  candidate('Où trouver vos mentions légales et mes droits RGPD ?'),
  candidate('Combien de temps gardez-vous mes conversations avec vous ?'),
  candidate('Puis-je me connecter avec LinkedIn ?'),
  candidate('Est-ce que MBC Agency peut m’accompagner dans ma recherche ?'),
  candidate('mon cv fait 15 Mo il passe pas'),
  candidate('Vous pouvez supprimer le CV que j’ai envoyé par erreur sur mon profil ?'),
  candidate('Is there an English version of the website?'),

  recruiter('Comment publier une offre ?', 'Et je peux importer plusieurs offres depuis un fichier Excel ?'),
  recruiter('Combien de temps une offre reste-t-elle en ligne ?'),
  recruiter('Je veux prolonger mon offre au-delà d’un mois.'),
  recruiter('Quels formats de fichiers l’import IA accepte-t-il ?'),
  recruiter('Comment inviter un collègue dans mon équipe ?', "L'invitation n'est pas arrivée, je fais quoi ?"),
  recruiter('Mon collègue voit-il mon vivier de CV ?'),
  recruiter('Combien de membres maximum dans une équipe ?'),
  recruiter('Comment fonctionne le score du Matching IA ?'),
  recruiter('Que signifie « Correspond (65 et plus) » ?'),
  recruiter('Comment exiger une certification précise dans le screening ?'),
  recruiter("Comment lancer un entretien IA pour un candidat ?", 'Le candidat doit-il créer un compte ?'),
  recruiter('Comment ajouter une étape à mon pipeline ?'),
  recruiter('Combien de processus de recrutement je peux créer ?'),
  recruiter('Comment importer des CV dans mon vivier général ?'),
  recruiter('Pourquoi mes CV du vivier ne sont comparés à aucune offre ?'),
  recruiter('Comment exporter un CV au format de notre cabinet ?', 'On doit fournir notre propre modèle Word ?'),
  recruiter('La recherche « Java » me renvoie pas les profils JavaScript, c’est voulu ?'),
  recruiter('Comment enregistrer une recherche dans la CV Thèque ?'),
  recruiter('Je reçois un e-mail à chaque candidature, je peux régler un score minimum ?'),
  recruiter('Comment exporter le reporting de mes offres ?'),
  recruiter('Comment publier notre page marque employeur ?'),
  recruiter('Comment ajouter une boîte e-mail pour recevoir les appels d’offres ?'),
  recruiter('Tous mes collègues voient-ils les appels d’offres de l’organisation ?'),
  recruiter('Combien coûte l’abonnement Pro ?', 'Comment je résilie ?'),
  recruiter('Je veux une facture pour le mois dernier.'),
  recruiter('Pouvez-vous me donner la liste des candidats de mon offre de développeur Java ?'),
  recruiter('Changez le statut de ma candidate Claire Morel en « Accepté » svp'),
  recruiter('Est-ce que l’IA décide qui est retenu ?'),
  recruiter('Combien d’annonces je peux publier avec l’offre Essentiel ?'),
  recruiter('Vous avez une API pour connecter notre ATS ?'),
  recruiter('comment je retourne a la liste de mes offres depuis le pipeline'),
  recruiter('Comment archiver une offre pourvue ?'),
  recruiter('Peut-on publier automatiquement nos offres sur LinkedIn ?'),
  recruiter('Je ne trouve pas le bouton pour changer mon mot de passe dans mon espace.'),
  recruiter('Comment rejoindre l’organisation de mon entreprise qui existe déjà sur la plateforme ?'),
  recruiter('Combien de temps gardez-vous les conversations avec l’assistant ?'),
  recruiter('Can I use the platform in English?'),
]
