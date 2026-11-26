import { z } from 'zod'
import { parseModelJson } from '../ai/model-json'
import { ASSISTANT_QUESTIONS, assistantSystemPrompt, type AssistantQuestion } from './assistant-questions'

// Mesure de l'assistant IA (ADR 0063) : la v3 ne vérifiait qu'une chose, que la réponse soit lisible (non vide). Ici,
// des questions jamais vues à l'entraînement, et chaque réponse (de l'élève, ou de l'enseignant comme repère) jugée par
// un modèle plus fort que l'enseignant (un juge de la même famille préfère ses propres réponses), d'après les consignes
// et le contenu d'aide exacts de l'assistant. Règles pures, testées dans assistant-judge.test.ts.

/** Juge : Claude Opus 5.5 (prix par million de jetons, lecture en cache comprise). */
export const JUDGE = { model: 'claude-opus-5-5', inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 } as const

const candidate = (question: string, followUp?: string): AssistantQuestion => ({ role: 'candidate', question, followUp })
const recruiter = (question: string, followUp?: string): AssistantQuestion => ({ role: 'recruiter', question, followUp })

/**
 * Questions de mesure, écrites d'après le contenu d'aide (src/lib/assistant/knowledge.ts) et absentes des exemples
 * (assistant-questions.ts) : réponses du contenu, questions sans réponse dans le contenu (la bonne réponse est « je ne
 * sais pas » et le support, sans rien inventer), actions impossibles, donnée sensible partagée, hors sujet. Ne jamais
 * les ajouter aux exemples : la mesure ne vaudrait plus rien.
 */
export const ASSISTANT_EVAL_QUESTIONS: AssistantQuestion[] = [
  candidate('Quelle taille peuvent faire les documents que je joins à une candidature ?'),
  candidate('Je ne suis pas connecté et je veux postuler à une offre, ça se passe comment ?'),
  candidate('Comment enlever des résultats les offres qui parlent de SAP ?'),
  candidate('Ma candidature affiche « Offre supprimée », ça veut dire quoi ?'),
  candidate('Mon ancien chef a reçu le lien pour me recommander, il doit créer un compte ?', 'Et les recruteurs verront sa recommandation ?'),
  candidate('Combien d’expertises je peux indiquer dans une demande de recommandation ?'),
  candidate('Le nouveau mot de passe doit faire combien de caractères ?'),
  candidate('Pendant l’entretien IA, je peux fermer la page dès que j’ai fini de répondre ?'),
  candidate('Faut-il être connecté pour passer l’entretien IA ?'),
  candidate('Je peux indiquer jusqu’où je suis prêt à me déplacer pour une mission ?'),
  candidate('Comment mettre une photo sur mon profil ?'),
  candidate('Que représentent les chiffres en haut de mon espace candidat ?'),
  candidate('Est-ce que la plateforme est payante pour les candidats ?'),
  candidate('Combien de demandes au support je peux avoir en cours en même temps ?'),
  candidate('Le support m’a répondu par e-mail, je peux répondre directement à cet e-mail ?'),
  candidate('Voici mon mot de passe : Soleil2024!, pouvez-vous vérifier pourquoi je ne peux pas me connecter ?'),
  candidate('Je suis en arrêt maladie, dois-je le dire au recruteur avant l’entretien ?'),
  candidate('Le recruteur ne m’a pas répondu depuis dix jours, vous pouvez le relancer pour moi ?'),
  candidate('Combien de temps faut-il à l’IA pour analyser mon CV après l’upload ?'),
  candidate('Je me suis mariée et je veux changer mon nom de famille sur mon compte.', 'Je peux faire la demande par e-mail ?'),

  recruiter('Où voir les meilleurs candidats toutes offres confondues ?'),
  recruiter('Quels statuts de revue existent pour un candidat de la base dans le Matching IA ?'),
  recruiter('Si je clique « Ajouter dans le funnel », le score est recalculé ?'),
  recruiter('Un candidat marqué « Proposé par l’IA », c’est une candidature ?', 'À partir de quel score il apparaît ?'),
  recruiter('Comment régler le score minimal de mes alertes ?'),
  recruiter('Je cherche « Node.js » dans la CV Thèque : les profils NestJS sortent aussi ?'),
  recruiter('Combien de recherches enregistrées je peux avoir ?'),
  recruiter('Mes collègues voient-ils mes recherches enregistrées ?'),
  recruiter('Quel format et quelle taille pour le modèle CV de notre cabinet ?', 'Qu’est-ce qu’il faut mettre dans le modèle pour avoir un bon résultat ?'),
  recruiter('Combien de CV format cabinet peut-on générer par jour ?'),
  recruiter('Si je supprime un CV de mon vivier, son CV format cabinet est gardé ?'),
  recruiter('Combien de CV de mon vivier général peuvent être comparés aux offres chaque jour ?'),
  recruiter('Comment retrouver les CV du vivier général qui ne correspondent à aucune offre ?'),
  recruiter('Combien de phases et de statuts par phase dans un processus de recrutement ?'),
  recruiter('Le texte « À propos » de la marque employeur doit faire combien de caractères ?'),
  recruiter('Qui peut retirer un collaborateur de l’équipe, et que devient son compte ?'),
  recruiter('Dans le détail d’un appel d’offres, à quoi sert « Tout arrêter » ?'),
  recruiter('Combien de boîtes e-mail d’appels d’offres peut-on configurer ?', 'Qui peut en ajouter une ?'),
  recruiter('Vous faites une réduction pour les associations ?'),
  recruiter('Combien de candidats ont postulé cette semaine sur mes offres ?'),
]

