// Consignes du message de demande de recommandation proposé par l'IA au candidat (espace candidat, « Demander une
// recommandation » : le candidat relit et modifie le texte avant l'envoi). Pur (aucun accès base ni session) : l'action
// generateRecommendationMessage (src/app/candidate/dashboard/recommendations-actions.ts) l'appelle, et un script
// d'exemples d'affinage peut reproduire à l'octet près ce qui est envoyé au modèle, puis nettoyer une réponse comme
// l'application.

const RECOMMENDATION_SYSTEM = 'Tu es un assistant qui aide un consultant à rédiger un message court et sincère pour demander une recommandation professionnelle.'

/**
 * Demande du message. Valeurs telles que saisies dans le formulaire (seules celles-ci sont coupées : expérience 200
 * caractères, période 60) ; `period` n'est citée qu'avec une expérience.
 */
export function recommendationMessagePrompt(input: {
  candidateFirstName: string
  candidateLastName: string
  recipientName: string
  recipientCompany?: string
  experience?: string
  period?: string
}): { system: string; user: string } {
  const candidateName = `${input.candidateFirstName} ${input.candidateLastName}`.trim()
  const recipientName = input.recipientName.trim()
  const company = input.recipientCompany ? ` (${input.recipientCompany})` : ''
  const period = input.period ? ` (${input.period.trim().slice(0, 60)})` : ''
  const experience = input.experience ? `, en rapport avec cette expérience commune : ${input.experience.trim().slice(0, 200)}${period}` : ''
  return {
    system: RECOMMENDATION_SYSTEM,
    user: `Rédige un court message personnalisé (3-4 phrases maximum) que ${candidateName} envoie à ${recipientName}${company}, un ancien employeur ou client, pour lui demander une recommandation professionnelle sur la plateforme MyBestConsultant${experience}. Le ton doit être chaleureux, sincère et professionnel — pas de formule de politesse d'ouverture/fermeture (ex: "Bonjour", "Cordialement"), juste le corps du message. Réponds uniquement avec le texte du message, sans guillemets.`,
  }
}

/** Réponse du modèle : texte libre, sans guillemets d'ouverture ou de fermeture. Vide : rien d'utilisable. */
export function cleanRecommendationMessage(content: string): string {
  return content.trim().replace(/^["«]|["»]$/g, '')
}
