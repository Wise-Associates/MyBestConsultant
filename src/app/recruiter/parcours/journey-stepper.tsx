import { Check } from 'lucide-react'
import type { JourneyStepState } from '@/lib/consultant-journey'

// Étapes du parcours en bandeau horizontal (flèches), de l'AO à la facture. Sur mobile le bandeau défile à
// l'intérieur de sa carte, jamais la page.

type StepState = JourneyStepState

export interface StepView {
  key: string
  label: string
  state: StepState
  /** Précision sous le libellé (« Score 82/100 », « Sans AO »…). */
  caption?: string
}

const STATE_LABEL: Record<StepState, string> = { done: 'terminée', current: 'en cours', upcoming: 'à venir', skipped: 'sans objet' }

// Orange de marque avec un texte anthracite (le blanc sur cet orange n'atteint pas le contraste AA).
const STYLE: Record<StepState, { background: string; color: string }> = {
  done: { background: 'var(--hero-bg)', color: '#FFFFFF' },
  current: { background: 'var(--color-brand-orange)', color: '#1C1C1E' },
  upcoming: { background: 'var(--color-secondary)', color: 'var(--color-text-muted)' },
  skipped: { background: 'var(--color-secondary)', color: 'var(--color-text-muted)' },
}

// Pointe à droite, encoche à gauche (sauf la première étape) : les flèches s'emboîtent.
const ARROW = 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)'
const FIRST_ARROW = 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)'

export function JourneyStepper({ steps }: { steps: StepView[] }) {
  const currentIndex = steps.findIndex(s => s.state === 'current')
  const current = steps[currentIndex]
  return (
    <div className="space-y-2">
      {/* Repère lisible sans faire défiler le bandeau (mobile) et pour les lecteurs d'écran. */}
      <p className="text-xs font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>
        {current ? `Étape ${currentIndex + 1} sur ${steps.length} · ${current.label}` : `${steps.length} étapes terminées`}
      </p>
      <div className="relative overflow-x-auto pb-1" tabIndex={0} aria-label="Étapes du parcours (défilement horizontal)">
        <ol className="flex gap-0.5">
          {steps.map((step, i) => (
            <li key={step.key} aria-current={step.state === 'current' ? 'step' : undefined}
              className="relative flex-1 flex flex-col justify-center min-w-[104px] h-14 pl-5 pr-4 -ml-2 first:ml-0 first:pl-3"
              style={{ ...STYLE[step.state], clipPath: i === 0 ? FIRST_ARROW : ARROW, opacity: step.state === 'skipped' ? 0.7 : 1 }}>
              <span className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                {step.state === 'done' && <Check className="h-3 w-3 shrink-0" aria-hidden />}
                {step.label}
              </span>
              <span className="sr-only">, étape {STATE_LABEL[step.state]}</span>
              {step.caption && <span className="text-[10px] leading-tight whitespace-nowrap opacity-80">{step.caption}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
