// Composant client : importé seulement par mbc-search-client.tsx (« use client »), qui en fait du code navigateur.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Circle, Loader2, PenLine, Radar } from 'lucide-react'
import { QUESTION_LIMITS, type MbcAnswer, type MbcQuestion } from '@/lib/mbc-search/conversation'
import { orangeTint, surface } from './mbc-search-ui'

// Éléments du fil de conversation de MBC Search : messages du recruteur et de l'IA, étapes en cours, carte des
// questions avant la recherche, champ du bas. Couleurs du thème du site seulement.

/** Marque de l'IA de MBC Search devant ses messages (même icône que la rubrique du menu). */
export function AssistantMark() {
  return (
    <span aria-hidden className="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
      style={{ background: orangeTint(12), color: 'var(--color-brand-orange)' }}>
      <Radar className="h-4 w-4" />
    </span>
  )
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-line break-words"
        style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}>
        <span className="sr-only">Vous : </span>{children}
      </p>
    </div>
  )
}

/**
 * Message de l'IA ; `children` : ce qui le suit sous le texte (carte de questions, étapes). `continued` : suite du
 * message précédent de l'IA (carte de questions sous sa phrase) : aligné sur lui, sans seconde marque.
 */
export function AssistantMessage({ text, children, continued = false }: { text?: string; children?: ReactNode; continued?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${continued ? '-mt-3' : ''}`}>
      {/* Suite d'un message : alignée sur son texte, pleine largeur sur mobile (carte de questions lisible). */}
      {continued ? <span aria-hidden className="hidden sm:block w-8 shrink-0" /> : <AssistantMark />}
      <div className="flex-1 min-w-0 space-y-3">
        {text && <p className="text-sm leading-relaxed pt-1.5" style={{ color: 'var(--color-text)' }}><span className="sr-only">MBC Search : </span>{text}</p>}
        {children}
      </div>
    </div>
  )
}

/** Étapes en cours : faites (coche), en cours (roue), à venir (cercle). */
export function ProgressSteps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="space-y-1.5 pt-1.5" aria-label="Étapes en cours">
      {steps.map((label, i) => {
        const state = i < at ? 'done' : i === at ? 'run' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2 text-sm"
            style={{ color: state === 'todo' ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
            {state === 'done' ? <Check className="h-4 w-4" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
              : state === 'run' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
                : <Circle className="h-4 w-4" style={{ color: 'var(--color-border)' }} aria-hidden />}
            {label}{state === 'run' ? '…' : ''}
            <span className="sr-only">{{ done: ' : terminée', run: ' : en cours', todo: ' : à venir' }[state]}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Questions de l'IA avant la recherche, une à la fois : réponses proposées numérotées (plusieurs possibles, touches 1 à
 * 4), réponse libre, « Passer ». La dernière lance la recherche avec toutes les réponses (questions passées : vides).
 */
export function QuestionCard({ questions, disabled, onSubmit }: {
  questions: MbcQuestion[]; disabled: boolean; onSubmit: (answers: MbcAnswer[]) => void
}) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<MbcAnswer[]>(() => questions.map(q => ({ question: q.question, choices: [], text: '' })))
  const q = questions[index]
  const a = answers[index]
  const last = index === questions.length - 1
  const count = a.choices.length + (a.text.trim() ? 1 : 0)

  const update = (patch: Partial<MbcAnswer>) => setAnswers(list => list.map((x, i) => (i === index ? { ...x, ...patch } : x)))
  const toggle = (option: string) => update({ choices: a.choices.includes(option) ? a.choices.filter(c => c !== option) : [...a.choices, option] })
  const advance = (list: MbcAnswer[]) => (last ? onSubmit(list) : setIndex(index + 1))
  const skip = () => {
    const cleared = answers.map((x, i) => (i === index ? { ...x, choices: [], text: '' } : x))
    setAnswers(cleared)
    advance(cleared)
  }
  // Touches 1 à 4 : cochent la réponse du même numéro, sauf pendant la saisie de la réponse libre.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      e.preventDefault()
      toggle(q.options[n - 1])
    }
  }

  return (
    <div role="group" aria-label={`Question ${index + 1} sur ${questions.length}`} onKeyDown={onKey}
      className="rounded-2xl overflow-hidden max-w-2xl" style={{ ...surface, boxShadow: '0 12px 32px -20px rgba(0,0,0,0.35)' }}>
      <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{q.question}</p>
        {questions.length > 1 && (
          <span className="inline-flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Question précédente"
              className="rounded p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            {index + 1} sur {questions.length}
            <button type="button" onClick={() => setIndex(index + 1)} disabled={last} aria-label="Question suivante"
              className="rounded p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </span>
        )}
      </div>
      <ul>
        {q.options.map((option, i) => {
          const on = a.choices.includes(option)
          return (
            <li key={option} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(option)} disabled={disabled}
                className="w-full flex items-center gap-3 px-4 sm:px-5 min-h-12 py-2.5 text-left text-sm transition-colors hover:bg-[var(--color-background)] disabled:opacity-50"
                style={{ color: 'var(--color-text)', background: on ? orangeTint(8) : undefined }}>
                <span aria-hidden className="inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold shrink-0"
                  style={on ? { background: 'var(--color-brand-orange)', color: 'white' } : { background: orangeTint(12), color: 'var(--color-text)' }}>
                  {on ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={on ? 'font-semibold' : ''}>{option}</span>
              </button>
            </li>
          )
        })}
        <li className="px-4 sm:px-5 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <label className="flex items-center gap-3">
            <span aria-hidden className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0" style={{ background: orangeTint(12), color: 'var(--color-text)' }}>
              <PenLine className="h-3.5 w-3.5" />
            </span>
            <span className="sr-only">Votre réponse</span>
            <input value={a.text} onChange={e => update({ text: e.target.value })} maxLength={QUESTION_LIMITS.answer} disabled={disabled}
              onKeyDown={e => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                e.preventDefault()
                // Comme « Suivante » : rien sans réponse (« Passer » est là pour ça).
                if (count > 0) advance(answers)
              }}
              placeholder="Votre réponse…" className="flex-1 min-w-0 bg-transparent text-sm outline-none" style={{ color: 'var(--color-text)' }} />
          </label>
          {a.text && <p className="mt-1 pl-9 text-xs" style={{ color: 'var(--color-text-muted)' }}>{QUESTION_LIMITS.answer - a.text.length} caractères restants</p>}
        </li>
      </ul>
      <div className="flex items-center gap-3 px-4 sm:px-5 py-2.5" style={{ background: 'var(--color-background)' }}>
        <span className="flex-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {count === 0 ? 'Aucune réponse' : `${count} réponse${count > 1 ? 's' : ''}`}
        </span>
        <button type="button" onClick={skip} disabled={disabled} className="px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          Passer
        </button>
        <button type="button" onClick={() => advance(answers)} disabled={disabled || count === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          {last ? 'Lancer la recherche' : 'Suivante'} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * Champ de saisie avec bouton d'envoi : Entrée envoie, Maj + Entrée va à la ligne. `minLength` : envoi grisé en dessous.
 * Le champ est vidé à l'envoi : le texte envoyé reste lisible dans le fil (message du recruteur).
 */
export function PromptBox({ id, label, placeholder, rows, maxLength, minLength = 1, disabled, autoFocus, footer, onSend, value, onValueChange, inputRef }: {
  id: string; label: string; placeholder: string; rows: number; maxLength: number; minLength?: number; disabled: boolean; autoFocus?: boolean
  footer?: ReactNode; onSend: (text: string) => void; value?: string; onValueChange?: (v: string) => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [own, setOwn] = useState('')
  const text = value ?? own
  const setText = onValueChange ?? setOwn
  const localRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? localRef
  const ready = !disabled && text.trim().length >= minLength
  const send = () => {
    if (!ready) return
    onSend(text.trim())
    setText('')
  }
  return (
    <div className="rounded-2xl transition-colors focus-within:border-[var(--color-brand-orange)]"
      style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', boxShadow: '0 16px 40px -28px rgba(0,0,0,0.35)' }}>
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <label htmlFor={id} className="sr-only">{label}</label>
        <textarea id={id} ref={ref} value={text} onChange={e => setText(e.target.value)} rows={rows} maxLength={maxLength} autoFocus={autoFocus}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          placeholder={placeholder} className="flex-1 min-w-0 resize-none bg-transparent py-1 text-sm sm:text-base outline-none" style={{ color: 'var(--color-text)' }} />
        <button type="button" onClick={send} disabled={!ready} aria-label="Envoyer"
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-opacity disabled:opacity-35"
          style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      {footer && <div className="px-4 pb-3">{footer}</div>}
    </div>
  )
}
