import Anthropic from '@anthropic-ai/sdk'
import { RetryLater, SkipAttachment, formatOf, type Attachment, type AttachmentExtractor } from './types'

// Images (photo ou capture d'un appel d'offres) et PDF scannés : Claude lit le document et en transcrit
// le texte, qui suit ensuite le même chemin que le reste de l'e-mail (extraction des offres, validation).
// Le modèle est fixé ici, indépendamment de Config IA : le modèle par défaut du site peut ne pas lire
// les images. La transcription ne donne au modèle aucun outil ni aucun droit : un document piégé ne peut
// produire que du texte, revalidé ensuite comme le reste de l'e-mail. Les lectures sont limitées par
// e-mail et par jour (sync.ts) : tout expéditeur peut écrire à la boîte AO.

const VISION_MODEL = 'claude-opus-5-5'
/** Repli serveur si le modèle refuse une lecture (filtres de sécurité) : la requête est rejouée sur ce modèle. */
const FALLBACK_MODEL = 'claude-opus-4-8'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // limite de l'API par image
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

export const visionExtractor: AttachmentExtractor = {
  name: 'vision',
  canRead: file => formatOf(file) === 'pdf' || formatOf(file) in IMAGE_TYPES,
  async read(file, ctx) {
    const isPdf = formatOf(file) === 'pdf'
    if (file.content.length > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) throw new SkipAttachment(isPdf ? 'plus de 10 Mo' : 'image de plus de 5 Mo')
    const wait = Math.min(MAX_WAIT_MS, ctx.deadline - Date.now())
    if (wait < MIN_WAIT_MS) {
      // Le premier e-mail d'un passage a tout le budget : s'il manque de temps, on lit ce qu'on peut.
      if (!ctx.canDefer) throw new SkipAttachment('plus assez de temps pour la lecture par l\'IA')
      throw new RetryLater('plus assez de temps pour lire les pièces jointes : e-mail repris au prochain passage', false)
    }
    // Chargé à la demande : le module des clés IA est réservé au serveur (import 'server-only').
    const { getLLMConfig } = await import('@/lib/ai/llm-config-store')
    const apiKey = (await getLLMConfig()).claudeApiKey || process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new SkipAttachment('lecture des images et PDF scannés non configurée (clé Claude dans Config IA)')
    const block = visionBlockFor(file)
    if (!block) return ''
    if (!(await ctx.reserveVisionCall())) throw new SkipAttachment('limite de lectures par l\'IA atteinte (par e-mail ou par jour)')

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
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new SkipAttachment('clé Claude refusée (Config IA)')
      }
      if (err instanceof Anthropic.BadRequestError) throw new SkipAttachment('document refusé par l\'API (format, taille ou nombre de pages)')
      // Délai dépassé, connexion, saturation (429, 529), erreur serveur : passager.
      if (err instanceof Anthropic.APIError) {
        throw new RetryLater(`lecture par l'IA indisponible pour l'instant (${err.status ?? err.constructor.name})`)
      }
      throw err
    }
    if (response.stop_reason === 'refusal') throw new SkipAttachment('lecture refusée par l\'IA')
    return response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')
  },
}
