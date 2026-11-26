// Consignes et lecture des réponses de l'import d'offres par l'IA (« Publier un job », onglet import : un document ou un
// texte collé, puis « Améliorer avec l'IA » sur une offre extraite). Pur (aucun accès base ni session) : les actions de
// src/app/recruiter/import/actions.ts l'appellent, et un script d'exemples d'affinage peut reproduire à l'octet près ce
// qui est envoyé au modèle, puis valider une réponse avec la même lecture que l'application.
import { parseModelJson } from './ai/model-json'

export interface ExtractedJob {
  id: string            // temp client-side id
  title: string
  location: string
  contractType: 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote: 'onsite' | 'hybrid' | 'remote'
  salary: number | null
  skills: string[]
  description: string
  companyName: string
  confidence: 'high' | 'medium' | 'low'
}

export type ImprovableJobFields = Pick<ExtractedJob, 'title' | 'description' | 'skills' | 'location' | 'contractType' | 'remote' | 'salary'>

/**
 * Extraction de toutes les offres d'un document. `text` : texte du fichier (extractTextFromFile) ou texte collé (déjà
 * coupé à 15 000 caractères par l'action) ; `filename` : nom du fichier, « paste » pour un texte collé ;
 * `defaultCompany` : entreprise proposée quand le document n'en cite pas (celle du recruteur, sinon « Prénom Nom »).
 */
export function jobImportPrompt(input: { text: string; filename: string; defaultCompany: string }): { system: string; user: string } {
  const system = `Tu es un extracteur d'offres d'emploi expert. À partir du texte fourni, extrais TOUTES les offres d'emploi et retourne un JSON valide.

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans explication. Format exact :
[
  {
    "title": "string — intitulé du poste",
    "location": "string — ville ou région, '' si non précisé",
    "contractType": "cdi|cdd|freelance|mission",
    "remote": "onsite|hybrid|remote",
    "salary": number|null — montant en € : salaire annuel brut pour CDI/CDD (un salaire mensuel est multiplié par 12), TJM pour freelance/mission, null si non précisé ou si l'unité est inconnue,
    "skills": ["string"] — liste de compétences techniques,
    "description": "string — description complète et détaillée du poste, reprends l'intégralité du contenu pertinent du document source (contexte, missions, profil recherché, compétences) — ne jamais résumer ni tronquer",
    "companyName": "string — nom de l'entreprise, '${input.defaultCompany}' si non précisé",
    "confidence": "high|medium|low"
  }
]

Règles :
- Si le texte contient plusieurs offres, extrais-les toutes
- contractType par défaut : "mission" pour IT consulting
- remote par défaut : "hybrid"
- confidence = "high" si toutes les infos clés sont présentes, "medium" si certaines manquent, "low" si beaucoup d'infos manquent
- Ne jamais inventer des informations qui ne sont pas dans le texte (sauf defaults ci-dessus)
- Si aucune offre n'est détectable, retourne []`
  return { system, user: `Contenu à analyser (source: ${input.filename}):\n\n${input.text}` }
}

/**
 * Lecture de l'extraction : le premier tableau JSON du texte. Les offres n'ont pas encore d'`id` (identifiant
 * temporaire tiré au hasard par l'action, pour l'écran de revue). Pas de tableau, ou tableau illisible : message montré
 * au recruteur. Un élément du tableau qui n'est pas un objet lève une erreur (l'action renvoie son message).
 */
export function parseJobImportAnswer(raw: string): { jobs: Omit<ExtractedJob, 'id'>[] } | { error: string } {
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return { error: 'Le modèle n\'a pas retourné de JSON valide' }

  let parsed: Omit<ExtractedJob, 'id'>[]
  try {
    parsed = parseModelJson(jsonMatch[0]) as Omit<ExtractedJob, 'id'>[]
  } catch {
    // Réponse tronquée ou malformée (ex. document trop long) — message clair plutôt
    // que l'erreur brute de JSON.parse (illisible pour un recruteur).
    return { error: 'Le document est trop long ou trop complexe pour être analysé en une fois. Essayez avec un fichier plus court, ou changez de modèle IA.' }
  }

  return {
    jobs: parsed.map(j => ({
      ...j,
      salary: typeof j.salary === 'number' ? j.salary : null,
      skills: Array.isArray(j.skills) ? j.skills.slice(0, 10) : [],
      description: String(j.description ?? ''),
    })),
  }
}

const IMPROVE_CONTRACT_TYPES = new Set(['cdi', 'cdd', 'freelance', 'mission'])
const IMPROVE_REMOTE_TYPES = new Set(['onsite', 'hybrid', 'remote'])

const IMPROVE_SYSTEM = `Tu es un expert en rédaction d'annonces d'emploi pour un cabinet de conseil en recrutement.
On te donne une offre extraite automatiquement (titre, description, compétences, localisation, type de contrat, télétravail, salaire/TJM) et une demande d'amélioration du recruteur.
Applique la demande aux champs concernés (un ou plusieurs) et renvoie TOUS les champs, en recopiant à l'identique ceux qui ne sont pas concernés.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
{"title":"...","description":"...","skills":["compétence1","compétence2"],"location":"...","contractType":"cdi|cdd|freelance|mission","remote":"onsite|hybrid|remote","salary":number|null}

Règles :
- Les sauts de ligne dans "description" doivent être de vrais \\n
- 5 à 10 compétences clés maximum dans "skills"
- Ne modifie QUE ce que la demande implique, recopie le reste sans y toucher`

/**
 * « Améliorer avec l'IA » sur une offre extraite : l'offre (JSON.stringify dans l'ordre de ses clés, celui que construit
 * import-client.tsx) et la demande du recruteur.
 */
export function improveImportedJobPrompt(input: { job: ImprovableJobFields; request: string }): { system: string; user: string } {
  return {
    system: IMPROVE_SYSTEM,
    user: `Offre actuelle :\n${JSON.stringify(input.job)}\n\nDemande d'amélioration du recruteur : "${input.request.trim()}"`,
  }
}

/**
 * Lecture de l'amélioration : le premier objet JSON du texte ; un champ absent ou hors liste garde la valeur de l'offre
 * envoyée (`job`). Pas d'objet, ou titre / description vides : message montré au recruteur. JSON malformé : l'erreur de
 * parseModelJson est levée (l'action renvoie son message).
 */
export function parseImprovedJobAnswer(content: string, job: ImprovableJobFields): ImprovableJobFields | { error: string } {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { error: 'Réponse IA invalide, réessayez' }

  const parsed = parseModelJson(jsonMatch[0]) as Partial<ImprovableJobFields>
  const result: ImprovableJobFields = {
    title: String(parsed.title ?? job.title).slice(0, 200),
    description: String(parsed.description ?? job.description),
    skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 10).map(String) : job.skills,
    location: String(parsed.location ?? job.location),
    contractType: parsed.contractType && IMPROVE_CONTRACT_TYPES.has(String(parsed.contractType)) ? parsed.contractType : job.contractType,
    remote: parsed.remote && IMPROVE_REMOTE_TYPES.has(String(parsed.remote)) ? parsed.remote : job.remote,
    salary: typeof parsed.salary === 'number' ? parsed.salary : job.salary,
  }
  if (!result.title || !result.description) return { error: 'Réponse IA incomplète, réessayez' }
  return result
}
