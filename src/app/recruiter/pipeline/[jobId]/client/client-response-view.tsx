'use client'

import { useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, Check, FileText, Loader2, Mail, Pencil, Printer, Send, ThumbsUp, X } from 'lucide-react'
import { BackLink } from '@/components/recruiter/back-link'
import { JobHeaderGrid, JobTabs } from '@/components/recruiter/job-tabs'
import { JobInfoButton } from '@/components/recruiter/job-info-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CLIENT_LIMITS, CLIENT_RESPONSE_LABEL, clientMailto, type ClientAnswer, type ClientResponse, type JobClient } from '@/lib/client-response'
import { recordClientResponseAction, saveJobClientAction, sendToClientAction } from './actions'
import type { ClientRow, ClientState } from './data'
import { EsnExportDialog } from '@/components/cv-export/esn-export-dialog'
import { getRecruiterCvExportVersions } from '@/app/recruiter/cvtheque/actions'
import type { CvExportAccess } from '@/lib/cv-export/recruiter'

// Écran de l'onglet « Réponse client » (maquette du 2026-11-17) : candidats envoyés au client à gauche, comptes rendus envoyés
// et réponse du candidat choisi à droite ; « Envoyer une sélection au client » note un envoi et donne les fiches à imprimer.

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const card = 'rounded-[20px]'
const cardStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const headingStyle: CSSProperties = { ...muted, fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }
const button = 'h-10 px-3.5 rounded-[10px] inline-flex items-center justify-center gap-2 text-[13px] font-semibold no-underline cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'
const RESPONSE_STYLE: Record<ClientResponse, CSSProperties> = {
  pending: { background: '#b4530914', color: '#b45309' },
  interview: { background: '#04785714', color: '#047857' },
  rejected: { background: '#b91c1c12', color: '#b91c1c' },
  retained: { background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' },
}
const ANSWERS: { value: ClientAnswer; label: string; Icon: typeof Check }[] = [
  { value: 'interview', label: 'Entretien', Icon: Check },
  { value: 'rejected', label: 'Refusé', Icon: X },
  { value: 'retained', label: 'Retenu', Icon: ThumbsUp },
]

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const synthesisHref = (jobId: string, ids: string[]) => `/recruiter/pipeline/${jobId}/client/synthese?ids=${ids.join(',')}`

function ResponseBadge({ response }: { response: ClientResponse }) {
  return <span className="inline-flex text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap" style={RESPONSE_STYLE[response]}>{CLIENT_RESPONSE_LABEL[response]}</span>
}

export function ClientResponseView({ jobId, jobTitle, jobMeta, rows, cvExport, client: initialClient }: {
  jobId: string; jobTitle: string; jobMeta: string; rows: ClientRow[]
  /** Export « CV format cabinet » de l'organisation ; null : indisponible (stockage non configuré ou état illisible). */
  cvExport: CvExportAccess | null
  /** Client de l'offre (société, contact, e-mail). */
  client: ClientState
}) {
  const [client, setClient] = useState(initialClient)
  const known = client && typeof client === 'object' ? client : null
  const router = useRouter()
  const sent = rows.filter(r => r.submission).sort((a, b) => b.submission!.sentAt.localeCompare(a.submission!.sentAt))
  // Tout candidat du funnel pas encore envoyé, sauf refusé (choix du 2026-11-17).
  const eligible = rows.filter(r => !r.submission && !r.rejected && !r.shared)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = sent.find(r => r.appId === selectedId) ?? sent[0] ?? null
  const [sendOpen, setSendOpen] = useState(false)
  const [exportFor, setExportFor] = useState<ClientRow | null>(null)
  const [notice, setNotice] = useState<{ text: string; ids?: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 pt-4">
          <JobHeaderGrid
            back={<BackLink fallbackHref={`/recruiter/offres/${jobId}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold mb-2 no-underline transition-opacity hover:opacity-80"
              style={{ color: 'var(--hero-fg-muted)' }} />}
            main={<>
              <h1 className="sr-only">{jobTitle}</h1>
              <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                <JobInfoButton view="Réponse client" title={jobTitle} meta={jobMeta} />
                <button type="button" onClick={() => { setError(null); setSendOpen(true) }} className={button}
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }}>
                  <Send className="h-4 w-4" aria-hidden />Envoyer une sélection au client
                </button>
              </div>
            </>}
            tabs={<JobTabs jobId={jobId} current="client" counts={{ funnel: rows.length, client: sent.length }} />} />
        </div>
      </div>

      <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 flex flex-col gap-4">
        {(notice || error) && (
          <p role={error ? 'alert' : 'status'} className="flex items-center gap-2 flex-wrap px-4 py-2.5 rounded-xl text-[13px]"
            style={error ? { background: '#b91c1c12', color: '#b91c1c' } : { background: '#04785714', color: '#047857' }}>
            <span>{error ?? notice?.text}</span>
            {!error && notice?.ids && notice.ids.length > 0 && (
              <a href={synthesisHref(jobId, notice.ids)} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2" style={{ color: 'inherit' }}>
                Imprimer {notice.ids.length > 1 ? 'leurs fiches' : 'sa fiche'} (PDF)<span className="sr-only"> (nouvel onglet)</span>
              </a>
            )}
            {!error && notice?.ids && notice.ids.length > 0 && known && clientMailto(known, jobTitle, notice.ids.length) && (
              <a href={clientMailto(known, jobTitle, notice.ids.length)!} className="font-semibold underline underline-offset-2" style={{ color: 'inherit' }}>
                puis écrire à {known.contactName || known.email}<span className="sr-only"> (ouvre votre messagerie)</span>
              </a>
            )}
          </p>
        )}

        <ClientCard jobId={jobId} jobTitle={jobTitle} client={client} onSaved={setClient} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] min-[90rem]:grid-cols-[minmax(0,1fr)_440px] items-start">
          <section aria-labelledby="envoyes" className={card} style={cardStyle}>
            <div className="flex items-center gap-2.5 px-5 sm:px-6 py-4">
              <h2 id="envoyes" className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Candidats envoyés au client</h2>
              <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 tabular-nums" style={{ background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' }}>{sent.length}</span>
            </div>
            {sent.length === 0 ? (
              <p className="px-5 sm:px-6 pb-6 text-[13px]" style={muted}>
                Aucun candidat envoyé pour l’instant. « Envoyer une sélection au client » propose les candidats du funnel, sauf ceux refusés
                {eligible.length > 0 ? ` (${plural(eligible.length, 'candidat', 'candidats')}).` : ' : aucun pour l’instant.'}
              </p>
            ) : (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Candidats envoyés au client : choisissez une ligne pour voir sa synthèse et enregistrer la réponse</caption>
                <thead>
                  <tr className="text-xs" style={{ ...muted, background: 'color-mix(in srgb, var(--color-text) 2.5%, transparent)', borderTop: '1px solid var(--color-border)' }}>
                    <th scope="col" className="py-2.5 pl-5 sm:pl-6 pr-3 font-semibold">Candidat</th>
                    <th scope="col" className="hidden sm:table-cell py-2.5 px-3 font-semibold">Envoyé le</th>
                    <th scope="col" className="py-2.5 px-3 font-semibold">Réponse du client</th>
                    <th scope="col" className="hidden md:table-cell py-2.5 pl-3 pr-6 font-semibold">Commentaire du client</th>
                  </tr>
                </thead>
                <tbody>
                  {sent.map(r => {
                    const on = selected?.appId === r.appId
                    return (
                      <tr key={r.appId} onClick={() => setSelectedId(r.appId)} aria-selected={on} className="cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_2.5%,transparent)]"
                        style={{ borderTop: '1px solid var(--color-border)', background: on ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : undefined, boxShadow: on ? 'inset 3px 0 0 var(--color-primary)' : undefined }}>
                        <td className="py-3 pl-5 sm:pl-6 pr-3 min-w-0">
                          <button type="button" onClick={e => { e.stopPropagation(); setSelectedId(r.appId) }}
                            className="block text-left text-sm font-semibold bg-transparent border-0 p-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                            style={{ color: 'var(--color-text)' }}>{r.name}</button>
                          <p className="text-xs" style={muted}>
                            {r.score !== undefined && <>Score {r.score} · </>}{plural(r.steps.length, 'compte rendu', 'comptes rendus')}
                          </p>
                        </td>
                        <td className="hidden sm:table-cell py-3 px-3 text-[13px] whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{r.sentOn}</td>
                        <td className="py-3 px-3"><ResponseBadge response={r.submission!.response} /></td>
                        <td className="hidden md:table-cell py-3 pl-3 pr-6 text-[13px]" style={{ color: r.submission!.comment ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                          {r.submission!.comment ? `« ${r.submission!.comment} »` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>

          {selected && (
            <ClientPanel key={`${selected.appId}-${selected.submission!.response}-${selected.submission!.respondedAt ?? ''}`} jobId={jobId} row={selected}
              cabinetCv={!selected.hunterProfile && cvExport ? (cvExport.template ? () => setExportFor(selected) : 'setup') : undefined}
              onDone={(text, failed) => {
                if (failed) { setError(text); setNotice(null); return }
                setError(null)
                setNotice({ text })
                router.refresh()
              }} />
          )}
        </div>
      </div>

      {cvExport?.template && (
        // key : choix et compte rendu remis à zéro pour chaque candidat
        <EsnExportDialog key={exportFor?.appId ?? 'none'} candidate={exportFor && { id: exportFor.candidateId, name: exportFor.name }}
          onClose={() => setExportFor(null)} endpoint="/api/recruiter/cv-export" loadVersions={getRecruiterCvExportVersions}
          esn={cvExport.template.esn} generationDenied={cvExport.generationDenied} quotaLimited />
      )}

      <SendDialog open={sendOpen} jobId={jobId} eligible={eligible} client={known} rejected={rows.filter(r => !r.submission && r.rejected).length}
        onClose={() => setSendOpen(false)}
        onSent={(ids, refused) => {
          setSendOpen(false)
          setError(null)
          setNotice({
            text: `${plural(ids.length, 'candidat noté', 'candidats notés')} comme envoyé${ids.length > 1 ? 's' : ''} au client.${refused.length ? ` ${plural(refused.length, 'autre refusé', 'autres refusés')} : ${refused[0]}.` : ''}`,
            ids,
          })
          if (ids[0]) setSelectedId(ids[0])
          router.refresh()
        }} />
    </div>
  )
}

/** Documents pour le client (fiche, CV format cabinet), comptes rendus envoyés et réponse du client du candidat choisi. */
function ClientPanel({ jobId, row, cabinetCv, onDone }: {
  jobId: string; row: ClientRow
  /** « CV format cabinet » : ouvre l'export ; 'setup' : modèle du cabinet à déposer d'abord (CV Thèque) ; absent : indisponible. */
  cabinetCv?: (() => void) | 'setup'
  onDone: (text: string, failed?: boolean) => void
}) {
  const submission = row.submission!
  const [comment, setComment] = useState(submission.comment ?? '')
  const [pending, start] = useTransition()

  function record(response: ClientAnswer) {
    if (response === 'retained' && !window.confirm(`${row.name} sera noté comme retenu par le client et passera dans « Embauchés ». Continuer ?`)) return
    start(async () => {
      const res = await recordClientResponseAction({ jobId, applicationId: row.appId, response, comment })
        .catch(() => ({ error: 'La réponse n’a pas pu être enregistrée. Réessayez.' }))
      if ('error' in res) { onDone(res.error, true); return }
      onDone(res.column ? `${row.name} : retenu par le client, passé dans « Embauchés ».` : `Réponse du client enregistrée pour ${row.name}.`)
    })
  }

  return (
    <aside aria-label={`Réponse client de ${row.name}`} className={`${card} p-5 flex flex-col gap-4 lg:sticky lg:top-[84px]`} style={cardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold truncate" style={{ color: 'var(--color-text)', fontSize: 17, lineHeight: 1.35 }}>{row.name}</h2>
          <p className="text-xs" style={muted}>{row.stageLabel} · envoyé le {row.sentOn}</p>
        </div>
        <ResponseBadge response={submission.response} />
      </div>

      {/* Documents à transmettre au client : la fiche (PDF) et le CV dans le modèle Word du cabinet. */}
      <div className="flex flex-wrap gap-2">
        <a href={synthesisHref(jobId, [row.appId])} target="_blank" rel="noopener noreferrer" className={button}
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <Printer className="h-4 w-4" aria-hidden />Fiche PDF<span className="sr-only"> : imprimer la fiche de {row.name} (nouvel onglet)</span>
        </a>
        {cabinetCv === 'setup' ? (
          <Link href="/recruiter/cvtheque" className={button} title="Déposez d’abord le modèle Word de votre cabinet dans la CV Thèque"
            style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)', color: 'var(--color-text)' }}>
            <FileText className="h-4 w-4" aria-hidden />CV format cabinet : déposer le modèle
          </Link>
        ) : cabinetCv && (
          <button type="button" onClick={cabinetCv} className={button}
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <FileText className="h-4 w-4" aria-hidden />CV format cabinet
          </button>
        )}
      </div>

      <section aria-labelledby="synthese">
        <h3 id="synthese" className="font-semibold uppercase mb-2" style={headingStyle}>Comptes rendus envoyés</h3>
        {row.steps.length === 0 && <p className="text-[13px]" style={muted}>Aucun compte rendu envoyé : la fiche présente le profil, le parcours et l’adéquation au poste.</p>}
        <ol className="flex flex-col gap-3 pl-3" style={{ borderLeft: '2px solid var(--color-border)' }} hidden={row.steps.length === 0}>
          {row.steps.map(s => (
            <li key={s.id}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={muted}>{s.label}{s.validatedBy ? ` · ${s.validatedBy}` : ''}</p>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{s.report}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="reponse" className="flex flex-col gap-2.5">
        <h3 id="reponse" className="font-semibold uppercase" style={headingStyle}>Enregistrer la réponse du client</h3>
        <div role="group" aria-label="Réponse du client" className="grid grid-cols-3 gap-2">
          {ANSWERS.map(({ value, label, Icon }) => {
            const on = submission.response === value
            return (
              <button key={value} type="button" aria-pressed={on} disabled={pending} onClick={() => record(value)} className={button}
                style={on ? { ...RESPONSE_STYLE[value], border: '1.5px solid currentColor' } : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}{label}
              </button>
            )
          })}
        </div>
        <label className="flex flex-col gap-1">
          <span className="sr-only">Commentaire du client (facultatif)</span>
          <input type="text" value={comment} onChange={e => setComment(e.target.value)} maxLength={CLIENT_LIMITS.comment}
            placeholder="Commentaire du client (facultatif)"
            className="h-10 px-3 rounded-[10px] text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </label>
        <p className="text-[11px]" style={muted}>Le commentaire est enregistré avec la réponse choisie. « Retenu » fait passer le candidat dans « Embauchés ».</p>
      </section>
    </aside>
  )
}

/** Choix des candidats à envoyer : ceux du funnel pas encore envoyés, sauf refusés. */
function SendDialog({ open, jobId, eligible, client, rejected, onClose, onSent }: {
  open: boolean; jobId: string; eligible: ClientRow[]
  client: JobClient | null
  /** Candidats refusés, jamais proposés. */
  rejected: number
  onClose: () => void
  onSent: (ids: string[], refused: string[]) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  function send() {
    const ids = eligible.filter(r => checked.has(r.appId)).map(r => r.appId)
    if (ids.length === 0) return
    setError(null)
    start(async () => {
      const res = await sendToClientAction({ jobId, applicationIds: ids }).catch(() => ({ error: 'L’envoi n’a pas pu être enregistré. Réessayez.' }))
      if ('error' in res) { setError(res.error); return }
      setChecked(new Set())
      onSent(res.sent, res.refused)
    })
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !pending) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 700 }}>Envoyer une sélection au client</DialogTitle>
          <DialogDescription style={muted}>
            MBC note l’envoi et prépare la fiche de chaque candidat (initiales, sans coordonnées : profil, parcours, adéquation au poste et comptes rendus validés), à imprimer en PDF et à transmettre au client.
            {client && ` Destinataire : ${[client.contactName, client.company].filter(Boolean).join(', ')}${client.email ? ` (${client.email})` : ''}.`}
          </DialogDescription>
        </DialogHeader>
        {eligible.length === 0 ? (
          <p className="text-[13px]" style={muted}>Aucun candidat à proposer : tous ceux du funnel ont déjà été envoyés ou sont refusés.</p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Candidats à envoyer</legend>
            {eligible.map(r => (
              <label key={r.appId} className="flex items-center gap-3 min-h-12 px-2.5 rounded-xl cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]">
                <input type="checkbox" checked={checked.has(r.appId)} onChange={() => toggle(r.appId)} className="h-4 w-4 shrink-0 accent-(--color-primary)" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{r.name}</span>
                  <span className="block text-xs" style={muted}>
                    {r.stageLabel}{r.score !== undefined ? ` · score ${r.score}` : ''} · {r.steps.length ? plural(r.steps.length, 'compte rendu', 'comptes rendus') : 'aucun compte rendu'}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {rejected > 0 && (
          <p className="text-xs" style={muted}>{plural(rejected, 'candidat refusé n’est pas proposé', 'candidats refusés ne sont pas proposés')}.</p>
        )}
        {error && <p role="alert" className="text-[13px]" style={{ color: '#b91c1c' }}>{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={pending} className={button} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Annuler</button>
          <button type="button" onClick={send} disabled={pending || checked.size === 0} className={button}
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Envoyer {checked.size > 0 ? plural(checked.size, 'candidat', 'candidats') : ''}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const EMPTY_CLIENT: JobClient = { company: '', contactName: '', email: '' }
const fieldStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const secondary: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

/** Client de l'offre (demande du 2026-11-17) : société, contact et e-mail, renseignés une fois ; « Écrire au client » ouvre la messagerie du recruteur. */
function ClientCard({ jobId, jobTitle, client, onSaved }: {
  jobId: string; jobTitle: string; client: ClientState; onSaved: (client: JobClient | null) => void
}) {
  const known = client && typeof client === 'object' ? client : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<JobClient>(known ?? EMPTY_CLIENT)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const mailto = known && clientMailto(known, jobTitle, 0)

  function save() {
    setError(null)
    start(async () => {
      const res = await saveJobClientAction({ jobId, client: draft }).catch(() => ({ error: 'Le client n’a pas pu être enregistré. Réessayez.' }))
      if ('error' in res) { setError(res.error); return }
      const empty = !res.client.company && !res.client.contactName && !res.client.email
      onSaved(empty ? null : res.client)
      setEditing(false)
    })
  }

  if (client === 'off' || client === 'unavailable') {
    return (
      <p className="text-[13px] px-1" style={muted}>
        <Building2 className="inline h-4 w-4 mr-1.5 -mt-0.5" aria-hidden />
        {client === 'off' ? 'Client de l’offre : pas encore activé (mise à jour de la base à faire).' : 'Client de l’offre momentanément illisible : rechargez la page.'}
      </p>
    )
  }

  return (
    <section aria-labelledby="client-offre" className={`${card} px-5 sm:px-6 py-4`} style={cardStyle}>
      {!editing ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex items-start gap-3">
            <Building2 className="h-5 w-5 mt-0.5 shrink-0" style={muted} aria-hidden />
            <div className="min-w-0">
              <h2 id="client-offre" className="font-semibold uppercase" style={headingStyle}>Client de l’offre</h2>
              {known ? (
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  <span className="font-semibold">{known.company || 'Société non renseignée'}</span>
                  {known.contactName && <> · {known.contactName}</>}
                  {known.email && <span style={muted}> · {known.email}</span>}
                </p>
              ) : (
                <p className="text-[13px]" style={muted}>Aucun client renseigné : indiquez à qui les fiches sont destinées.</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {mailto && (
              <a href={mailto} className={button} style={secondary}>
                <Mail className="h-4 w-4" aria-hidden />Écrire au client<span className="sr-only"> (ouvre votre messagerie)</span>
              </a>
            )}
            <button type="button" onClick={() => { setDraft(known ?? EMPTY_CLIENT); setError(null); setEditing(true) }} className={button} style={secondary}>
              <Pencil className="h-4 w-4" aria-hidden />{known ? 'Modifier' : 'Renseigner le client'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); save() }} className="flex flex-col gap-3">
          <h2 id="client-offre" className="font-semibold uppercase" style={headingStyle}>Client de l’offre</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ['company', 'Société', 200, 'organization', 'text'],
              ['contactName', 'Nom du contact', 120, 'name', 'text'],
              ['email', 'E-mail du contact', 254, 'email', 'email'],
            ] as const).map(([key, label, max, autoComplete, type]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs font-semibold" style={muted}>{label}</span>
                <input type={type} value={draft[key]} maxLength={max} autoComplete={autoComplete} disabled={pending}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                  className="h-10 px-3 rounded-[10px] text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)" style={fieldStyle} />
              </label>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px]" style={{ color: '#b91c1c' }}>{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={button} style={secondary}>Annuler</button>
            <button type="submit" disabled={pending} className={button} style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}Enregistrer
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
