import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listProposals } from '@/lib/hunter'
import { proposalStatus } from '@/lib/hunter-match'
import { HunterShell } from '../hunter-shell'

export default async function HunterProposalsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')
  const proposals = await listProposals(user.userId)

  return (
    <HunterShell title="Mes propositions" subtitle="Où en sont les profils que vous avez proposés">
      {proposals.length === 0 ? (
        <div className="rounded-3xl p-12 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Vous n’avez encore proposé aucun profil.</p>
          <Link href="/hunter/offres" className="inline-block mt-3 text-sm font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Parcourir les offres →</Link>
        </div>
      ) : (
        <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 680 }}>
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', background: 'rgba(11,29,81,0.03)' }}>
                  <th className="text-left font-semibold px-5 py-3">Profil</th>
                  <th className="text-left font-semibold px-3 py-3">Offre</th>
                  <th className="text-left font-semibold px-3 py-3">Statut</th>
                  <th className="text-left font-semibold px-3 py-3">Score IA</th>
                  <th className="text-right font-semibold px-5 py-3">Envoyé le</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => {
                  const st = proposalStatus(p.status)
                  return (
                    <tr key={p.applicationId} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-5 py-3.5"><p className="font-semibold" style={{ color: 'var(--color-text)' }}>{p.profileName}</p>{p.profileTitle && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{p.profileTitle}</p>}</td>
                      <td className="px-3 py-3.5"><Link href={`/jobs/${p.jobId}`} target="_blank" className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-text)' }}>{p.jobTitle}</Link>{p.company && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{p.company}</p>}</td>
                      <td className="px-3 py-3.5"><span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${st.color}1f`, color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span></td>
                      <td className="px-3 py-3.5 font-bold" style={{ color: p.aiScore === null ? 'var(--color-text-muted)' : p.aiScore >= 70 ? '#059669' : p.aiScore >= 50 ? '#b8862f' : '#dc2626' }}>{p.aiScore ?? '—'}</td>
                      <td className="px-5 py-3.5 text-right text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </HunterShell>
  )
}
