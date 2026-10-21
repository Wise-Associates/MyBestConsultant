import Anthropic from '@anthropic-ai/sdk'
import { claudeProblem, describeAiProblem } from '../ai-failures'
import { AiUnavailable, RetryLater, SkipAttachment, formatOf, type Attachment, type AttachmentExtractor, type ExtractionContext } from './types'
import { transcribeWithOpenAI } from './vision-openai'

// Images (photo ou capture d'un appel d'offres) et PDF scannés : l'IA lit le document et en transcrit le
// texte, qui suit ensuite le même chemin que le reste de l'e-mail (extraction des offres, validation).
// Claude d'abord ; s'il refuse sans frais (crédits épuisés, clé refusée, service saturé…), le modèle
// OpenAI de Config IA (GPT-4o par défaut) prend le relais ; si aucun ne peut lire, l'e-mail attend (AiUnavailable).
// Le modèle Claude est fixé ici, indépendamment de Config IA : le modèle par défaut du site peut ne pas lire
// les images. La transcription ne donne au modèle aucun outil ni aucun droit : un document piégé ne peut
// produire que du texte, revalidé ensuite comme le reste de l'e-mail. Les lectures sont limitées par
// e-mail et par jour (sync.ts) : tout expéditeur peut écrire à la boîte AO.

const VISION_MODEL = 'claude-opus-5-5'
/** Repli serveur si le modèle refuse une lecture (filtres de sécurité) : la requête est rejouée sur ce modèle. */
const FALLBACK_MODEL = 'claude-opus-4-8'
/** Modèle OpenAI de repli si Config IA n'en précise pas. */
const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // limite de l'API Claude par image
const MAX_PDF_BYTES = 10 * 1024 * 1024 // limite des pièces jointes AO (l'API accepte 32 Mo)
/** Une transcription d'appel d'offres tient largement dans 8 000 jetons ; borne aussi le coût. */
const MAX_OUTPUT_TOKENS = 8000
const MAX_WAIT_MS = 90_000
const MIN_WAIT_MS = 15_000

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const satisfies Record<string, Anthropic.Beta.Messages.BetaBase64ImageSource['media_type']>

const TRANSCRIBE_PROMPT = `Transcris fidèlement tout le texte lisible de ce document (appel d'offres, fiche de poste, tableau…), dans l'ordre de lecture.
Réponds uniquement avec le texte transcrit, sans commentaire ni mise en forme ajoutée. S'il n'y a aucun texte, réponds par une chaîne vide.`

type VisionBlock = Anthropic.Beta.Messages.BetaImageBlockParam | Anthropic.Beta.Messages.BetaRequestDocumentBlock

/** Bloc de contenu envoyé à Claude pour ce fichier ; null si le format n'est pas lisible par l'IA. */
export function visionBlockFor(file: Attachment): VisionBlock | null {
  const format = formatOf(file)
  const data = file.content.toString('base64')
  if (format === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  if (format in IMAGE_TYPES) {
    return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[format as keyof typeof IMAGE_TYPES], data } }
  }
  return null
}

/**
 * Transcrit le document avec Claude. AiUnavailable : refus sans frais (crédits épuisés, clé refusée, service
 * saturé…) ; RetryLater : délai dépassé ; SkipAttachment : document refusé.
 */
async function transcribeWithClaude(block: VisionBlock, apiKey: string, wait: number): Promise<string> {
  // Pas de nouvel essai dans le SDK (son délai s'appliquerait à chaque essai) : un échec passager
  // fait reprendre tout l'e-mail plus tard (RetryLater), dans un passage qui a le temps.
  const client = new Anthropic({ apiKey, maxRetries: 0 })
  let response: Anthropic.Beta.Messages.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: FALLBACK_MODEL }],
      // Transcription simple : peu de réflexion nécessaire.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: [block, { type: 'text', text: TRANSCRIBE_PROMPT }] }],
    }, { signal: AbortSignal.timeout(wait) })
  } catch (err) {
    // Refus sans frais (crédits, clé, modèle, service saturé) : le service suivant prend le relais.
    const problem = claudeProblem(err)
    if (problem) throw new AiUnavailable(describeAiProblem(problem, err))
    if (err instanceof Anthropic.BadRequestError) {
      // Message de l'API (« The PDF specified was not valid »…) : il dit à l'admin pourquoi, sans données de l'e-mail.
      const detail = (err.error as { error?: { message?: unknown } } | undefined)?.error?.message
      throw new SkipAttachment(`document refusé par Claude${typeof detail === 'string' ? ` : ${detail.slice(0, 200)}` : ' (format, taille ou nombre de pages)'}`)
    }
    // Délai dépassé (la requête a pu être facturée) : reprise normale.
    if (err instanceof Anthropic.APIError) {
      throw new RetryLater(`lecture par l'IA indisponible pour l'instant (${err.status ?? err.constructor.name})`)
    }
    throw err
  }
  if (response.stop_reason === 'refusal') throw new SkipAttachment('lecture refusée par l\'IA')
  return response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')
}

/** Temps d'attente possible pour une lecture ; lève l'erreur adaptée si le passage n'en a plus assez. */
function waitFor(ctx: ExtractionContext): number {
  const wait = Math.min(MAX_WAIT_MS, ctx.deadline - Date.now())
  if (wait >= MIN_WAIT_MS) return wait
  // Le premier e-mail d'un passage a tout le budget : s'il manque de temps, on lit ce qu'on peut.
  if (!ctx.canDefer) throw new SkipAttachment('plus assez de temps pour la lecture par l\'IA')
  throw new RetryLater('plus assez de temps pour lire les pièces jointes : e-mail repris au prochain passage', false)
}

