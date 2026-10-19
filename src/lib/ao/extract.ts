import { callLLM } from '@/lib/ai/llm-router'
import { readAttachments } from './extractors/chain'
import type { ExtractionContext } from './extractors/types'
import type { InboxMessage } from './imap'
import { parseOffersJson, type ParsedOffers } from './parse'
import { AO_EMAIL_ADDENDUM, AO_EXTRACTION_PROMPT } from './prompt'

// Préparation du texte d'un e-mail (corps + pièces jointes, lues par la chaîne d'extracteurs) et
// extraction des offres par l'IA.

/** Taille maximale du texte envoyé à l'IA (même limite que l'import manuel d'appels d'offres). */
const MAX_PROMPT_CHARS = 40_000

export interface EmailContent {
  text: string
  /** Pièces jointes effectivement lues. */
  attachments: string[]
  /** Pièces jointes ignorées, avec la raison (format, taille, fichier illisible, configuration). */
  skipped: string[]
}

export async function buildEmailContent(message: InboxMessage, ctx: ExtractionContext): Promise<EmailContent> {
  const { parts, skipped } = await readAttachments(message.attachments, ctx)
  const text = [
    `Objet : ${message.subject}`,
    message.text,
    ...parts.map(p => `--- Pièce jointe : ${p.filename} ---\n${p.text}`),
  ].filter(Boolean).join('\n\n')
  return { text: text.slice(0, MAX_PROMPT_CHARS), attachments: parts.map(p => p.filename), skipped }
}

/**
 * Appelle l'IA configurée dans Admin → Config IA (avec repli automatique) et valide sa réponse.
 * `timeoutMs` borne l'attente pour rester dans la durée d'exécution du passage planifié.
 */
export async function extractOffersFromEmail(content: string, timeoutMs: number): Promise<ParsedOffers> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Pas de réponse de l'IA après ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
  })
  try {
    const { content: raw } = await Promise.race([
      callLLM(
        [{ role: 'user', content: `Voici l'e-mail reçu (corps et pièces jointes) :\n\n${content}` }],
        AO_EXTRACTION_PROMPT + AO_EMAIL_ADDENDUM,
      ),
      timeout,
    ])
    return parseOffersJson(raw)
  } finally {
    clearTimeout(timer)
  }
}
