import Link from 'next/link'
import { Check, Lock, Plus, Receipt, ShieldCheck } from 'lucide-react'
import type { UserRole } from '@/types'
import {
  COMPARISON_COLUMNS, COMPARISON_ROWS, CUSTOM_PLAN_CARD, PLAN_CARDS, PRICES_NOTE, PRICING_FAQ, QUOTE_REQUEST_HREF,
  type ComparisonCell, type PlanCard,
} from '@/lib/plan-catalog'

// Page publique des formules (refonte du 2026-11-13 d'après les maquettes bureau et mobile) : cartes des formules,
// tableau de comparaison, questions fréquentes. Présentation seulement : un recruteur connecté choisit et paie dans son
// espace (/recruiter/abonnement), où ses droits sont vérifiés ; une organisation qui veut plus demande un devis.
// Textes et prix : src/lib/plan-catalog.ts. Composant serveur ; les questions s'ouvrent sans JavaScript (<details>).

const RECRUITER_SPACE = '/recruiter/abonnement'
const muted = { color: 'var(--color-text-muted)' } as const
/** Orange du thème assombri, pour du texte sur fond clair (l'orange pur y est peu lisible). */
const PRIMARY_INK = 'color-mix(in srgb, var(--color-primary) 62%, black)'

type CtaTone = 'outline' | 'accent' | 'dark'
const CTA_STYLE: Record<CtaTone, React.CSSProperties> = {
  outline: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
  // Texte sombre sur l'orange du thème : le blanc n'y est pas lisible.
  accent: { background: 'var(--color-primary)', color: 'var(--color-text)', border: '1px solid var(--color-primary)' },
  dark: { background: 'var(--navbar-bg)', color: 'white', border: '1px solid var(--navbar-bg)' },
}
const ctaClass = 'mt-5 w-full h-11 rounded-xl inline-flex items-center justify-center text-sm font-semibold no-underline transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'

function Cta({ href, label, tone }: { href: string; label: string; tone: CtaTone }) {
  return <Link href={href} className={ctaClass} style={CTA_STYLE[tone]}>{label}</Link>
}

const ADMIN_NOTE = (
  <p className="mt-5 w-full h-11 rounded-xl inline-flex items-center justify-center text-sm font-semibold"
    style={{ background: 'var(--color-secondary)', color: 'var(--color-text-muted)' }}>
    Compte administrateur
  </p>
)

/**
 * Bouton d'une formule : visiteur → inscription recruteur ; recruteur connecté → son espace, où il choisit et paie ;
 * candidat ou chasseur connecté → contact (une formule est celle d'une organisation de recruteurs).
 */
function planCta(card: PlanCard, userRole: UserRole | null, tone: CtaTone): React.ReactNode {
  if (userRole === 'admin') return ADMIN_NOTE
  if (userRole === 'recruiter') return <Cta href={RECRUITER_SPACE} label="Gérer mon abonnement" tone={tone} />
  if (userRole) return <Cta href="/contact" label={card.cta} tone={tone} />
  return <Cta href={`/register?role=recruiter&plan=${card.id}`} label={card.cta} tone={tone} />
}

function PlanColumn({ name, tagline, priceLabel, unit, note, featuresIntro, features, highlight, action }: {
  name: string; tagline: string; priceLabel: string; unit?: string; note: string; featuresIntro?: string
  features: readonly string[]; highlight: boolean; action: React.ReactNode
}) {
  const text = highlight ? 'white' : 'var(--color-text)'
  const soft = highlight ? 'rgba(255,255,255,0.72)' : 'var(--color-text-muted)'
  return (
    <article className="rounded-[20px] p-6 flex flex-col h-full"
      style={highlight
        ? { background: 'var(--navbar-bg)', border: '1px solid var(--navbar-bg)', color: text }
        : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: text }}>
      <div className="flex items-center justify-between gap-2">
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h2 style={{ color: text, fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 }}>{name}</h2>
        {highlight && (
          <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}>
            Le plus choisi
          </span>
        )}
      </div>
      {/* Deux lignes réservées dès 1280 px : prix et boutons des quatre cartes alignés. */}
      <p className="text-[13px] mt-1 xl:min-h-10" style={{ color: soft }}>{tagline}</p>

      <p className="mt-6 flex items-baseline gap-1.5">
        <span className="font-semibold tracking-tight" style={{ fontSize: '2.25rem', lineHeight: 1.1, color: text }}>{priceLabel}</span>
        {unit && <span className="text-sm" style={{ color: soft }}>{unit}</span>}
      </p>
      <p className="text-xs mt-1" style={{ color: soft }}>{note}</p>

      {action}

      <div className="mt-6 pt-5 flex-1" style={{ borderTop: `1px solid ${highlight ? 'rgba(255,255,255,0.14)' : 'var(--color-border)'}` }}>
        {featuresIntro && <p className="text-[13px] font-semibold mb-2.5" style={{ color: text }}>{featuresIntro}</p>}
        <ul className="space-y-2.5">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2.5 text-[13px] leading-snug" style={{ color: text }}>
              <Check className="h-4 w-4 mt-px shrink-0" aria-hidden style={{ color: highlight ? 'var(--color-primary)' : 'var(--color-text)' }} />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

