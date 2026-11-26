// Consignes du premier message de prise de contact d'un candidat proposé par l'IA (Sourcing IA : création d'une offre
// et /admin/sourcing ; le corps de l'e-mail envoyé est dans outreach-email.ts). Pur (aucun accès base ni session) :
// generateOutreachMessageCore (src/lib/sourcing-core.ts) l'appelle, et un script d'exemples d'affinage peut reproduire à
// l'octet près ce qui est envoyé au modèle, puis valider une réponse avec la même lecture que l'application.
import { parseModelJson } from './ai/model-json'

const OUTREACH_SYSTEM = `Tu rédiges un premier message de prise de contact d'un recruteur vers un candidat, pour lui proposer une mission. Ton : professionnel, chaleureux, direct, pas de flatterie excessive. 5-8 phrases maximum. Signe "L'équipe MyBestConsultant".

Réponds UNIQUEMENT avec un JSON valide : {"subject":"...", "message":"..."}
- "subject" est OBLIGATOIRE et JAMAIS vide : une ligne d'objet courte et concrète (ex: "Opportunité — Développeur Fullstack .NET chez [client]")
- "message" en texte brut, sauts de ligne avec \\n`

/**
 * Demande du message, à partir du profil du candidat (`users.firstName`, `users.lastName`) et de l'offre
 * (`jobs.title`, `jobs.skills`, `jobs.location`), recopiés tels quels.
 */
export function outreachMessagePrompt(input: {
  candidateFirstName: string
  candidateLastName: string
  jobTitle: string
  jobSkills?: string[] | null
  jobLocation: string
}): { system: string; user: string } {
  return {
    system: OUTREACH_SYSTEM,
    user: `Candidat : ${input.candidateFirstName} ${input.candidateLastName}\nOffre : ${input.jobTitle}\nCompétences recherchées : ${(input.jobSkills ?? []).join(', ')}\nLieu : ${input.jobLocation}`,
  }
}

/**
 * Lecture de la réponse : le premier objet JSON du texte. « subject » absent ou blanc : ligne d'objet par défaut tirée
 * de l'intitulé de l'offre (un e-mail ne part pas sans objet). Pas d'objet JSON : `error`. JSON malformé : l'erreur de
 * parseModelJson est levée (l'appelant renvoie son message).
 */
export function parseOutreachAnswer(content: string, jobTitle: string): { subject: string; message: string; error?: string } {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { subject: '', message: '', error: 'Réponse IA invalide' }
  const parsed = parseModelJson(jsonMatch[0]) as Record<string, unknown>
  const subject = String(parsed.subject ?? '').trim() || `Opportunité — ${jobTitle}`
  return { subject, message: String(parsed.message ?? '') }
}
