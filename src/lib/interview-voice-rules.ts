// Voix d'Alex dans l'entretien vocal (/interview/<id>/v2, ADR 0052) : Google Cloud Text-to-Speech, appelé par fetch,
// sans SDK. Règles pures, testées dans interview-voice-rules.test.ts ; appel : interview-voice.ts.

export const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

/** Voix par défaut : gamme Chirp 3 HD, la plus naturelle de Google ; masculine, comme la voix d'avant (Henri). */
export const DEFAULT_GOOGLE_VOICE = 'fr-FR-Chirp3-HD-Charon'

export interface GoogleVoiceSettings {
  apiKey: string
  /** Nom de voix Google, « <langue>-<pays>-<gamme>-<voix> » (GOOGLE_TTS_VOICE). */
  voice: string
  languageCode: string
}

/** Réglages lus dans `env` ; null sans clé : Google n'est pas appelé, la voix d'OpenAI prend le relais. */
export function googleVoiceSettings(env: Record<string, string | undefined>): GoogleVoiceSettings | null {
  const apiKey = env.GOOGLE_TTS_API_KEY?.trim()
  if (!apiKey) return null
  const voice = env.GOOGLE_TTS_VOICE?.trim() || DEFAULT_GOOGLE_VOICE
  // Google exige la langue en plus du nom ; un nom mal formé est refusé par Google, avec un message journalisé.
  return { apiKey, voice, languageCode: voice.split('-').slice(0, 2).join('-') }
}

/** Corps de la demande : le texte, la voix et un MP3 (lu par decodeAudioData dans tous les navigateurs). La clé part en en-tête. */
export function googleSynthesizeBody(text: string, settings: GoogleVoiceSettings): string {
  return JSON.stringify({
    input: { text },
    voice: { languageCode: settings.languageCode, name: settings.voice },
    audioConfig: { audioEncoding: 'MP3' },
  })
}

/** Audio MP3 de la réponse de Google, ou null si elle n'en contient pas. */
export function audioOfGoogleResponse(body: unknown): Buffer | null {
  const content = (body as { audioContent?: unknown } | null)?.audioContent
  if (typeof content !== 'string' || !content) return null
  const audio = Buffer.from(content, 'base64')
  return audio.length > 0 ? audio : null
}

/** Cause d'un refus de Google pour le journal : code HTTP et message d'erreur borné, jamais le texte envoyé. */
export function googleErrorMessage(status: number, body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  const detail = typeof message === 'string' ? message.slice(0, 200) : ''
  return `Google Text-to-Speech ${status}${detail ? ` : ${detail}` : ''}`
}

/**
 * Après un échec de Google, la voix d'OpenAI peut prendre le relais, sauf si Google a refusé pour quota (429) : un
 * plafond de dépenses réglé chez Google doit arrêter la dépense, pas la faire passer chez OpenAI. `null` : pas de réponse
 * (délai, réseau).
 */
export function googleFailureAllowsFallback(status: number | null): boolean {
  return status !== 429
}