function Cell({ value }: { value: ComparisonCell }) {
  if (value === true) return <><Check className="h-4 w-4 mx-auto" aria-hidden /><span className="sr-only">Compris</span></>
  if (value === false) return <><span aria-hidden style={muted}>—</span><span className="sr-only">Non compris</span></>
  return <>{value}</>
}

const HIGHLIGHT_COLUMN = 'color-mix(in srgb, var(--color-primary) 8%, transparent)'

export function Pricing({ userRole }: { userRole: UserRole | null }) {
  const tones: Record<PlanCard['id'], CtaTone> = { essai: 'outline', essentiel: 'accent', pro: 'dark' }
  return (
    <div className="mbc-app-dark" style={{ background: 'var(--color-background)' }}>
      <div style={{ background: 'var(--hero-bg)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.5rem', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            Une formule simple, pour recruter plus vite
          </h1>
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.75)' }}>Sans engagement, résiliable à tout moment.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <section aria-label="Formules" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 items-stretch">
          {PLAN_CARDS.map(card => (
            <PlanColumn key={card.id} name={card.name} tagline={card.tagline} priceLabel={card.priceLabel} unit={card.unit} note={card.note}
              featuresIntro={card.featuresIntro} features={card.features} highlight={card.highlight}
              action={planCta(card, userRole, tones[card.id])} />
          ))}
          <PlanColumn name={CUSTOM_PLAN_CARD.name} tagline={CUSTOM_PLAN_CARD.tagline} priceLabel={CUSTOM_PLAN_CARD.priceLabel}
            note={CUSTOM_PLAN_CARD.note} features={CUSTOM_PLAN_CARD.features} highlight={false}
            action={userRole === 'admin' ? ADMIN_NOTE : <Cta href={QUOTE_REQUEST_HREF} label="Demander un devis" tone="outline" />} />
        </section>

        <section aria-labelledby="compare-title" className="mt-14 lg:mt-16">
          <h2 id="compare-title" style={{ color: 'var(--color-text)', fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            Comparer les formules
          </h2>
          <p className="text-[13px] mt-1" style={muted}>
            <span className="hidden md:inline">Toutes les fonctions, formule par formule.</span>
            <span className="md:hidden">Faites glisser le tableau pour voir toutes les formules.</span>
          </p>
          {/* Défile de côté sur mobile ; la colonne « Fonction » reste en place. `relative` : les libellés pour lecteurs
              d'écran (sr-only, en position absolue) restent dans la zone qui défile au lieu d'élargir la page. */}
          <div className="relative mt-4 rounded-[20px] overflow-x-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <table className="w-full min-w-[640px] sm:min-w-[720px] text-[13px] border-collapse">
              <caption className="sr-only">Fonctions comprises dans chaque formule</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-36 sm:w-auto text-left font-medium text-xs px-3 sm:px-5 py-4" style={{ ...muted, background: 'var(--color-surface)' }}>Fonction</th>
                  {COMPARISON_COLUMNS.map(col => (
                    <th key={col.id} scope="col" className="px-3 sm:px-4 py-4 text-center" style={col.highlight ? { background: HIGHLIGHT_COLUMN } : undefined}>
                      <span className="block font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{col.name}</span>
                      <span className="block text-[11px] font-normal mt-0.5" style={muted}>{col.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map(row => (
                  <tr key={row.label} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <th scope="row" className="sticky left-0 z-10 w-36 sm:w-auto text-left font-normal px-3 sm:px-5 py-3.5" style={{ color: 'var(--color-text)', background: 'var(--color-surface)' }}>{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={COMPARISON_COLUMNS[i].id} className="px-3 sm:px-4 py-3.5 text-center" style={{ color: 'var(--color-text)', ...(COMPARISON_COLUMNS[i].highlight ? { background: HIGHLIGHT_COLUMN } : {}) }}>
                        <Cell value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="mt-14 lg:mt-16">
          <h2 id="faq-title" style={{ color: 'var(--color-text)', fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            Questions fréquentes
          </h2>
          <div className="mt-4 grid md:grid-cols-2 gap-x-10">
            {PRICING_FAQ.map(item => (
              <details key={item.question} className="group py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 cursor-pointer text-sm font-semibold rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={{ color: 'var(--color-text)' }}>
                  {item.question}
                  <Plus className="h-4 w-4 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden style={muted} />
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed" style={muted}>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="mt-14 mb-6 flex flex-col items-center gap-3 text-center">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs" style={muted}>
            <li className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Sans engagement, résiliable à tout moment</li>
            <li className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden />Paiement par carte sécurisé par Stripe</li>
            <li className="inline-flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" aria-hidden />{PRICES_NOTE}</li>
          </ul>
          <p className="text-[13px]" style={muted}>
            Une question avant de choisir ?{' '}
            <Link href="/contact" className="font-semibold no-underline hover:underline" style={{ color: PRIMARY_INK }}>Contactez-nous</Link>
          </p>
        </footer>
      </div>
    </div>
  )
}
