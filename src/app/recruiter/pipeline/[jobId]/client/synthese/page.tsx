import { formatDateFr } from '@/lib/format-date'
import { PrintButton } from '@/app/recruiter/annonces/[jobId]/print-button'
import { loadClientRows } from '../data'

// Synthèse imprimable (« Enregistrer en PDF » du navigateur) des candidats envoyés au client (demande du 2026-11-17 : MBC
// n'envoie rien, le recruteur transmet ce document). ?ids= : candidatures à reprendre, parmi celles notées comme envoyées.
// Ne montre que le nom et les comptes rendus envoyés : ni score, ni coordonnées.

const ID = /^[\w-]{1,36}$/

export default async function ClientSynthesisPage({ params, searchParams }: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ ids?: string | string[] }>
}) {
  const [{ jobId }, { ids }] = await Promise.all([params, searchParams])
  const wanted = new Set((typeof ids === 'string' ? ids : '').split(',').filter(id => ID.test(id)).slice(0, 50))
  const { job, rows } = await loadClientRows(jobId)
  const shown = rows.filter(r => r.submission && wanted.has(r.appId))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="client-synthesis max-w-[820px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Sélection de candidats</p>
            <h1 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.5rem', lineHeight: 1.3 }}>{job.title}</h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {[job.companyName, job.location, `Synthèse du ${formatDateFr(new Date().toISOString())}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          {shown.length > 0 && <PrintButton />}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun candidat envoyé au client ne correspond à ce lien.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {shown.map(r => (
              <article key={r.appId} className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', breakInside: 'avoid' }}>
                <h2 className="font-bold mb-3" style={{ color: 'var(--color-text)', fontSize: '1.1rem' }}>{r.name}</h2>
                <ol className="flex flex-col gap-3">
                  {r.steps.map(s => (
                    <li key={s.id}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {s.label}{s.validatedBy ? ` · ${s.validatedBy}` : ''}{s.validatedAt ? ` · ${formatDateFr(s.validatedAt)}` : ''}
                      </p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{s.report}</p>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* À l'impression, seule la synthèse reste (le menu et les barres de l'espace recruteur sont masqués). */}
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body * { visibility: hidden; }
          .client-synthesis, .client-synthesis * { visibility: visible; }
          .client-synthesis { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}
