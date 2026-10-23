import 'server-only'
import { ID, Query, type Models } from 'node-appwrite'
import type { AssistantHost, ChatMessage, ConversationStore } from '@/assistant/core/types'
import { retentionCutoff } from '@/assistant/core/rules'
import { LLMHttpError, callLLM } from '@/lib/ai/llm-router'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { purgeDailyState, takeDailySlot } from '@/lib/ao/state'
import { createTicket } from '@/lib/support'
import type { UserProfile } from '@/types'
import { assistantKnowledge } from './knowledge'

// Branchement du module assistant (src/assistant, portable) sur MyBestConsultant : session Appwrite, collection
// ASSISTANT_TURNS (sans permission client : seule la clé serveur y accède), quotas en compteurs atomiques, modèle de
// Config IA, tickets du Help Desk. Décisions : docs/adr/0007-assistant-ia-portable.md.

/** Rôles qui ont l'assistant (v1) : ni les chasseurs, ni l'admin, ni les visiteurs. */
const ASSISTANT_ROLES = new Set(['candidate', 'recruiter'])

/** Conversations supprimées après 90 jours (purge quotidienne : /api/cron/assistant-purge). */
export const ASSISTANT_RETENTION_DAYS = 90

/** Messages par jour (UTC) : par utilisateur, et pour toute la plateforme (plafond de coût). */
export const ASSISTANT_DAILY_LIMITS = { perUser: 30, platform: 1000 } as const

/** Les places de quota (AO_STATE) sont gardées 7 jours, comme les autres compteurs quotidiens. */
const QUOTA_SLOTS_KEPT_DAYS = 7

/**
 * Collection des conversations définie : la purge et la suppression avec le compte en dépendent, que l'assistant soit
 * affiché ou non. Ne pas retirer la variable tant que la collection contient des conversations (ADR 0007).
 */
export const isAssistantStorageConfigured = () => !!COLLECTIONS.ASSISTANT_TURNS

/**
 * Assistant affiché et utilisable : collection et compteurs de quota configurés, et ASSISTANT_ENABLED à « true ».
 * Le masquer = retirer ASSISTANT_ENABLED, jamais la variable de la collection.
 */
export const isAssistantEnabled = () =>
  isAssistantStorageConfigured() && !!COLLECTIONS.AO_STATE && process.env.ASSISTANT_ENABLED === 'true'

