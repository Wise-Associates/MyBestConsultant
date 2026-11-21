import 'server-only'
import {
  GOOGLE_TTS_URL, audioOfGoogleResponse, googleErrorMessage, googleFailureAllowsFallback, googleSynthesizeBody, googleVoiceSettings,
  type GoogleVoiceSettings,
} from '@/lib/interview-voice-rules'

// Voix d'Alex dans l'entretien vocal (/interview/<id>/v2, ADR 0052) : Google Cloud Text-to-Speech si GOOGLE_TTS_API_KEY
// est définie, sinon ou en cas d'échec la voix d'OpenAI ; tout en échec, le navigateur lit avec sa propre voix. La voix
// gratuite de Microsoft Edge (salle actuelle) n'est plus essayée ici : son service refuse les connexions (403), ce qui
// ajoutait environ une seconde avant chaque question.

const GOOGLE_TIMEOUT_MS = 10_000
const OPENAI_TIMEOUT_MS = 15_000

export type VoiceProvider = 'google' | 'openai'

/** Refus de Google, avec son code HTTP (null : pas de réponse, délai ou réseau). */
class GoogleVoiceError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

/** MP3 de `text` et le service qui l'a produit, ou la cause de l'échec de tous (pour le journal ; jamais le texte). */
export async function synthesizeInterviewVoice(text: string): Promise<{ audio: Buffer; provider: VoiceProvider } | { error: string }> {
  const google = googleVoiceSettings(process.env)
  if (google) {
    try {
      return { audio: await synthesizeWithGoogle(text, google), provider: 'google' }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!googleFailureAllowsFallback(err instanceof GoogleVoiceError ? err.status : null)) return { error: reason }
      // Journalisé même si OpenAI prend le relais : sinon une clé refusée ou une voix inconnue passerait inaperçue.
      console.error('[entretien] voix Google indisponible, voix d\'OpenAI à la place :', reason)
    }
  }
  try {
    return { audio: await synthesizeWithOpenAI(text), provider: 'openai' }
  } catch (err) {
    return { error: `${google ? 'Google puis ' : ''}OpenAI : ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function synthesizeWithGoogle(text: string, settings: GoogleVoiceSettings): Promise<Buffer> {
  const res = await fetch(GOOGLE_TTS_URL, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    headers: { 'X-Goog-Api-Key': settings.apiKey, 'Content-Type': 'application/json; charset=utf-8' },
    body: googleSynthesizeBody(text, settings),
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleVoiceError(googleErrorMessage(res.status, body), res.status)
  const audio = audioOfGoogleResponse(body)
  if (!audio) throw new GoogleVoiceError('Google Text-to-Speech : réponse sans audio', res.status)
  return audio
}

/** Même voix que le relais de la salle actuelle (generateInterviewSpeech) : tts-1, « onyx ». */
async function synthesizeWithOpenAI(text: string): Promise<Buffer> {
  const { getRecentLLMConfig } = await import('@/lib/ai/llm-config-store')
  const apiKey = (await getRecentLLMConfig()).openaiApiKey || process.env.OPENAI_API_KEY || ''
  if (!apiKey) throw new Error('aucune clé OpenAI (Config IA ou OPENAI_API_KEY)')
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: text, response_format: 'mp3', speed: 1.1 }),
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error('clé OpenAI refusée (Config IA)')
    const body = await res.json().catch(() => null) as { error?: { message?: unknown } } | null
    const message = typeof body?.error?.message === 'string' ? body.error.message : ''
    // OpenAI recopie parfois une partie de la clé dans son message : elle ne doit pas finir dans le journal.
    throw new Error(`${res.status}${message ? ` : ${message.replaceAll(apiKey, '[clé]').slice(0, 200)}` : ''}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
