import type { CSSProperties } from 'react'
import type { AoContract, AoOfferStatus, AoRemote } from '@/lib/ao/types'

// Libellés et styles partagés par la liste et le panneau de détail AO Offers.

/** Orange de la marque (AGENTS.md) : actions principales et offres à valider. */
export const BRAND = '#F97316'

export const STATUS_UI: Record<AoOfferStatus, { label: string; color: string }> = {
  to_review: { label: 'À valider', color: BRAND },
  published: { label: 'Publiée', color: '#34d399' },
  ignored: { label: 'Ignorée', color: 'rgba(255,255,255,0.4)' },
}

export const CONTRACT_LABEL: Record<AoContract, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
export const REMOTE_LABEL: Record<AoRemote, string> = { onsite: 'Sur site', hybrid: 'Hybride', remote: 'Télétravail' }

/** TJM pour les missions et le freelance, salaire annuel pour les CDI/CDD (comme l'import d'offres). */
export function formatAmount(salary: number | null, contract: AoContract): string {
  if (salary === null) return '—'
  return `${salary.toLocaleString('fr-FR')} €${contract === 'cdi' || contract === 'cdd' ? '/an' : '/j'}`
}

/** JJ/MM/AAAA sans dépendre du fuseau du navigateur (même rendu côté serveur et client). */
export const formatDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export const fieldLabel: CSSProperties = { fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }
export const control: CSSProperties = { height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', padding: '0 12px', fontSize: 13, outline: 'none' }
export const optionStyle: CSSProperties = { background: '#0a0c10' }
export const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: BRAND, border: `1px solid ${BRAND}`, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
export const secondaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500, cursor: 'pointer', textDecoration: 'none' }
