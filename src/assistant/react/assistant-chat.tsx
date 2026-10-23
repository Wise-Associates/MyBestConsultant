'use client'

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { LifeBuoy, Loader2, MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { MAX_MESSAGE_LENGTH } from '../core/rules'
import type { HandoffOutcome, LatestResult, TurnResult } from '../core/turn'
import type { ChatMessage } from '../core/types'
import styles from './assistant-chat.module.css'

// Fenêtre de l'assistant IA (bouton flottant + panneau). Portable : le site lui passe ses actions serveur (qui
// vérifient l'utilisateur) et la stylise par ses variables --assistant-* (assistant-chat.module.css).

export interface AssistantChatProps {
  /** Titre de l'en-tête. */
  title?: string
  /** Texte d'accueil d'une conversation vide (propre au site). */
  welcome: string
  send(conversationId: string | null, text: string): Promise<TurnResult>
  loadLatest(): Promise<LatestResult>
  handoff(conversationId: string): Promise<HandoffOutcome>
}

type Loading = 'idle' | 'loading' | 'ready' | 'error'
type Handoff = { step: 'idle' } | { step: 'confirm' } | { step: 'sending' } | { step: 'done'; url: string }

/** Le compteur n'apparaît qu'à l'approche de la limite. */
const COUNTER_FROM = Math.floor(MAX_MESSAGE_LENGTH * 0.8)

export function AssistantChat({ title = 'Assistant IA', welcome, send, loadLatest, handoff }: AssistantChatProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<Loading>('idle')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [handoffState, setHandoffState] = useState<Handoff>({ step: 'idle' })
  const [sending, startSending] = useTransition()
  const panelId = useId()
  const titleId = useId()
  const launcherRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Le bouton d'ouverture ne reprend le focus qu'après une fermeture, pas au premier affichage de la page.
  const wasOpen = useRef(false)

  async function load() {
    setLoading('loading')
    setError(null)
    try {
      const res = await loadLatest()
      if (!res.ok) { setError(res.error); setLoading('error'); return }
      setConversationId(res.conversation?.conversationId ?? null)
      setMessages(res.conversation?.messages ?? [])
      setLoading('ready')
    } catch (err) {
      // Action serveur injoignable (réseau, déploiement en cours…).
      console.error('[assistant] chargement de la conversation en échec', err)
      setError('Impossible de charger la conversation : connexion interrompue ou délai dépassé. Réessayez.')
      setLoading('error')
    }
  }

  function openPanel() {
    setOpen(true)
    if (loading === 'idle') void load()
  }

  useEffect(() => {
    if (open) { wasOpen.current = true; textareaRef.current?.focus() }
    else if (wasOpen.current) launcherRef.current?.focus()
  }, [open])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, pendingQuestion, open])

  // Le focus ne doit jamais retomber sur la page quand un bouton disparaît (sinon Échap ne ferme plus le panneau) :
  // la confirmation prend le focus, et il revient à la zone de saisie ensuite.
  useEffect(() => {
    if (handoffState.step === 'confirm') confirmRef.current?.focus()
    else if (handoffState.step === 'idle' || handoffState.step === 'done') textareaRef.current?.focus()
  }, [handoffState.step])

  // La zone de saisie grandit avec le texte (bornée par max-height en CSS) et revient à une ligne une fois vidée.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [draft, open])

  function submit() {
    const text = draft.trim()
    // Pas d'envoi tant que la conversation n'est pas chargée (en cours ou en échec) : la conversation reprise
    // remplacerait celle que l'envoi aurait créée.
    if (!text || text.length > MAX_MESSAGE_LENGTH || sending || loading !== 'ready') return
    setError(null)
    setNotice(null)
    setHandoffState({ step: 'idle' })
    setPendingQuestion(text)
    setDraft('')
    // En cas d'échec, le texte revient dans la zone de saisie (sauf si une autre saisie a commencé entre-temps) :
    // l'utilisateur peut réessayer sans le retaper.
    const restoreDraft = () => setDraft(current => current || text)
    startSending(async () => {
      try {
        const res = await send(conversationId, text)
        if (res.ok) {
          setConversationId(res.conversationId)
          setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: res.answer }])
          if (!res.saved) setNotice('Réponse affichée mais non enregistrée : elle ne sera ni reprise à la prochaine ouverture, ni transmise au support.')
        } else {
          if (res.code === 'not_found') { setConversationId(null); setMessages([]) }
          restoreDraft()
          setError(res.error)
        }
      } catch (err) {
        console.error('[assistant] envoi en échec', err)
        restoreDraft()
        setError('Votre message n’a pas pu être envoyé : connexion interrompue ou délai dépassé. Réessayez.')
      } finally {
        setPendingQuestion(null)
      }
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée envoie, Maj+Entrée va à la ligne ; pas pendant la composition d'un caractère (saisie asiatique, accents).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  function newConversation() {
    setConversationId(null)
    setMessages([])
    setError(null)
    setNotice(null)
    setHandoffState({ step: 'idle' })
    textareaRef.current?.focus()
  }

  async function confirmHandoff() {
    if (!conversationId) return
    setHandoffState({ step: 'sending' })
    setError(null)
    try {
      const res = await handoff(conversationId)
      if (res.ok) setHandoffState({ step: 'done', url: res.url })
      else { setHandoffState({ step: 'idle' }); setError(res.error) }
    } catch (err) {
      console.error('[assistant] transmission au support en échec', err)
      setHandoffState({ step: 'idle' })
      setError('La demande n’a pas pu être transmise : connexion interrompue ou délai dépassé. Réessayez.')
    }
  }

  const tooLong = draft.length > MAX_MESSAGE_LENGTH
  const canHandoff = !!conversationId && messages.length > 0 && !sending

  return (
    <div className={styles.root}>
      {!open && (
        <button ref={launcherRef} type="button" className={styles.launcher} onClick={openPanel} aria-haspopup="dialog">
          <MessageCircle size={20} aria-hidden />
          {/* Nom du bouton pour les lecteurs d'écran, masqué visuellement sur téléphone (bouton rond). */}
          <span className={styles.launcherLabel}>{title}</span>
        </button>
      )}

      {open && (
        <section id={panelId} className={styles.panel} role="dialog" aria-modal={false} aria-labelledby={titleId}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
          <header className={styles.header}>
            <div>
              <h2 id={titleId} className={styles.headerTitle}>{title}</h2>
              <p className={styles.headerNote}>Réponses générées par une IA, parfois inexactes. Ne partagez ni mot de passe ni données bancaires.</p>
            </div>
            <div className={styles.headerActions}>
              <button type="button" className={styles.iconButton} onClick={newConversation}
                disabled={sending || messages.length === 0} aria-label="Nouvelle conversation" title="Nouvelle conversation">
                <RotateCcw size={18} aria-hidden />
              </button>
              <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Fermer l’assistant" title="Fermer">
                <X size={20} aria-hidden />
              </button>
            </div>
          </header>

          <div ref={logRef} className={styles.log} role="log" aria-live="polite" aria-label="Conversation avec l’assistant">
            {loading === 'loading' && (
              <div className={styles.status}><Loader2 size={20} className={styles.spin} aria-hidden />Chargement de la conversation…</div>
            )}
            {loading === 'error' && (
              <div className={styles.status}>
                <button type="button" className={styles.primaryButton} onClick={() => void load()}>Réessayer</button>
              </div>
            )}
            {loading === 'ready' && messages.length === 0 && !pendingQuestion && (
              <p className={styles.empty}><span className={styles.emptyTitle}>Bonjour !</span>{welcome}</p>
            )}
            {messages.map((m, i) => (
              <p key={i} className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                <span className={styles.srOnly}>{m.role === 'user' ? 'Vous : ' : 'Assistant : '}</span>{m.content}
              </p>
            ))}
            {pendingQuestion && (
              <>
                <p className={`${styles.bubble} ${styles.user} ${styles.pending}`}><span className={styles.srOnly}>Vous : </span>{pendingQuestion}</p>
                <div className={styles.typing}>
                  <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
                  <span className={styles.srOnly}>L’assistant rédige sa réponse…</span>
                </div>
              </>
            )}
          </div>

          {error && <p className={styles.alert} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}

          {handoffState.step === 'confirm' && (
            <div className={styles.notice}>
              Cette conversation sera jointe à une demande de support, lue par notre équipe. Elle vous répondra dans votre espace Aide &amp; support.
              <div className={styles.noticeActions}>
                <button type="button" className={styles.textButton} onClick={() => setHandoffState({ step: 'idle' })}>Annuler</button>
                <button ref={confirmRef} type="button" className={styles.primaryButton} onClick={() => void confirmHandoff()}>Transmettre</button>
              </div>
            </div>
          )}
          {handoffState.step === 'done' && (
            <p className={styles.notice} role="status">
              Demande transmise. Notre équipe vous répondra dans votre espace Aide &amp; support. <a href={handoffState.url}>Voir ma demande</a>
            </p>
          )}

          <form className={styles.composer} onSubmit={e => { e.preventDefault(); submit() }}>
            <div className={styles.inputRow}>
              <label htmlFor={`${panelId}-input`} className={styles.srOnly}>Votre question</label>
              <textarea id={`${panelId}-input`} ref={textareaRef} className={styles.textarea} rows={1} value={draft}
                onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder="Posez votre question…"
                aria-invalid={tooLong} />
              <button type="submit" className={styles.sendButton} disabled={sending || !draft.trim() || tooLong || loading !== 'ready'}
                aria-label="Envoyer">
                {sending ? <Loader2 size={18} className={styles.spin} aria-hidden /> : <Send size={18} aria-hidden />}
              </button>
            </div>
            <div className={styles.composerMeta}>
              {canHandoff && handoffState.step !== 'done' ? (
                <button type="button" className={styles.textButton} onClick={() => setHandoffState({ step: 'confirm' })}
                  disabled={handoffState.step === 'sending'}>
                  {handoffState.step === 'sending' ? <Loader2 size={14} className={styles.spin} aria-hidden /> : <LifeBuoy size={14} aria-hidden />}
                  Transmettre au support
                </button>
              ) : <span />}
              {draft.length >= COUNTER_FROM && (
                <span className={`${styles.counter} ${tooLong ? styles.counterOver : ''}`}>{draft.length}/{MAX_MESSAGE_LENGTH}</span>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
