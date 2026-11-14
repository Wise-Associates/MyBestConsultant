// Transcription des réponses orales de l'entretien vocal (/interview/<session>/v2, ADR 0035) par l'API de transcription
// d'OpenAI. Règles pures, testées dans speech-to-text-rules.test.ts ; appel : src/lib/speech-to-text.ts.

/**
 * Taille maximale d'une réponse envoyée : une réponse de 3 min (TURN_RULES.maxAnswerMs) au débit de la page (32 kbit/s)
 * fait environ 0,7 Mo, la marge couvre un navigateur qui dépasse ce débit. OpenAI facture la durée, pas la taille : à
 * très bas débit, ce plafond laisse passer bien plus de 3 min (risque restant, ADR 0035) ; il doit rester serré.
 */
export const MAX_ANSWER_AUDIO_BYTES = 1.5 * 1024 * 1024

export type AudioContainer = 'webm' | 'mp4' | 'ogg'

/**
 * Format d'après les premiers octets (le type annoncé par le navigateur n'est pas fiable) : WebM (Chrome, Edge,
 * Firefox), MP4 (Safari), Ogg. Tout autre contenu est refusé avant d'être envoyé à OpenAI. L'extension du fichier
 * envoyé en découle : OpenAI choisit le décodeur d'après elle.
 */
export function audioContainer(bytes: Uint8Array): AudioContainer | null {
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4'
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogg'
  return null
}

/** Modèle conseillé par OpenAI pour transcrire un enregistrement (2026-11) ; OPENAI_TRANSCRIBE_MODEL pour en changer. */
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-transcribe'

/**
 * Champs de la requête multipart, hors fichier. `gpt-transcribe` prend la langue en `languages[]` (le champ `language`
 * des modèles précédents ne doit pas être envoyé avec) ; les autres modèles gardent `language`.
 */
export function transcriptionFields(model: string, prompt: string): [string, string][] {
  const language: [string, string] = model.startsWith('gpt-transcribe') ? ['languages[]', 'fr'] : ['language', 'fr']
  return [['model', model], language, ['prompt', prompt], ['response_format', 'json']]
}

/**
 * Contexte donné à la transcription (vocabulaire du poste, sujet de la question) : lu sur l'entretien par le serveur,
 * jamais un texte envoyé par le navigateur. Court : OpenAI refuse toute la demande si le contexte dépasse sa limite.
 */
export function transcriptionPrompt(jobTitle: string, question: string): string {
  return `Entretien d'embauche en français pour le poste « ${jobTitle.slice(0, 150)} ». Question posée au candidat : « ${question.slice(0, 500)} »`
}

export function transcriptionFailureReason(status: number, body: string, apiKey: string): string {
  let code = ''
  let message = ''
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
  } catch {
    // Corps non JSON (passerelle, page d'erreur) : seul le statut HTTP est exploitable.
  }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'crédits OpenAI épuisés'
  if (status === 401) return 'clé OpenAI refusée (Config IA)'
  if (code === 'model_not_found' || status === 404) return 'modèle de transcription introuvable ou non autorisé (OPENAI_TRANSCRIBE_MODEL)'
  if (status === 429) return 'trop de demandes à OpenAI, réessayez plus tard'
  if (status >= 500 || !message) return `OpenAI indisponible (${status})`
  return `OpenAI : ${(apiKey ? message.replaceAll(apiKey, '[clé]') : message).slice(0, 200)}`
}