/** Un service capable de lire le document, avec son nom affiché à l'admin (« Claude », « OpenAI »). */
export interface VisionReader {
  name: string
  read(wait: number): Promise<string>
}

/**
 * Rend la lecture réservée. Un échec (Appwrite injoignable) ne doit pas masquer la vraie cause, sinon la
 * pièce jointe serait écartée comme illisible : le compteur du jour reste alors un peu haut, sans danger.
 */
async function releaseQuietly(ctx: ExtractionContext): Promise<void> {
  try {
    await ctx.releaseVisionCall()
  } catch (err) {
    console.error('AO: lecture par l\'IA non rendue au compteur du jour', err instanceof Error ? err.message : String(err))
  }
}

/** Ajoute au message d'une erreur les refus déjà essuyés, pour que l'admin voie toutes les causes. */
function withRefusals(err: unknown, refusals: string[], readerName?: string): unknown {
  if (!refusals.length || !(err instanceof Error)) return err
  const message = `${refusals.join(' ; ')} ; ${readerName ? `${readerName} : ` : ''}${err.message}`
  if (err instanceof SkipAttachment) return new SkipAttachment(message)
  if (err instanceof RetryLater) return new RetryLater(message, err.countsAsAttempt)
  return err
}

/**
 * Lit le document avec le premier service utilisable, dans l'ordre de `readers`. Un service qui refuse sans
 * frais (AiUnavailable : compte, configuration, panne) passe la main au suivant ; si aucun ne peut lire, la lecture réservée est
 * rendue (aucune n'a été facturée), le passage le retient (les e-mails suivants attendent sans nouvel appel)
 * et l'e-mail attend. Toute autre erreur (délai dépassé, document refusé) suit son chemin normal, avec
 * les refus précédents dans son message.
 */
export async function readWithFallback(readers: VisionReader[], ctx: ExtractionContext): Promise<string> {
  if (ctx.pass.visionUnavailable) throw new AiUnavailable(ctx.pass.visionUnavailable, 'vision')
  waitFor(ctx)
  let reserved: boolean
  try {
    reserved = await ctx.reserveVisionCall()
  } catch (err) {
    // Compteur du jour inaccessible (Appwrite) : passager ; sinon la pièce jointe serait écartée comme illisible.
    console.error('AO: compteur des lectures par l\'IA inaccessible', err instanceof Error ? err.message : String(err))
    throw new RetryLater('compteur des lectures par l\'IA inaccessible : e-mail repris au prochain passage')
  }
  if (!reserved) throw new SkipAttachment('limite de lectures par l\'IA atteinte (par e-mail ou par jour)')
  const refusals: string[] = []
  for (const reader of readers) {
    let wait: number
    try {
      wait = waitFor(ctx)
    } catch (err) {
      await releaseQuietly(ctx) // aucun service n'a encore lu le document
      throw withRefusals(err, refusals)
    }
    try {
      return await reader.read(wait)
    } catch (err) {
      if (!(err instanceof AiUnavailable)) throw withRefusals(err, refusals, reader.name)
      refusals.push(`${reader.name} : ${err.reason}`)
    }
  }
  await releaseQuietly(ctx)
  ctx.pass.visionUnavailable = refusals.join(' ; ')
  throw new AiUnavailable(ctx.pass.visionUnavailable, 'vision')
}

export const visionExtractor: AttachmentExtractor = {
  name: 'vision',
  canRead: file => formatOf(file) === 'pdf' || formatOf(file) in IMAGE_TYPES,
  async read(file, ctx) {
    const isPdf = formatOf(file) === 'pdf'
    if (file.content.length > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) throw new SkipAttachment(isPdf ? 'plus de 10 Mo' : 'image de plus de 5 Mo')
    const block = visionBlockFor(file)
    if (!block) return ''
    // Chargé à la demande : le module des clés IA est réservé au serveur (import 'server-only').
    const { getLLMConfig } = await import('@/lib/ai/llm-config-store')
    const config = await getLLMConfig()
    const claudeKey = config.claudeApiKey || process.env.ANTHROPIC_API_KEY
    const openAiKey = config.openaiApiKey || process.env.OPENAI_API_KEY
    if (!claudeKey && !openAiKey) throw new SkipAttachment('lecture des images et PDF scannés non configurée (clé Claude ou OpenAI dans Config IA)')
    // Une seule clé configurée : l'autre service compte comme indisponible, et le message de l'e-mail en
    // attente indique à l'admin qu'ajouter cette clé suffirait.
    const noKey = async (): Promise<string> => { throw new AiUnavailable('aucune clé dans Config IA') }
    return readWithFallback([
      { name: 'Claude', read: claudeKey ? wait => transcribeWithClaude(block, claudeKey, wait) : noKey },
      {
        name: 'OpenAI',
        read: openAiKey
          ? wait => transcribeWithOpenAI(file, { apiKey: openAiKey, model: config.gpt4oModel || DEFAULT_OPENAI_MODEL, prompt: TRANSCRIBE_PROMPT, maxTokens: MAX_OUTPUT_TOKENS, wait })
          : noKey,
      },
    ], ctx)
  },
}
