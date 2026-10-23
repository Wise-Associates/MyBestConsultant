// Contrat entre le module assistant (portable : voir src/assistant/README.md) et le site qui l'accueille.
// Le module n'importe rien du site : tout ce qui dépend du site (session, base, modèle IA, support, contenu d'aide)
// passe par AssistantHost.

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** Utilisateur de la session du site. */
export interface AssistantUser {
  id: string
  role: string
}

/** Résultat d'une prise de quota : accordée, ou refusée par la limite de l'utilisateur ou par celle du site. */
export type QuotaCheck = 'ok' | 'user-limit' | 'site-limit'

export interface ConversationStore {
  /** Nouvel identifiant de conversation (36 caractères au plus : lettres, chiffres, `_`, `-`). */
  newId(): string
  /**
   * Les `maxTurns` derniers échanges d'une conversation DE CET UTILISATEUR, du plus ancien au plus récent, à plat
   * (question puis réponse). [] si la conversation n'existe pas ou appartient à quelqu'un d'autre.
   */
  list(userId: string, conversationId: string, maxTurns: number): Promise<ChatMessage[]>
  /** Dernière conversation de l'utilisateur (ses `maxTurns` derniers échanges), ou null s'il n'en a pas. */
  latest(userId: string, maxTurns: number): Promise<{ conversationId: string; messages: ChatMessage[] } | null>
  /** Enregistre une question et sa réponse en une seule écriture : jamais de question sans réponse. */
  append(user: AssistantUser, conversationId: string, question: string, answer: string, provider: string): Promise<void>
  // Obligations RGPD du site, appelées par sa tâche planifiée et par sa suppression de compte (pas par le module).
  /** Supprime les échanges enregistrés avant `cutoff` ; renvoie leur nombre. */
  purgeBefore(cutoff: Date): Promise<number>
  /** Supprime tous les échanges de l'utilisateur. */
  deleteForUser(userId: string): Promise<void>
}

export type HandoffResult = { ok: true; url: string } | { ok: false; error: string }

export interface AssistantHost {
  /** Nom du site, tel que l'assistant le cite. */
  siteName: string
  /** Utilisateur connecté qui a droit à l'assistant, sinon null. Vérifié côté serveur à chaque appel. */
  getUser(): Promise<AssistantUser | null>
  store: ConversationStore
  /** Prend une place dans les quotas du jour (par utilisateur, pour tout le site…), ou dit lequel est atteint. */
  takeQuota(user: AssistantUser, now: Date): Promise<QuotaCheck>
  /** Appel au modèle IA du site. `provider` : modèle qui a répondu, enregistré avec l'échange. */
  complete(system: string, messages: ChatMessage[]): Promise<{ text: string; provider: string }>
  /** Contenu d'aide du site pour le rôle de l'utilisateur : la seule source des réponses. */
  knowledge(user: AssistantUser): string
  /** Transmet la conversation à une personne (ticket de support, e-mail…). */
  handoff(user: AssistantUser, transcript: string): Promise<HandoffResult>
}
