import { z } from 'zod'
import { AI_PROBLEM_LABEL, openAiProblem } from '../ai-failures'
import { AiUnavailable, RetryLater, SkipAttachment, formatOf, type Attachment } from './types'

// Repli de la lecture des images et PDF scannés quand Claude n'est pas utilisable (crédits épuisés, clé
// refusée) : le modèle OpenAI de Config IA (GPT-4o par défaut) lit le document. Appel direct de l'API
// Chat Completions avec fetch, comme le routeur IA (llm-router.ts) : pas de dépendance supplémentaire.
// Mêmes garde-fous que Claude : aucun outil, texte seulement, revalidé ensuite comme le reste de l'e-mail.

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export type OpenAiContentPart =
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } }

/** Partie de message envoyée à OpenAI pour ce fichier ; null si le format n'est pas lisible. */
export function openAiContentPart(file: Attachment): OpenAiContentPart | null {
  const format = formatOf(file)
  const data = file.content.toString('base64')
  // Nom générique : le nom réel (« CV_Prénom_Nom.pdf ») n'apporte rien à la lecture et serait une donnée
  // personnelle de plus chez OpenAI ; un nom sans extension pourrait aussi être refusé.
  if (format === 'pdf') return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${data}` } }
  const mime = IMAGE_TYPES[format]
  // « high » : un appel d'offres scanné est souvent en petits caractères.
  return mime ? { type: 'image_url', image_url: { url: `data:${mime};base64,${data}`, detail: 'high' } } : null
}

const ChatCompletion = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullish(),
    message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
  })).min(1),
})

/** Message d'une réponse d'erreur JSON d'OpenAI, raccourci, sans la clé ; '' si absent. */
function errorDetail(body: string, apiKey: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } } | null)?.error?.message
    if (typeof message !== 'string') return ''
    return (apiKey ? message.replaceAll(apiKey, '[clé]') : message).slice(0, 200)
  } catch {
    return '' // corps non JSON : le statut seul est rapporté
  }
}

/**
 * Transcrit le document avec OpenAI. AiUnavailable : refus sans frais (crédits épuisés, clé refusée, modèle
 * inconnu, service saturé ou injoignable) ; RetryLater : délai dépassé ou réponse illisible ; SkipAttachment :
 * document refusé.
 */
export async function transcribeWithOpenAI(
  file: Attachment,
  { apiKey, model, prompt, maxTokens, wait }: { apiKey: string; model: string; prompt: string; maxTokens: number; wait: number },
): Promise<string> {
  const part = openAiContentPart(file)
  if (!part) return ''
  let res: Response
  try {
    res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(wait),
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'user', content: [part, { type: 'text', text: prompt }] }],
      }),
    })
  } catch (err) {
    // Ni message ni en-tête recopiés (clé). Délai dépassé : la requête a pu être facturée, reprise normale.
    // Connexion impossible : rien n'est parti, l'e-mail sera repris sans user sa reprise.
    const name = err instanceof Error ? err.name : 'réseau'
    if (name === 'TimeoutError' || name === 'AbortError') throw new RetryLater('pas de réponse d\'OpenAI dans le délai')
    const code = (err as { cause?: { code?: string } })?.cause?.code
    throw new AiUnavailable(`service injoignable (${code ?? name})`)
  }
  if (!res.ok) {
    const body = await res.text().catch((err: unknown) => {
      console.warn('AO: corps de la réponse d\'erreur OpenAI illisible', res.status, err instanceof Error ? err.name : String(err))
      return '' // seul le statut sert alors à classer l'erreur
    })
    const problem = openAiProblem(res.status, body)
    if (problem === 'model') throw new AiUnavailable(`modèle « ${model} » introuvable ou non autorisé (Config IA)`)
    if (problem === 'outage') throw new AiUnavailable(`${AI_PROBLEM_LABEL.outage} (${res.status})`)
    if (problem) throw new AiUnavailable(AI_PROBLEM_LABEL[problem])
    const detail = errorDetail(body, apiKey)
    if (res.status === 400) throw new SkipAttachment(`document refusé par OpenAI${detail ? ` : ${detail}` : ' (format, taille ou nombre de pages)'}`)
    throw new RetryLater(`lecture par OpenAI indisponible pour l'instant (${res.status}${detail ? ` : ${detail}` : ''})`)
  }
  let completion: z.infer<typeof ChatCompletion>
  try {
    completion = ChatCompletion.parse(await res.json())
  } catch (err) {
    // Réponse coupée (délai pendant la lecture du corps) ou inattendue : l'e-mail est repris plus tard.
    throw new RetryLater(`réponse d'OpenAI illisible (${err instanceof Error ? err.name : 'format'}) : e-mail repris plus tard`)
  }
  const [choice] = completion.choices
  if (choice.message.refusal || choice.finish_reason === 'content_filter') throw new SkipAttachment('lecture refusée par OpenAI')
  return choice.message.content ?? ''
}
