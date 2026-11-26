// Consignes et lecture des réponses de l'assistant IA de rédaction d'une offre (« Publier un job » : générer une
// annonce à partir d'un besoin, puis « Améliorer l'offre »). Pur (aucun accès base ni session) : les actions de
// src/app/recruiter/dashboard/ai-job-draft-actions.ts l'appellent, et un script d'exemples d'affinage peut reproduire à
// l'octet près ce qui est envoyé au modèle, puis valider une réponse avec la même lecture que l'application.
import { parseModelJson } from './ai/model-json'

export interface JobDraft {
  title: string
  description: string
  skills: string[]
  location: string
  contractType: '' | 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote: '' | 'onsite' | 'hybrid' | 'remote'
  salary: number | null
}

const CONTRACT_TYPES = new Set(['cdi', 'cdd', 'freelance', 'mission'])
const REMOTE_TYPES = new Set(['onsite', 'hybrid', 'remote'])

function toDraft(parsed: Record<string, unknown>): JobDraft {
  return {
    title: String(parsed.title ?? '').slice(0, 200),
    description: String(parsed.description ?? ''),
    skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 10).map(String) : [],
    location: String(parsed.location ?? ''),
    contractType: CONTRACT_TYPES.has(String(parsed.contractType)) ? (parsed.contractType as JobDraft['contractType']) : '',
    remote: REMOTE_TYPES.has(String(parsed.remote)) ? (parsed.remote as JobDraft['remote']) : '',
    salary: typeof parsed.salary === 'number' ? parsed.salary : null,
  }
}

const FIELDS_JSON_SHAPE = `{"title":"Titre du poste concis","description":"Description complète en plusieurs paragraphes : contexte de la mission, missions principales (liste), profil recherché (liste)","skills":["compétence1","compétence2"],"location":"ville ou région, '' si non précisé","contractType":"cdi|cdd|freelance|mission ou '' si non précisé","remote":"onsite|hybrid|remote ou '' si non précisé","salary":number ou null — TJM pour freelance/mission, salaire annuel pour cdi/cdd}`

const DRAFT_SYSTEM = `Tu es un expert en rédaction d'annonces d'emploi pour un cabinet de conseil en recrutement.
À partir des informations données par le recruteur, rédige une annonce structurée et professionnelle.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
${FIELDS_JSON_SHAPE}

Règles :
- Le titre doit être clair et attractif (ex: "Consultant SAP FI/CO Senior")
- La description doit inclure : contexte, missions (avec des tirets "- "), profil recherché (avec des tirets "- ")
- Les sauts de ligne dans "description" doivent être de vrais \\n
- 5 à 10 compétences clés maximum dans "skills"
- Ne déduis location/contractType/remote/salary que si le besoin exprimé les mentionne, sinon laisse-les vides`

const IMPROVE_SYSTEM = `Tu es un expert en rédaction d'annonces d'emploi pour un cabinet de conseil en recrutement.
On te donne une annonce déjà rédigée (titre, description, compétences, localisation, type de contrat, télétravail, TJM/salaire) et une demande d'amélioration du recruteur.
Applique la demande aux champs concernés (un seul champ ou plusieurs, selon la demande) et renvoie TOUS les champs, en recopiant à l'identique ceux qui ne sont pas concernés par la demande.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
${FIELDS_JSON_SHAPE}

Règles :
- La description doit inclure : contexte, missions (avec des tirets "- "), profil recherché (avec des tirets "- ")
- Les sauts de ligne dans "description" doivent être de vrais \\n
- 5 à 10 compétences clés maximum dans "skills"
- Ne modifie QUE ce que la demande du recruteur implique, recopie le reste sans y toucher`

/**
 * Génération d'une annonce à partir du besoin saisi par le recruteur. `previousDraft` : « Régénérer », le modèle reçoit
 * la version précédente (JSON.stringify dans l'ordre de ses clés, celui de JobDraft quand elle vient de cette lecture)
 * pour en proposer une variante.
 */
export function jobDraftPrompt(input: { need: string; previousDraft?: JobDraft }): { system: string; user: string } {
  const need = input.need.trim()
  return {
    system: DRAFT_SYSTEM,
    user: input.previousDraft
      ? `Besoin exprimé par le recruteur : "${need}"\n\nUne première version a déjà été générée, propose une variante différente (autre formulation, éventuellement autre angle) :\n${JSON.stringify(input.previousDraft)}`
      : `Besoin exprimé par le recruteur : "${need}"`,
  }
}

/**
 * « Améliorer l'offre » : l'annonce du formulaire (JSON.stringify dans l'ordre de ses clés, celui que construit
 * create-job-form.tsx) et la demande du recruteur.
 */
export function jobImprovePrompt(input: { request: string; currentDraft: JobDraft }): { system: string; user: string } {
  return {
    system: IMPROVE_SYSTEM,
    user: `Annonce actuelle :\n${JSON.stringify(input.currentDraft)}\n\nDemande d'amélioration du recruteur : "${input.request.trim()}"`,
  }
}

/**
 * Lecture de la réponse du modèle, la même pour la génération et l'amélioration : le premier objet JSON du texte, champs
 * hors liste vidés. Pas d'objet, ou titre / description vides : message montré au recruteur. JSON malformé : l'erreur de
 * parseModelJson est levée (l'action renvoie son message, comme avant l'extraction de ce module).
 */
export function parseJobDraftAnswer(content: string): { draft: JobDraft } | { error: string } {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { error: 'Réponse IA invalide, réessayez' }

  const draft = toDraft(parseModelJson(jsonMatch[0]) as Record<string, unknown>)
  if (!draft.title || !draft.description) return { error: 'Réponse IA incomplète, réessayez' }

  return { draft }
}
