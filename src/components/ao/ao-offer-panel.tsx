'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { AlertTriangle, Ban, Check, Copy, Download, ExternalLink, Loader2, Paperclip, RotateCcw, Send, Users, X } from 'lucide-react'
import { AO_CHANNEL_LABEL, type AoOfferRow } from '@/lib/ao/filters'
import type {
  AoDashboardActions, AoDashboardPaths, PublicationDraft, PublicationPreview, SourcedCandidate, SourcingResult,
} from '@/lib/ao/dashboard-types'
import type { AoContract, AoRemote } from '@/lib/ao/types'
import { AoDescription } from './ao-description'
import {
  CONTRACT_LABEL, ENGAGEMENT_LABEL, REMOTE_LABEL, STATUS_UI, control, fieldLabel, formatAmount, formatDay, optionStyle, primaryButton, secondaryButton,
} from '@/app/admin/candidats/labels'

interface Props {
  row: AoOfferRow
  actions: Pick<AoDashboardActions, 'previewPublication' | 'publish' | 'setStatus' | 'sourcing'>
  paths: Pick<AoDashboardPaths, 'originalApi' | 'jobs'>
  /** Sous le formulaire de publication : ce que la publication déclenche dans cet espace. */
  publishNote: string
  onClose: () => void
}

