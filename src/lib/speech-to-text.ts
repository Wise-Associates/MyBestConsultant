import 'server-only'
import {
  DEFAULT_TRANSCRIBE_MODEL, transcriptionFailureReason, transcriptionFields, type AudioContainer,
} from './speech-to-text-rules'

// Transcription d'une réponse orale de l'entretien vocal (/interview/<session>/v2, ADR 0035) par l'API d'OpenAI, avec la
// clé OpenAI de Config IA (ou OPENAI_API_KEY), comme la voix de secours et les photos des affiches. La voix du candidat
// part chez OpenAI (sous-traitant) ; rien n'est gardé ici, seul le texte revient.

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'
// Une réponse de 3 min se transcrit en quelques secondes ; au-delà, la page propose de l'écrire.
const TRANSCRIBE_TIMEOUT_MS = 30_000

export type TranscriptionResult = { ok: true; text: string } | { ok: false; reason: string }

export async function transcribeSpeech(audio: Uint8Array, container: AudioContainer, prompt: string): Promise<TranscriptionResult> {
  const { getRecentLLMConfig } = await import('@/lib/ai/llm-config-store')
  const apiKey = (await getRecentLLMConfig()).openaiApiKey || process.env.OPENAI_API_KEY || ''
  if (!apiKey) return { ok: false, reason: 'aucune clé OpenAI (Config IA ou OPENAI_API_KEY)' }

  const form = new FormData()
  for (const [name, value] of transcriptionFields(process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL, prompt)) {
    form.append(name, value)
  }
  form.append('file', new Blob([audio as Uint8Array<ArrayBuffer>]), `reponse.${container}`)

  let res: Response
  let body: string
  try {
    res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    // Lu dans le même délai : une réponse interrompue en route est un délai dépassé, pas une erreur interne.
    body = await res.text()
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, reason: timedOut ? 'OpenAI n’a pas répondu à temps' : 'OpenAI injoignable' }
  }
  if (!res.ok) return { ok: false, reason: transcriptionFailureReason(res.status, body, apiKey) }

  try {
    const text = (JSON.parse(body) as { text?: unknown }).text
    if (typeof text === 'string') return { ok: true, text: text.trim() }
  } catch {
    // Réponse 200 mais pas du JSON : traitée ci-dessous comme une réponse sans texte.
  }
  return { ok: false, reason: 'réponse d’OpenAI sans transcription' }
}
