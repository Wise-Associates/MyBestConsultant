'use server'

import { callLLM } from '@/lib/ai/llm-router'
import { getCurrentUser } from '@/lib/appwrite/auth'

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

const SYSTEM = `Tu es un expert en rédaction d'annonces d'emploi pour un cabinet de conseil en recrutement.
À partir des informations données par le recruteur, rédige une annonce structurée et professionnelle.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
${FIELDS_JSON_SHAPE}

Règles :
- Le titre doit être clair et attractif (ex: "Consultant SAP FI/CO Senior")
- La description doit inclure : contexte, missions (avec des tirets "- "), profil recherché (avec des tirets "- ")
- Les sauts de ligne dans "description" doivent être de vrais \\n
- 5 à 10 compétences clés maximum dans "skills"
- Ne déduis location/contractType/remote/salary que si le besoin exprimé les mentionne, sinon laisse-les vides`

// Structured job-posting generation from short recruiter input, reviewed/editable in the
// create-job dialog before publishing — same shape as /admin/jobs' file-based extraction,
// but driven by a short text prompt instead of an uploaded document.
export async function generateJobDraft(
  prompt: string,
  regenerateFrom?: JobDraft,
): Promise<{ draft: JobDraft } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const trimmed = prompt.trim()
  if (!trimmed) return { error: 'Décrivez le besoin en quelques mots' }

  try {
    const userMsg = regenerateFrom
      ? `Besoin exprimé par le recruteur : "${trimmed}"\n\nUne première version a déjà été générée, propose une variante différente (autre formulation, éventuellement autre angle) :\n${JSON.stringify(regenerateFrom)}`
      : `Besoin exprimé par le recruteur : "${trimmed}"`

    const { content } = await callLLM([{ role: 'user', content: userMsg }], SYSTEM)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'Réponse IA invalide, réessayez' }

    const draft = toDraft(JSON.parse(jsonMatch[0]))
    if (!draft.title || !draft.description) return { error: 'Réponse IA incomplète, réessayez' }

    return { draft }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur de génération' }
  }
}

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

// "Améliorer l'offre" — takes whatever is currently in the form (typed manually, imported
// from the library, or already AI-generated) and reworks it per the recruiter's instruction.
// Unlike generateJobDraft, it covers every field of the form (title, location, contractType,
// remote, salary, skills, description) so a single prompt can target any of them.
export async function improveJobDraft(
  prompt: string,
  currentDraft: JobDraft,
): Promise<{ draft: JobDraft } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const trimmed = prompt.trim()
  if (!trimmed) return { error: 'Décrivez ce que l\'IA doit améliorer' }
  if (!currentDraft.title.trim() && !currentDraft.description.trim()) {
    return { error: 'Rédigez d\'abord un titre ou une description à améliorer' }
  }

  try {
    const userMsg = `Annonce actuelle :\n${JSON.stringify(currentDraft)}\n\nDemande d'amélioration du recruteur : "${trimmed}"`
    const { content } = await callLLM([{ role: 'user', content: userMsg }], IMPROVE_SYSTEM)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'Réponse IA invalide, réessayez' }

    const draft = toDraft(JSON.parse(jsonMatch[0]))
    if (!draft.title || !draft.description) return { error: 'Réponse IA incomplète, réessayez' }

    return { draft }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur d\'amélioration' }
  }
}