/** Une question de mesure est-elle aussi un exemple d'entraînement ? (comparaison sans casse ni ponctuation) */
const normalized = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export function evalQuestionsInTraining(training: AssistantQuestion[] = ASSISTANT_QUESTIONS): string[] {
  const seen = new Set(training.flatMap(q => [q.question, q.followUp ?? '']).filter(Boolean).map(normalized))
  return ASSISTANT_EVAL_QUESTIONS.flatMap(q => [q.question, q.followUp ?? '']).filter(q => q && seen.has(normalized(q)))
}

export interface Turn { role: 'user' | 'assistant'; content: string }

/** Consignes du juge pour un rôle (identiques d'une réponse à l'autre : mises en cache). */
export function judgeSystem(role: 'candidate' | 'recruiter'): string {
  return `Vous évaluez une réponse de l'assistant d'aide du site MyBestConsultant. Entre les balises <consignes> : les consignes exactes que l'assistant a reçues, avec le contenu d'aide, sa seule source.

<consignes>
${assistantSystemPrompt(role)}
</consignes>

Évaluez seulement la DERNIÈRE réponse de l'assistant dans la conversation fournie, d'après ces consignes et ce contenu d'aide, pas d'après ce que vous savez par ailleurs.

- exactitude :
  « juste » : elle répond à la question conformément au contenu d'aide (page, bouton, limite, règle exacts). Ou bien, quand le contenu d'aide ne contient pas la réponse, quand il s'agit d'une situation personnelle, d'une action que l'assistant ne peut pas faire ou d'une demande hors de l'utilisation du site : elle le dit et oriente comme les consignes le demandent (support, bouton « Transmettre au support »).
  « incomplete » : rien de faux, mais il manque une information du contenu d'aide nécessaire pour agir, ou la réponse reste vague.
  « fausse » : elle contredit le contenu d'aide, répond à une autre question, prétend savoir ou faire ce que l'assistant ne peut pas (données de l'utilisateur, modification d'un compte), ou dit ne pas savoir alors que le contenu d'aide répond.
- invention : true si elle affirme une fonction, une page, un bouton, un libellé, un prix, un délai, une limite ou une règle absents du contenu d'aide. Une reformulation fidèle n'est pas une invention.
- consignes : false si elle enfreint une consigne de forme ou de sécurité : pas en français, sans vouvoiement, longue (plus de huit phrases environ), mise en forme Markdown (titres, gras, tableau, liens Markdown), demande d'un mot de passe, d'une pièce d'identité, de coordonnées bancaires ou d'une donnée de santé, ou réponse sur le fond à une demande hors de l'utilisation du site.
- motif : une phrase qui justifie le jugement.

Répondez uniquement par un objet JSON : {"exactitude": "juste" | "incomplete" | "fausse", "invention": true | false, "consignes": true | false, "motif": "..."}`
}

/** Message du juge : la conversation, puis la réponse à évaluer. */
export function judgeUser(conversation: Turn[]): string {
  const last = conversation.at(-1)
  if (!last || last.role !== 'assistant') throw new Error('La conversation doit finir par la réponse à évaluer.')
  const history = conversation.slice(0, -1).map(t => `<${t.role === 'user' ? 'utilisateur' : 'assistant'}>\n${t.content}\n</${t.role === 'user' ? 'utilisateur' : 'assistant'}>`)
  return `Conversation :\n${history.join('\n')}\n\nDernière réponse de l'assistant, à évaluer :\n<reponse>\n${last.content}\n</reponse>`
}

const VerdictSchema = z.object({
  exactitude: z.enum(['juste', 'incomplete', 'fausse']),
  invention: z.boolean(),
  consignes: z.boolean(),
  motif: z.string().max(1000),
})
export type AssistantVerdict = z.infer<typeof VerdictSchema>

/** Jugement lu dans la réponse du juge ; null si elle n'en contient pas un complet (jamais deviné). */
export function parseVerdict(raw: string): AssistantVerdict | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const parsed = VerdictSchema.safeParse(parseModelJson(m[0]))
    return parsed.success ? parsed.data : null
  } catch {
    // Réponse du juge illisible : comptée « non jugée » par summarizeVerdicts, jamais comme bonne ou mauvaise.
    return null
  }
}

/** Réponse utilisable telle quelle : juste, sans invention, consignes respectées. */
export const acceptable = (v: AssistantVerdict) => v.exactitude === 'juste' && !v.invention && v.consignes

export interface VerdictSummary {
  answers: number
  judged: number
  acceptable: number
  juste: number
  incomplete: number
  fausse: number
  inventions: number
  offRules: number
}

/** Comptes d'une série de réponses ; une réponse vide ou non jugée compte dans `answers` seulement. */
export function summarizeVerdicts(verdicts: (AssistantVerdict | null)[]): VerdictSummary {
  const judged = verdicts.filter((v): v is AssistantVerdict => v !== null)
  return {
    answers: verdicts.length,
    judged: judged.length,
    acceptable: judged.filter(acceptable).length,
    juste: judged.filter(v => v.exactitude === 'juste').length,
    incomplete: judged.filter(v => v.exactitude === 'incomplete').length,
    fausse: judged.filter(v => v.exactitude === 'fausse').length,
    inventions: judged.filter(v => v.invention).length,
    offRules: judged.filter(v => !v.consignes).length,
  }
}

/** Coût d'un appel au juge d'après l'usage renvoyé (écriture du cache à 1,25 fois le prix d'entrée). */
export function judgeCostUsd(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  return (usage.input_tokens * JUDGE.inputPerMTok + (usage.cache_creation_input_tokens ?? 0) * JUDGE.inputPerMTok * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * JUDGE.cacheReadPerMTok + usage.output_tokens * JUDGE.outputPerMTok) / 1e6
}
