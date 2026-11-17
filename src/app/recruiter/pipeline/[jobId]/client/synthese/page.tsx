import type { CSSProperties, ReactNode } from 'react'
import { formatDateFr } from '@/lib/format-date'
import { PrintButton } from '@/app/recruiter/annonces/[jobId]/print-button'
import type { ClientSheet } from '@/lib/client-sheet'
import type { JobClient } from '@/lib/client-response'
import type { Job } from '@/types'
import { loadClientSheets } from '../data'

// Fiches candidats imprimables (« Enregistrer en PDF » du navigateur), une page par candidat envoyé au client (demande du
// 2026-11-17 : MBC n'envoie rien, le recruteur transmet ce document). ?ids= : candidatures à reprendre, parmi celles notées
// comme envoyées. Le candidat n'y figure que par ses initiales, sans coordonnées (client-sheet.ts).

const ID = /^[\w-]{1,36}$/
const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const text: CSSProperties = { color: 'var(--color-text)' }
const eyebrow = 'text-[11px] font-semibold uppercase tracking-widest'

export default async function ClientSynthesisPage({ params, searchParams }: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ ids?: string | string[] }>
}) {
  const [{ jobId }, { ids }] = await Promise.all([params, searchParams])
  const wanted = new Set((typeof ids === 'string' ? ids : '').split(',').filter(id => ID.test(id)).slice(0, 50))
  const { job, client, sheets } = await loadClientSheets(jobId, wanted)
  const today = formatDateFr(new Date().toISOString())

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="client-synthesis max-w-[820px] mx-auto px-4 sm:px-6 py-8">
        <div className="no-print flex items-center justify-between gap-4 mb-6">
          <div className="min-w-0">
            <p className={`${eyebrow} mb-1`} style={muted}>Fiches candidats pour le client</p>
            <p className="text-[13px]" style={muted}>
              {sheets.length > 1 ? `${sheets.length} fiches, une page chacune` : 'Une page'} : « Exporter en PDF » puis « Enregistrer au format PDF ».
            </p>
          </div>
          {sheets.length > 0 && <PrintButton />}
        </div>

        {sheets.length === 0 ? (
          <p className="text-sm" style={muted}>Aucun candidat envoyé au client ne correspond à ce lien.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {sheets.map(s => <CandidateSheet key={s.appId} job={job} client={client} sheet={s} today={today} />)}
          </div>
        )}
      </div>

      {/* À l'impression : seules les fiches restent, une par page A4, sans cadre. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body * { visibility: hidden; }
          .client-synthesis, .client-synthesis * { visibility: visible; }
          .client-synthesis { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; padding: 0 !important; }
          .client-sheet { border: 0 !important; border-radius: 0 !important; padding: 0 !important; break-after: page; }
          .client-sheet:last-child { break-after: auto; }
          .client-sheet section { break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-4 mt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
      <h2 className={`${eyebrow} mb-2`} style={muted}>{title}</h2>
      {children}
    </section>
  )
}

function CandidateSheet({ job, client, sheet: s, today }: { job: Job; client: JobClient | null; sheet: ClientSheet & { sentBy: string; sentOn: string }; today: string }) {
  // Destinataire : contact et société du client de l'offre (pas son e-mail : la fiche lui est remise).
  const recipient = client && [client.contactName, client.company].filter(Boolean).join(', ')
  const facts = [s.years ? `${s.years} ans d’expérience` : '', s.city].filter(Boolean).join(' · ')
  return (
    <article className="client-sheet rounded-2xl p-6 sm:p-8" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {s.warnings.length > 0 && (
        <p role="status" className="no-print mb-4 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: '#b4530914', color: '#b45309' }}>
          À vérifier avant de transmettre : le nom du candidat apparaît peut-être encore ({s.warnings.join(', ')}). Ce message n’est pas imprimé.
        </p>
      )}
      <header className="flex items-start justify-between gap-4 pb-4" style={{ borderBottom: '2px solid var(--color-primary)' }}>
        <div className="min-w-0">
          <p className={`${eyebrow} mb-1`} style={{ color: 'var(--color-primary)' }}>Proposition de candidat</p>
          <p className="text-sm font-semibold" style={text}>{job.title}</p>
          {(job.companyName || job.location) && <p className="text-[13px]" style={muted}>{[job.companyName, job.location].filter(Boolean).join(' · ')}</p>}
          {recipient && <p className="text-[13px] mt-1" style={text}>À l’attention de {recipient}</p>}
        </div>
        <p className="text-[12px] text-right shrink-0" style={muted}>{today}<br />Confidentiel</p>
      </header>

      <div className="flex items-start justify-between gap-4 pt-5">
        <div className="min-w-0">
          <h1 className="font-bold tracking-tight" style={{ ...text, fontSize: '1.75rem', lineHeight: 1.2 }}>{s.initials}</h1>
          {s.headline && <p className="text-[15px] font-semibold mt-1" style={text}>{s.headline}</p>}
          {facts && <p className="text-[13px] mt-0.5" style={muted}>{facts}</p>}
        </div>
        {s.fit && (
          <div className="shrink-0 rounded-xl px-4 py-2.5 text-center" style={{ background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)', color: 'var(--color-primary)' }}>
            <p className="font-bold tabular-nums leading-none" style={{ fontSize: 26 }}>{s.fit.score}<span className="text-[13px] font-semibold">/100</span></p>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide mt-1">Adéquation</p>
          </div>
        )}
      </div>

      {s.summary && (
        <Section title="Profil">
          <p className="text-[13.5px] leading-relaxed" style={text}>{s.summary}</p>
        </Section>
      )}

      {(s.skills.length > 0 || s.languages.length > 0) && (
        <section className="pt-4 mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]" style={{ borderTop: '1px solid var(--color-border)' }}>
          {s.skills.length > 0 && (
            <div>
              <h2 className={`${eyebrow} mb-2`} style={muted}>Compétences clés</h2>
              <ul className="flex flex-wrap gap-1.5">
                {s.skills.map(skill => (
                  <li key={skill} className="text-[12px] font-medium rounded-md px-2 py-0.5" style={{ ...text, background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>{skill}</li>
                ))}
              </ul>
            </div>
          )}
          {s.languages.length > 0 && (
            <div>
              <h2 className={`${eyebrow} mb-2`} style={muted}>Langues</h2>
              <ul className="text-[13px] flex flex-col gap-0.5" style={text}>{s.languages.map(l => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {s.experiences.length > 0 && (
        <Section title="Parcours">
          <ul className="flex flex-col gap-1.5">
            {s.experiences.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="min-w-0" style={text}><span className="font-semibold">{e.title || 'Poste'}</span>{e.company && <span style={muted}> · {e.company}</span>}</span>
                {e.period && <span className="shrink-0 tabular-nums text-[12px]" style={muted}>{e.period}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {s.education.length > 0 && (
        <Section title="Formation">
          <ul className="flex flex-col gap-1.5">
            {s.education.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="min-w-0" style={text}><span className="font-semibold">{e.degree || 'Formation'}</span>{e.school && <span style={muted}> · {e.school}</span>}</span>
                {e.year && <span className="shrink-0 tabular-nums text-[12px]" style={muted}>{e.year}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {s.fit && (s.fit.parts.length > 0 || s.fit.opinion) && (
        <Section title="Adéquation au poste">
          {s.fit.parts.length > 0 && (
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 mb-3">
              {s.fit.parts.map(p => (
                <li key={p.label} className="flex items-center gap-2.5 text-[12.5px]" style={text}>
                  <span className="w-28 shrink-0 truncate">{p.label}</span>
                  <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 8%, transparent)' }} aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${p.percent}%`, background: 'var(--color-primary)' }} />
                  </span>
                  <span className="w-9 text-right tabular-nums" style={muted}>{p.percent} %</span>
                </li>
              ))}
            </ul>
          )}
          {s.fit.opinion && <p className="text-[13px] leading-relaxed" style={text}>{s.fit.opinion}</p>}
        </Section>
      )}

      {s.steps.length > 0 && (
        <Section title="Avis du cabinet">
          <ol className="flex flex-col gap-3">
            {s.steps.map(step => (
              <li key={step.id}>
                <p className="text-[12px] font-semibold" style={text}>{step.label}{step.validatedAt ? <span className="font-normal" style={muted}> · {formatDateFr(step.validatedAt)}</span> : null}</p>
                <p className="text-[13px] leading-relaxed whitespace-pre-line" style={text}>{step.report}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <footer className="pt-4 mt-5 text-[12px]" style={{ ...muted, borderTop: '1px solid var(--color-border)' }}>
        Votre interlocuteur : <span className="font-semibold" style={text}>{s.sentBy}</span>{s.sentOn ? `, candidature proposée le ${s.sentOn}` : ''}.
        Les coordonnées du candidat sont communiquées par le cabinet.
      </footer>
    </article>
  )
}