function collection(): string {
  if (!COLLECTIONS.ASSISTANT_TURNS) throw new Error('Assistant indisponible : créez la collection (npm run assistant:setup) et définissez APPWRITE_COLLECTION_ASSISTANT_TURNS.')
  return COLLECTIONS.ASSISTANT_TURNS
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const codeOf = (err: unknown) => (err as { code?: number }).code
const typeOf = (err: unknown) => (err as { type?: string }).type

/** Un document par échange (question + réponse) : enregistrés ensemble, jamais l'un sans l'autre. */
function toMessages(docs: Models.Document[]): ChatMessage[] {
  return docs.flatMap(d => [{ role: 'user' as const, content: str(d.question) }, { role: 'assistant' as const, content: str(d.answer) }])
}

/**
 * Supprime par lots de 100 les documents qui répondent à `queries`, jusqu'à `deadline` (ms) ; `done: false` s'il en
 * reste. Collection absente (variable définie avant sa création) : rien n'est stocké, donc rien à supprimer.
 */
async function deleteAll(queries: string[], deadline: number): Promise<{ deleted: number; done: boolean }> {
  const { databases } = createAdminClient()
  let deleted = 0
  for (;;) {
    let page: Models.DocumentList<Models.Document>
    try {
      page = await databases.listDocuments(DB_ID, collection(), [...queries, Query.select(['$id']), Query.limit(100)])
    } catch (err) {
      if (typeOf(err) !== 'collection_not_found') throw err
      console.warn('[assistant] collection des conversations absente : rien à supprimer')
      return { deleted, done: true }
    }
    let progress = 0
    for (const doc of page.documents) {
      try {
        await databases.deleteDocument(DB_ID, collection(), doc.$id)
        progress++
      } catch (err) {
        // 404 : déjà supprimé par un autre passage (purge et suppression de compte simultanées).
        if (codeOf(err) !== 404) throw err
      }
    }
    deleted += progress
    if (page.documents.length < 100) return { deleted, done: true }
    // Aucun progrès (lot entièrement déjà supprimé) ou temps écoulé : on s'arrête, le passage suivant reprendra.
    if (progress === 0 || Date.now() > deadline) return { deleted, done: false }
  }
}

const store: ConversationStore = {
  newId: () => ID.unique(),

  async list(userId, conversationId, maxTurns) {
    const { databases } = createAdminClient()
    // userId dans la requête : la conversation d'un autre utilisateur ne renvoie rien (« introuvable »).
    const res = await databases.listDocuments(DB_ID, collection(), [
      Query.equal('userId', userId), Query.equal('conversationId', conversationId), Query.orderDesc('$createdAt'), Query.limit(maxTurns),
    ])
    return toMessages(res.documents.reverse())
  },

  async latest(userId, maxTurns) {
    const { databases } = createAdminClient()
    const last = await databases.listDocuments(DB_ID, collection(), [
      Query.equal('userId', userId), Query.orderDesc('$createdAt'), Query.select(['conversationId']), Query.limit(1),
    ])
    const conversationId = str(last.documents[0]?.conversationId)
    return conversationId ? { conversationId, messages: await store.list(userId, conversationId, maxTurns) } : null
  },

  async append(user, conversationId, question, answer, provider) {
    const { databases } = createAdminClient()
    await databases.createDocument(DB_ID, collection(), ID.unique(), {
      conversationId, userId: user.id, question, answer, provider: provider.slice(0, 60),
    })
  },

  async purgeBefore(cutoff) {
    // 4 min au plus (la route en a 5) : un passage interrompu reprend au suivant, rien n'est perdu.
    const { deleted, done } = await deleteAll([Query.lessThan('$createdAt', cutoff.toISOString())], Date.now() + 240_000)
    if (!done) console.warn('[assistant] purge incomplète, suite au prochain passage', deleted)
    return deleted
  },

  async deleteForUser(userId) {
    const { done } = await deleteAll([Query.equal('userId', userId)], Date.now() + 120_000)
    if (!done) throw new Error('Suppression des conversations avec l’assistant inachevée : recommencez.')
  },
}

/** Purge quotidienne des conversations de plus de ASSISTANT_RETENTION_DAYS jours ; renvoie le nombre d'échanges supprimés. */
export function purgeExpiredAssistantTurns(now: Date): Promise<number> {
  return store.purgeBefore(retentionCutoff(now, ASSISTANT_RETENTION_DAYS))
}

/**
 * Places de quota de plus de 7 jours (deux par message, dans AO_STATE) : plus nombreuses que les 100 qu'efface chaque
 * passage planifié des appels d'offres, elles sont aussi purgées ici, par lots, jusqu'à `deadline` (ms).
 */
export async function purgeOldAssistantQuotaSlots(now: Date, deadline: number): Promise<number> {
  if (!COLLECTIONS.AO_STATE) return 0
  const before = retentionCutoff(now, QUOTA_SLOTS_KEPT_DAYS)
  let total = 0
  for (;;) {
    const found = await purgeDailyState(before)
    total += found
    if (found < 100 || Date.now() > deadline) return total
  }
}

/** Suppression d'un compte (admin, retrait d'un membre d'équipe) : ses conversations avec l'assistant partent avec lui. */
export function deleteAssistantTurnsForUser(userId: string): Promise<void> {
  return store.deleteForUser(userId)
}

/** Un site hôte par requête : le profil lu par getUser sert ensuite au ticket de support, sans relire la session. */
export function createAssistantHost(): AssistantHost {
  let profile: UserProfile | null = null
  return {
    siteName: 'MyBestConsultant',

    async getUser() {
      profile = await getCurrentUser()
      // Adresse vérifiée exigée : l'inscription est libre et sans limite, des comptes jetables épuiseraient sinon le
      // quota de toute la plateforme (même règle que les tests de boîtes d'appels d'offres).
      if (!profile || !ASSISTANT_ROLES.has(profile.role) || !profile.emailVerification) return null
      return { id: profile.userId, role: profile.role }
    },

    store,

    async takeQuota(user, now) {
      // Quota de l'utilisateur d'abord : celui qui a épuisé le sien ne prend plus de place sur celui de la plateforme.
      if (!(await takeDailySlot('assistantUser', user.id, now, ASSISTANT_DAILY_LIMITS.perUser))) return 'user-limit'
      if (!(await takeDailySlot('assistantAll', 'platform', now, ASSISTANT_DAILY_LIMITS.platform))) {
        console.warn('[assistant] plafond quotidien de la plateforme atteint', ASSISTANT_DAILY_LIMITS.platform)
        return 'site-limit'
      }
      return 'ok'
    },

    async complete(system, messages) {
      try {
        // strict : pas de repli sur les autres modèles configurés, qui recevraient alors les conversations (ADR 0007).
        const { content, provider } = await callLLM(messages, system, { module: 'assistant', strict: true })
        return { text: content, provider }
      } catch (err) {
        // Le corps d'une erreur HTTP peut recopier la requête (certains serveurs compatibles OpenAI), donc le texte de
        // l'utilisateur : seul le statut est gardé pour les journaux.
        if (err instanceof LLMHttpError) throw new Error(`Modèle IA : erreur HTTP ${err.status}`)
        throw err
      }
    },

    knowledge: user => assistantKnowledge(user.role === 'recruiter' ? 'recruiter' : 'candidate'),

    async handoff(user, transcript) {
      // getUser vient de lire ce profil (le module l'appelle toujours d'abord) ; sinon, on ne crée rien.
      if (!profile || profile.userId !== user.id) return { ok: false, error: 'Session expirée : reconnectez-vous.' }
      const res = await createTicket(
        { userId: profile.userId, name: `${profile.firstName} ${profile.lastName}`.trim() || profile.email, email: profile.email, role: profile.role, tenantId: profile.tenantId },
        { subject: 'Question posée à l’assistant IA', category: 'other', priority: 'normal', body: transcript },
      )
      if (!res.ticket) return { ok: false, error: res.error ?? 'Impossible de créer la demande, réessayez.' }
      return { ok: true, url: `/${profile.role === 'recruiter' ? 'recruiter' : 'candidate'}/support/${res.ticket.id}` }
    },
  }
}