export function AoOfferPanel({ row, actions, paths, publishNote, onClose }: Props) {
  const [preview, setPreview] = useState<PublicationPreview | null>(null)
  const [draft, setDraft] = useState<PublicationDraft | null>(null)
  const [skillsText, setSkillsText] = useState('')
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | null>(row.jobId)
  const [pending, start] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function prepare() {
    setError('')
    start(async () => {
      const res = await actions.previewPublication(row.$id)
      if (!res.preview) return setError(res.error ?? 'Aperçu impossible.')
      setPreview(res.preview)
      setDraft(res.preview.draft)
      setSkillsText(res.preview.draft.skills.join(', '))
    })
  }

  function publish() {
    if (!draft) return
    setError('')
    start(async () => {
      const skills = skillsText.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
      const res = await actions.publish(row.$id, { ...draft, skills })
      if (!res.jobId) return setError(res.error ?? 'Publication impossible.')
      setJobId(res.jobId)
      setDraft(null)
    })
  }

  function changeStatus(status: 'to_review' | 'ignored') {
    setError('')
    start(async () => {
      const res = await actions.setStatus(row.$id, status)
      if (res.error) setError(res.error)
    })
  }

  const edit = <K extends keyof PublicationDraft>(key: K, value: PublicationDraft[K]) => setDraft(d => (d ? { ...d, [key]: value } : d))
  const published = row.status === 'published' || jobId !== null
  const facts: [string, string][] = [
    ['Client', row.companyName || 'Non précisé'],
    ['Ville', row.location || '—'],
    ['Contrat', CONTRACT_LABEL[row.contractType]],
    ['Assistance / Forfait', ENGAGEMENT_LABEL[row.engagement]],
    ['Télétravail', REMOTE_LABEL[row.remote]],
    ['TJM / salaire', formatAmount(row.salary, row.contractType)],
    ['Durée', row.duration || '—'],
    ['Démarrage', row.startDate || '—'],
    ['Expérience', row.experience || '—'],
    ['Date limite', row.deadline || '—'],
  ]

  return (
    // Au-dessus de la barre de navigation fixe de l'espace recruteur (z-index 9000, site-navbar-client.tsx), qui
    // cachait le haut du panneau et son bouton de fermeture : même niveau que les autres fenêtres du site (10000).
    <div className="fixed inset-0 z-10000 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="ao-offer-title" onClick={e => e.stopPropagation()}
        className="h-full overflow-y-auto p-7 space-y-6"
        // ¾ de la zone de contenu (hors menu latéral de 240 px) sur grand écran, 760 px au moins, pleine largeur sur mobile.
        style={{ width: 'min(100vw, max(760px, calc((100vw - 240px) * 0.75)))', background: 'var(--admin-panel)', borderLeft: '1px solid var(--admin-line)', color: 'var(--admin-fg)' }}>

        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-medium px-2 py-1 rounded-md" style={{ color: STATUS_UI[published ? 'published' : row.status].color, background: 'var(--admin-panel-raised)' }}>
              {STATUS_UI[published ? 'published' : row.status].label}
            </span>
            <h2 id="ao-offer-title" className="text-xl font-bold text-admin-fg mt-3" style={{ textWrap: 'balance' }}>{row.title}</h2>
            <FingerprintBadge fingerprint={row.fingerprint} />
            <p className="text-xs mt-1" style={{ color: 'var(--admin-fg-muted)' }}>
              Reçue le {formatDay(row.receivedAt)} de {row.senderName ? `${row.senderName} <${row.senderAddress}>` : row.senderAddress || 'expéditeur inconnu'}
              {row.forwardedBy ? `, transférée par ${row.forwardedBy}` : ''}
              {row.subject ? ` · « ${row.subject} »` : ''}
              {` · source : ${AO_CHANNEL_LABEL[row.channel]}`}
              {row.sourceCount > 1 ? ` · reçue dans ${row.sourceCount} e-mails` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ ...secondaryButton, padding: 8 }}><X size={16} /></button>
        </div>

        {error && (
          <p role="alert" className="text-sm p-3 rounded-lg" style={{ color: '#b91c1c', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</p>
        )}

        {/* Données extraites (internes : client compris) */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {facts.map(([label, value]) => (
            <div key={label}>
              <p style={fieldLabel}>{label}</p>
              <p className="text-sm">{value}</p>
            </div>
          ))}
        </section>
        {row.skills.length > 0 && (
          <section>
            <p style={fieldLabel}>Compétences</p>
            <div className="flex flex-wrap gap-1.5">
              {row.skills.map(s => <span key={s} className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--admin-panel-raised)' }}>{s}</span>)}
            </div>
          </section>
        )}
        {row.technologies.length > 0 && (
          <section>
            <p style={fieldLabel}>Technologies</p>
            <div className="flex flex-wrap gap-1.5">
              {row.technologies.map(t => <span key={t} className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--admin-panel-raised)' }}>{t}</span>)}
            </div>
          </section>
        )}
        {actions.sourcing && <Sourcing offerId={row.$id} sourcing={actions.sourcing} />}
        <Originals emailId={row.emailId} attachments={row.attachments} originalApi={paths.originalApi} />
        <section>
          <p style={{ ...fieldLabel, marginBottom: 12 }}>Description</p>
          <AoDescription text={row.description} />
        </section>

        {/* Actions */}
        {published ? (
          <a href={jobId ? `/jobs/${jobId}` : paths.jobs} target="_blank" rel="noreferrer" style={primaryButton}>
            <ExternalLink size={15} />Voir l&apos;offre publiée
          </a>
        ) : !draft && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={prepare} disabled={pending} style={{ ...primaryButton, opacity: pending ? 0.7 : 1 }}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Préparer la publication
            </button>
            {row.status === 'ignored'
              ? <button type="button" onClick={() => changeStatus('to_review')} disabled={pending} style={secondaryButton}><RotateCcw size={15} />Remettre à valider</button>
              : <button type="button" onClick={() => changeStatus('ignored')} disabled={pending} style={secondaryButton}><Ban size={15} />Ignorer</button>}
          </div>
        )}

        {/* Version publique, modifiable avant publication */}
        {draft && preview && !published && (
          <section className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
            <div>
              <h3 className="font-semibold text-admin-fg">Version publiée sur le site</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--admin-fg-muted)' }}>
                Le client est remplacé par un libellé générique et les coordonnées (noms, e-mails, téléphones, liens) sont retirées. Ces règles sont réappliquées à la publication.
              </p>
            </div>
            {preview.similarJobs.length > 0 && (
              <div className="flex gap-2 text-sm p-3 rounded-lg" style={{ color: '#b45309', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <p>Une offre similaire est déjà en ligne : {preview.similarJobs.map(j => `« ${j.title} » (${j.location})`).join(', ')}. Vérifiez qu&apos;il ne s&apos;agit pas d&apos;un doublon.</p>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Titre"><input value={draft.title} onChange={e => edit('title', e.target.value)} style={{ ...control, width: '100%' }} /></Field>
              <Field label="Entreprise affichée"><input value={draft.companyName} onChange={e => edit('companyName', e.target.value)} placeholder="ex. Grand compte – Banque" style={{ ...control, width: '100%' }} /></Field>
              <Field label="Ville"><input value={draft.location} onChange={e => edit('location', e.target.value)} style={{ ...control, width: '100%' }} /></Field>
              <Field label="TJM / salaire (€)">
                <input type="number" min={0} inputMode="numeric" value={draft.salary ?? ''} onChange={e => edit('salary', e.target.value ? Math.round(Number(e.target.value)) : null)} style={{ ...control, width: '100%' }} />
              </Field>
              <Field label="Contrat">
                <select value={draft.contractType} onChange={e => edit('contractType', e.target.value as AoContract)} style={{ ...control, width: '100%' }}>
                  {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
                </select>
              </Field>
              <Field label="Télétravail">
                <select value={draft.remote} onChange={e => edit('remote', e.target.value as AoRemote)} style={{ ...control, width: '100%' }}>
                  {Object.entries(REMOTE_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Compétences (séparées par des virgules, 10 maximum)">
              <input value={skillsText} onChange={e => setSkillsText(e.target.value)} style={{ ...control, width: '100%' }} />
            </Field>
            <Field label="Description">
              <textarea value={draft.description} onChange={e => edit('description', e.target.value)} rows={14}
                style={{ ...control, width: '100%', height: 'auto', padding: 12, lineHeight: 1.55 }} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={publish} disabled={pending} style={{ ...primaryButton, opacity: pending ? 0.7 : 1 }}>
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Publier l&apos;offre anonymisée
              </button>
              <button type="button" onClick={() => setDraft(null)} disabled={pending} style={secondaryButton}>Annuler</button>
            </div>
            <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>{publishNote}</p>
          </section>
        )}
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span style={{ ...fieldLabel, display: 'block' }}>{label}</span>
      {children}
    </label>
  )
}

/**
 * E-mail d'origine et pièces jointes, relus dans la boîte au clic (vérification de l'authenticité : en-têtes, DKIM).
 * Téléchargés par fetch : une erreur (e-mail supprimé de la boîte…) s'affiche ici au lieu d'être enregistrée en fichier.
 */
function Originals({ emailId, attachments, originalApi }: { emailId: string; attachments: string[]; originalApi: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const base = `${originalApi}/${encodeURIComponent(emailId)}`
  const files: { key: string; label: string; url: string; filename: string }[] = [
    { key: 'eml', label: 'E-mail d’origine (.eml)', url: base, filename: `ao-${emailId}.eml` },
    ...attachments.map(name => ({ key: name, label: name, url: `${base}?attachment=${encodeURIComponent(name)}`, filename: name })),
  ]
  const download = async (file: (typeof files)[number]) => {
    setBusy(file.key)
    setError('')
    try {
      const res = await fetch(file.url)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Téléchargement impossible (${res.status}).`)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: file.filename })
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Téléchargement impossible : connexion interrompue, réessayez.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <section>
      <p style={fieldLabel}>Originaux (relus dans la boîte de réception)</p>
      <div className="flex flex-wrap gap-2">
        {files.map(file => (
          <button key={file.key} type="button" onClick={() => download(file)} disabled={busy !== null} style={{ ...secondaryButton, fontSize: 13 }}>
            {busy === file.key ? <Loader2 size={14} className="animate-spin" /> : file.key === 'eml' ? <Download size={14} /> : <Paperclip size={14} />}
            <span className="break-all text-left">{file.label}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm mt-2" style={{ color: '#b91c1c' }}>{error}</p>}
    </section>
  )
}

const ORIGIN_LABEL: Record<SourcedCandidate['origin'], string> = { pool: 'Base candidats', vivier: 'Vivier', application: 'Candidature' }

/**
 * « Sourcing » : les 5 meilleurs candidats notés 65 ou plus, avec la raison donnée par l'IA. Le résultat enregistré est
 * lu à l'ouverture (matching de la publication, ou dernier calcul à la demande) : aucun appel d'IA tant qu'on ne clique
 * pas sur « Trouver des candidats » / « Recalculer » (un appel d'IA, environ une minute).
 */
function Sourcing({ offerId, sourcing }: { offerId: string; sourcing: NonNullable<AoDashboardActions['sourcing']> }) {
  const [result, setResult] = useState<SourcingResult | null>(null)
  const [computing, setComputing] = useState(false)
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    startTransition(async () => setResult(await sourcing(offerId)))
  }, [offerId, sourcing])
  const run = () => startTransition(async () => {
    setComputing(true)
    setResult(await sourcing(offerId, true))
    setComputing(false)
  })
  const candidates = result?.candidates
  const computed = !!result?.computedAt
  return (
    <section>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ ...fieldLabel, marginBottom: 0 }}>Sourcing : meilleurs candidats</p>
        <button type="button" onClick={run} disabled={pending} style={{ ...secondaryButton, fontSize: 13 }}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          {computing ? 'Analyse des CV…' : pending ? 'Lecture…' : computed ? 'Recalculer' : 'Trouver des candidats'}
        </button>
      </div>
      <div aria-live="polite">
        {result?.error && <p role="alert" className="text-sm mt-2" style={{ color: '#b91c1c' }}>{result.error}</p>}
        {result && !result.error && (
          <p className="text-xs mt-2" style={{ color: 'var(--admin-fg-muted)' }}>
            {!computed
              ? 'Pas encore calculé pour cette offre (calculé automatiquement à sa publication).'
              : `Calculé le ${formatDay(result.computedAt!)}${result.scanned ? ` sur ${result.scanned} CV` : ''} : ${candidates?.length ? `${candidates.length} candidat${candidates.length > 1 ? 's' : ''} noté${candidates.length > 1 ? 's' : ''} 65 ou plus (5 au plus).` : 'aucun candidat noté 65 ou plus.'}`}
          </p>
        )}
        {candidates && candidates.length > 0 && (
          <ul className="mt-2 space-y-2">
            {candidates.map(c => (
              <li key={c.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--admin-panel-raised)' }}>
                <span className="text-sm font-semibold w-10 text-right shrink-0" style={{ color: 'var(--admin-fg)', fontVariantNumeric: 'tabular-nums' }}>{c.score ?? '—'}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium" style={{ color: 'var(--admin-fg)' }}>
                    {c.name || 'Candidat sans nom'}
                    <span className="ml-2 text-xs font-normal" style={{ color: 'var(--admin-fg-muted)' }}>{ORIGIN_LABEL[c.origin]}</span>
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--admin-fg-muted)' }}>{c.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * Empreinte de l'offre (fingerprint.ts) : ce qui fait son unicité. Deux e-mails donnant la même empreinte (mêmes mots du
 * titre, même client, même ville, même contrat, même organisation) sont fusionnés en une seule offre (« Sources »).
 * Affichée courte ; valeur complète en infobulle et copiée par le bouton.
 */
function FingerprintBadge({ fingerprint }: { fingerprint: string }) {
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint)
      setCopied('ok')
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : la valeur reste lisible dans l'infobulle.
      setCopied('error')
    }
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <p className="inline-flex items-center gap-1.5 mt-2 text-xs px-2 py-1 rounded-md" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg-muted)' }}
      title={`Empreinte d'unicité : ${fingerprint}\nCalculée à partir des mots du titre, du client, de la ville et du contrat ; deux e-mails de même empreinte sont fusionnés.`}>
      <span>ID :</span>
      <code className="font-mono" style={{ color: 'var(--admin-fg)' }}>{fingerprint.slice(0, 10)}</code>
      <button type="button" onClick={copy} aria-label="Copier l'identifiant complet" className="inline-flex items-center rounded focus-visible:ring-2" style={{ color: 'var(--admin-fg-muted)' }}>
        {copied === 'ok' ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {copied && <span role="status" className="sr-only">{copied === 'ok' ? 'Identifiant copié' : 'Copie impossible'}</span>}
      {copied === 'error' && <span aria-hidden="true">copie impossible</span>}
    </p>
  )
}
