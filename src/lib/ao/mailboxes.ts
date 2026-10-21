import 'server-only'
import { ID } from 'node-appwrite'
import { openMailboxPassword, sealMailboxPassword } from './credentials'
import { mailboxErrorMessage } from './imap-errors'
import { withAoInbox } from './imap'
import { resolveImapHost } from './imap-host'
import { passwordProblem, type MailboxInput } from './mailbox-input'
import { createAoSource, ERASED_PASSWORD, getAoSource, isErased, listSources, updateAoSource, type AoSource } from './sources'
import { takeDailySlot } from './state'

// Gestion des boîtes de réception d'une organisation (écran du propriétaire) ou de la plateforme (admin). `tenantId`
// vient toujours de la session de l'appelant (actions serveur), jamais du formulaire : chaque fonction vérifie que la
// boîte visée lui appartient avant toute lecture ou écriture.

export const MAX_MAILBOXES = 10
// Tests de connexion par jour : par organisation, par boîte visée (serveur + identifiant, toutes organisations
// confondues) et pour toute la plateforme. Les organisations se créent librement : sans les deux dernières limites,
// le formulaire servirait à essayer en série des mots de passe de boîtes de tiers, depuis nos serveurs.
const MAX_TESTS_PER_DAY = 30
const MAX_TESTS_PER_TARGET_PER_DAY = 10
const MAX_TESTS_PER_DAY_ALL = 500
const TEST_TIMEOUT_MS = 30_000

/** Forme envoyée au navigateur : liste explicite des champs, jamais le mot de passe (ni chiffré, ni en clair). */
export interface MailboxView {
  id: string
  label: string
  host: string
  username: string
  mailbox: string
  enabled: boolean
  ownDomains: string[]
  lastSyncAt: string | null
  lastError: string
}

function toView(s: AoSource): MailboxView {
  return { id: s.$id, label: s.label, host: s.host, username: s.username, mailbox: s.mailbox, enabled: s.enabled, ownDomains: s.ownDomains, lastSyncAt: s.lastSyncAt, lastError: s.lastError }
}

/** Boîte de l'organisation (non supprimée) ; null sinon, y compris si elle appartient à une autre organisation. */
async function ownSource(tenantId: string, id: string): Promise<AoSource | null> {
  const source = await getAoSource(id)
  return source && source.tenantId === tenantId && !isErased(source) ? source : null
}

export async function listMailboxes(tenantId: string): Promise<MailboxView[]> {
  return (await listSources(tenantId)).filter(s => !isErased(s)).map(toView)
}

export type MailboxTest = { ok: true; messages: number } | { ok: false; error: string }

/**
 * « Tester la connexion » : serveur vérifié (adresses publiques), identifiant, mot de passe et dossier, ouvert en
 * lecture seule ; rien n'est enregistré. `existingId` : boîte modifiée (mot de passe enregistré réutilisé s'il n'est
 * pas ressaisi et que le serveur et l'identifiant n'ont pas changé).
 */
export async function testMailbox(tenantId: string, input: MailboxInput, existingId: string | null, now = new Date()): Promise<MailboxTest> {
  const existing = existingId ? await ownSource(tenantId, existingId) : null
  if (existingId && !existing) return { ok: false, error: 'Boîte introuvable : rechargez la page.' }
  const problem = passwordProblem(existing, input)
  if (problem) return { ok: false, error: problem }
  if (!(await takeDailySlot('mailboxTests', tenantId, now, MAX_TESTS_PER_DAY))) {
    return { ok: false, error: `${MAX_TESTS_PER_DAY} tests de connexion par jour au plus : réessayez demain.` }
  }
  if (!(await takeDailySlot('mailboxTarget', `${input.host}|${input.username.toLowerCase()}`, now, MAX_TESTS_PER_TARGET_PER_DAY))) {
    return { ok: false, error: 'Trop de tests aujourd’hui pour cette boîte : réessayez demain.' }
  }
  if (!(await takeDailySlot('mailboxTestsAll', 'plateforme', now, MAX_TESTS_PER_DAY_ALL))) {
    console.error('AO: plafond quotidien des tests de connexion atteint pour toute la plateforme', MAX_TESTS_PER_DAY_ALL)
    return { ok: false, error: 'Les tests de connexion sont momentanément indisponibles : réessayez demain.' }
  }
  try {
    // Mot de passe enregistré déchiffré pour LE serveur testé : s'il diffère de celui de la boîte, le déchiffrement
    // échoue (passwordProblem l'a déjà refusé ; le chiffrement le garantit aussi).
    const password = input.password || openMailboxPassword({ ...existing!, host: input.host, username: input.username })
    const endpoint = await resolveImapHost(input.host)
    const messages = await withAoInbox({ ...endpoint, user: input.username, password, mailbox: input.mailbox }, TEST_TIMEOUT_MS, async inbox => inbox.messageCount)
    return { ok: true, messages }
  } catch (err) {
    // Journal serveur : le message d'origine aide au diagnostic ; l'organisation voit sa traduction.
    console.warn('AO: test de boîte échoué', tenantId, input.host, err instanceof Error ? err.message : String(err))
    return { ok: false, error: mailboxErrorMessage(err, input.mailbox) }
  }
}

/** « Enregistrer » : la connexion est testée d'abord ; la boîte n'est enregistrée que si le test réussit. */
export async function saveMailbox(tenantId: string, input: MailboxInput, existingId: string | null, now = new Date()): Promise<{ mailbox?: MailboxView; error?: string }> {
  const others = (await listSources(tenantId)).filter(s => !isErased(s) && s.$id !== existingId)
  if (!existingId && others.length >= MAX_MAILBOXES) return { error: `${MAX_MAILBOXES} boîtes au plus par organisation.` }
  if (others.some(s => s.host === input.host && s.username === input.username && s.mailbox === input.mailbox)) {
    return { error: 'Cette boîte (même serveur, identifiant et dossier) est déjà enregistrée.' }
  }
  const test = await testMailbox(tenantId, input, existingId, now)
  if (!test.ok) return { error: test.error }

  const fields = { label: input.label, host: input.host, username: input.username, mailbox: input.mailbox, ownDomains: input.ownDomains, lastError: '' }
  if (existingId) {
    const sealed = input.password ? { passwordSealed: sealMailboxPassword({ $id: existingId, host: input.host, username: input.username }, input.password) } : {}
    return { mailbox: toView(await updateAoSource(existingId, { ...fields, ...sealed })) }
  }
  const id = ID.unique()
  const passwordSealed = sealMailboxPassword({ $id: id, host: input.host, username: input.username }, input.password)
  return { mailbox: toView(await createAoSource(id, { tenantId, ...fields, passwordSealed, enabled: true })) }
}

export async function setMailboxEnabled(tenantId: string, id: string, enabled: boolean): Promise<{ mailbox?: MailboxView; error?: string }> {
  if (!(await ownSource(tenantId, id))) return { error: 'Boîte introuvable : rechargez la page.' }
  return { mailbox: toView(await updateAoSource(id, { enabled })) }
}

/** Supprime la boîte pour l'organisation : plus lue, mot de passe effacé ; ses offres déjà reçues restent visibles. */
export async function deleteMailbox(tenantId: string, id: string): Promise<{ error?: string }> {
  if (!(await ownSource(tenantId, id))) return { error: 'Boîte introuvable : rechargez la page.' }
  await updateAoSource(id, { enabled: false, passwordSealed: ERASED_PASSWORD, lastError: '' })
  return {}
}
