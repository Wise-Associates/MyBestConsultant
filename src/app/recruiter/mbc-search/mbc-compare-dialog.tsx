// Composant client : importé seulement par mbc-search-client.tsx (« use client »), qui en fait du code navigateur.
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FOLLOW_STATUSES, type MbcFollow } from '@/lib/mbc-search/follow'
import type { MbcEvaluation } from '@/lib/mbc-search/evaluation'
import type { MbcRevealed, ScoredProfile } from '@/lib/mbc-search/rules'

// « Comparer » (ADR 0039, phase 3) : 2 ou 3 personnes de la sélection côte à côte — données d'Apollo, évaluation par
// l'IA si elle a été faite pendant la visite, suivi du recruteur. Affichage seulement : rien n'est demandé au serveur.

export interface ComparedPerson {
  profile: ScoredProfile
  full: MbcRevealed
  evaluation?: MbcEvaluation
  follow?: MbcFollow
}

const muted = { color: 'var(--color-text-muted)' }
const dash = <span style={muted}>—</span>

export function CompareDialog({ people, open, onClose }: { people: ComparedPerson[]; open: boolean; onClose: () => void }) {
  // Critères évalués communs à toutes les personnes évaluées, dans l'ordre du barème.
  const evaluated = people.filter(p => p.evaluation)
  const parts = evaluated[0]?.evaluation?.parts.filter(part => !part.unavailable) ?? []
  const rows: { label: string; cell: (p: ComparedPerson) => React.ReactNode }[] = [
    { label: 'Poste actuel', cell: p => p.full.title || p.profile.title || dash },
    { label: 'Employeur', cell: p => [p.full.company, p.full.industry].filter(Boolean).join(' · ') || dash },
    { label: 'Lieu', cell: p => p.full.location || dash },
    { label: 'Séniorité (Apollo)', cell: p => p.full.seniority || dash },
    { label: 'Score de classement', cell: p => `${p.profile.score} / 100` },
    { label: 'Score IA', cell: p => (p.evaluation ? <strong>{p.evaluation.score} / 100</strong> : <span style={muted}>Non évalué</span>) },
    ...parts.map(part => ({
      label: part.label,
      cell: (p: ComparedPerson) => {
        const own = p.evaluation?.parts.find(x => x.key === part.key)
        return own ? <span title={own.detail}>{Math.round(own.points)} / {Math.round(own.max)}</span> : dash
      },
    })),
    { label: 'Non visible', cell: p => (p.evaluation ? (p.evaluation.missing.join(', ') || 'Rien') : dash) },
    { label: 'Parcours récent', cell: p => (p.full.experiences.length > 0
      ? <ul className="space-y-0.5">{p.full.experiences.slice(0, 3).map((e, i) => <li key={i}>{[e.title, e.company].filter(Boolean).join(' · ')}</li>)}</ul>
      : dash) },
    { label: 'Suivi', cell: p => (p.follow ? FOLLOW_STATUSES[p.follow.status] : dash) },
    { label: 'Étiquettes', cell: p => (p.follow && p.follow.tags.length > 0 ? p.follow.tags.join(', ') : dash) },
  ]
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 700 }}>Comparer {people.length} personnes</DialogTitle>
          <DialogDescription style={muted}>
            Données d’Apollo, puis l’évaluation de l’IA quand elle a été faite pendant cette visite (barème du matching, vos poids).
          </DialogDescription>
        </DialogHeader>
        {/* Défilement horizontal dans la fenêtre seulement, sur petit écran. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-xs border-collapse">
            <thead>
              <tr>
                <th scope="col" className="sr-only">Critère</th>
                {people.map(p => (
                  <th key={p.full.id} scope="col" className="text-left align-bottom p-2 text-sm font-bold" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {p.full.name || [p.profile.firstName, p.profile.lastNameMasked].filter(Boolean).join(' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <th scope="row" className="text-left align-top p-2 font-semibold whitespace-nowrap" style={{ ...muted, borderBottom: '1px solid var(--color-border)' }}>{r.label}</th>
                  {people.map(p => (
                    <td key={p.full.id} className="align-top p-2" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.cell(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evaluated.length < people.length && (
          <p className="text-[11px]" style={muted}>Évaluez les personnes depuis leur panneau pour comparer aussi leur score IA et ses critères.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
