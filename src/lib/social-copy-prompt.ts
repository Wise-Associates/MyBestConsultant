// Textes des réseaux d'une offre rédigés par l'IA (generateCopy, social.ts) : consignes et message envoyés, et lecture
// de la réponse. Pur (ni Appwrite ni appel d'IA) : un script reproduit exactement l'appel de l'application et relit une
// réponse comme elle (exemples d'affinage).

import { parseModelJson } from '@/lib/ai/model-json'
import { WISE_POLES, normalizeCopy, type CopyDraft, type JobLite } from '@/lib/social-content'

export const SOCIAL_COPY_SYSTEM = `Tu es community manager d'une plateforme de recrutement IT. À partir d'une offre d'emploi, rédige en français un contenu pour les réseaux sociaux : percutant, sobre, sans emoji, sans promesse inventée, uniquement des informations présentes dans l'offre.
Réponds UNIQUEMENT avec un JSON valide, sans markdown :
{"hook":"accroche de 70 caractères maximum","tagline":"une phrase d'accroche inspirante de 85 caractères maximum, propre à ce poste, sans point d'exclamation","pitch":"2 à 3 phrases de présentation","missionBullets":["3 puces de 80 caractères maximum sur la mission"],"profileBullets":["3 à 5 compétences ou qualités clés, 35 caractères maximum chacune"],"context":"1 à 2 phrases, 300 caractères maximum, qui présentent le projet ou la mission : l'organisation telle que l'offre la désigne, ce qu'elle entreprend et dans quel cadre ; sans t'adresser au candidat","pole":"le pôle d'expertise de Wise Associates dont relève ce poste, exactement l'un de : ${WISE_POLES.join(', ')} ; chaîne vide si aucun ne convient","hashtags":["3 à 6 hashtags des principales expertises techniques ou métier demandées par l'offre (compétences, technologies, domaines), dans l'ordre d'importance, chacun en un seul mot sans accent ni espace ni #, écrit avec les mots de l'offre (ex. RisqueDeLiquidite, Java, AWS) ; aucun hashtag générique (recrutement, emploi, job) ni absent de l'offre"]}`

/** Consignes et message de l'utilisateur pour l'offre `job`, telle que jobLiteOf la donne (champs déjà bornés). */
export function socialCopyPrompt(job: Pick<JobLite, 'title' | 'company' | 'location' | 'skills' | 'description'>): { system: string; user: string } {
  return {
    system: SOCIAL_COPY_SYSTEM,
    user: `Offre : ${job.title}\nEntreprise : ${job.company}\nLieu : ${job.location}\nCompétences : ${job.skills.join(', ')}\nDescription : ${job.description}`,
  }
}

/**
 * Textes lus dans la réponse de l'IA : du premier « { » au dernier « } », bornés et complétés par le repli pour les
 * champs absents (normalizeCopy, qui ne refuse rien) ; sans objet JSON, le repli entier. Lève si ce JSON est illisible :
 * generateCopy prend alors le repli (fallbackCopy), comme pour une IA indisponible.
 */
export function parseSocialCopy(content: string, job: JobLite): CopyDraft {
  const m = content.match(/\{[\s\S]*\}/)
  return normalizeCopy(m ? parseModelJson(m[0]) : null, job)
}
