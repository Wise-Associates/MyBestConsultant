import { callLLM } from '@/lib/ai/llm-router'
import { llmUnavailableReason } from './ai-failures'
import { readAttachments } from './extractors/chain'
import { AiUnavailable, type ExtractionContext } from './extractors/types'
import type { InboxMessage } from './imap'
import { parseOffersJson, type ParsedOffers } from './parse'
import type { Sender } from './origin'
import { AO_EMAIL_ADDENDUM, AO_EXTRACTION_PROMPT, clientFromSender, clientFromText } from './prompt'
import { readTableAttachment } from './spreadsheet'
import type { ExtractedOffer } from './types'

// Préparation d'un e-mail : les tableaux d'offres joints sont lus directement (spreadsheet.ts) ; le reste
// (corps + autres pièces jointes, lues par la chaîne d'extracteurs) devient le texte confié à l'IA.

/** Taille maximale du texte envoyé à l'IA (même limite que l'import manuel d'appels d'offres). */
const MAX_PROMPT_CHARS = 40_000

export interface EmailContent {
  /** Texte à faire lire par l'IA ; vide si tout est venu des tableaux joints. */
  text: string
  /** Pièces jointes effectivement lues (tableaux compris). */
  attachments: string[]
  /** Pièces jointes ignorées, avec la raison (format, taille, fichier illisible, configuration). */
  skipped: string[]
  /** true : le corps de l'e-mail (et donc la signature de l'expéditeur) fait partie du texte confié à l'IA. */
  bodyIncluded: boolean
  /** Offres lues directement dans les tableaux joints, colonne par colonne, sans IA. */
  tableOffers: ExtractedOffer[]
  /** Lignes de tableau écartées, faute d'intitulé exploitable. */
  tableRowsSkipped: number
  /** true : un tableau dépassait MAX_TABLE_ROWS lignes, la suite n'a pas été lue. */
  tablesTruncated: boolean
}

export async function buildEmailContent(message: InboxMessage, ctx: ExtractionContext): Promise<EmailContent> {
  const tables: string[] = []
  const tableOffers: ExtractedOffer[] = []
  let tableRowsSkipped = 0
  let tablesTruncated = false
  const others: InboxMessage['attachments'] = []
  for (const file of message.attachments) {
    const table = readTableAttachment(file)
    // Tableau sans aucune ligne exploitable : lu comme texte par l'IA, avec le corps de l'e-mail.
    if (!table?.offers.length) { others.push(file); continue }
    tables.push(file.filename)
    tableOffers.push(...table.offers)
    tableRowsSkipped += table.skippedRows
    tablesTruncated ||= table.truncated
  }
  const { parts, skipped } = await readAttachments(others, ctx)
  const attachments = [...tables, ...parts.map(p => p.filename)]
  // Le corps d'un e-mail accompagné d'un tableau d'offres ne fait que le présenter : envoyé à l'IA, il
  // donnerait des quasi-doublons des lignes du tableau. Les autres pièces jointes, elles, sont lues.
  if (tables.length && !parts.length) return { text: '', bodyIncluded: false, attachments, skipped, tableOffers, tableRowsSkipped, tablesTruncated }
  const text = [
    `Objet : ${message.subject}`,
    tables.length ? '' : message.text,
    ...parts.map(p => `--- Pièce jointe : ${p.filename} ---\n${p.text}`),
  ].filter(Boolean).join('\n\n')
  return { text: text.slice(0, MAX_PROMPT_CHARS), bodyIncluded: !tables.length, attachments, skipped, tableOffers, tableRowsSkipped, tablesTruncated }
}

/**
 * Appelle l'IA configurée dans Admin → Config IA (avec repli automatique sur les autres modèles configurés)
 * et valide sa réponse. `timeoutMs` borne l'attente pour rester dans la durée d'exécution du passage planifié.
 * `origin` : expéditeur d'origine (origin.ts), dont l'IA lit l'entreprise dans la signature ; null si le corps de
 * l'e-mail ne lui est pas confié ou si l'expéditeur est inconnu (l'IA prend alors le client cité dans le texte).
 * `orgName` : organisation qui lit la boîte, jamais retenue comme client.
 * AiUnavailable si tous les modèles ont échoué sans frais (crédits épuisés, clé refusée, service en panne…).
 */
export async function extractOffersFromEmail(content: string, timeoutMs: number, origin: Sender | null, orgName: string): Promise<ParsedOffers> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Pas de réponse de l'IA après ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
  })
  const originLine = origin ? `Domaine de l'expéditeur d'origine : ${origin.address.split('@')[1]}\n\n` : ''
  let raw: string
  try {
    raw = (await Promise.race([
      callLLM(
        [{ role: 'user', content: `Voici l'e-mail reçu (corps et pièces jointes) :\n\n${originLine}${content}` }],
        AO_EXTRACTION_PROMPT + AO_EMAIL_ADDENDUM + (origin ? clientFromSender(orgName) : clientFromText(orgName)),
      ),
      timeout,
    ])).content
  } catch (err) {
    // callLLM a déjà essayé les autres modèles configurés ; son erreur garde l'échec de chacun.
    const reason = llmUnavailableReason(err)
    if (reason) throw new AiUnavailable(`extraction des offres — ${reason}`, 'text')
    throw err
  } finally {
    clearTimeout(timer)
  }
  return parseOffersJson(raw)
}
