'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode, type RefObject } from 'react'
import { AlertTriangle, Ban, Check, CircleStop, Copy, Download, ExternalLink, Loader2, Paperclip, RotateCcw, Send, ShieldAlert, Sparkles, Users, X } from 'lucide-react'
import { AO_CHANNEL_LABEL, type AoOfferRow } from '@/lib/ao/filters'
import { findIdentifiers } from '@/lib/ao/name-match'
import type { AoDashboardActions, AoDashboardPaths, PublicationDraft, SourcedCandidate, SourcingResult } from '@/lib/ao/dashboard-types'
import type { AoContract, AoRemote } from '@/lib/ao/types'
import { AoDescription } from './ao-description'
import { WorkBadge, type OfferPublication } from './offer-publications'
import { TrackingStepper } from './offer-tracking'
import type { TrackingStep } from '@/lib/ao/tracking'
import {
  BRAND, CONTRACT_LABEL, ENGAGEMENT_LABEL, REMOTE_LABEL, STATUS_UI, control, fieldLabel, formatAmount, formatDay, optionStyle, primaryButton, secondaryButton,
} from '@/app/admin/candidats/labels'

interface Props {
  row: AoOfferRow
  actions: Pick<AoDashboardActions, 'setStatus' | 'sourcing' | 'stopTasks'>
  paths: Pick<AoDashboardPaths, 'originalApi' | 'jobs'>
  /** Sous le formulaire de publication : ce que la publication déclenche dans cet espace. */
  publishNote: string
  /** Suivi de l'offre (validation, offre en ligne, LinkedIn, sourcing) et page où relancer une diffusion. */
  tracking: TrackingStep[]
  social: { href: string; label: string; jobParam?: string }
  /**
   * Préparation et publication de cette offre, tenues par le tableau (offer-publications.tsx) : elles continuent si le
   * panneau est fermé, et le panneau rouvert les retrouve.
   */
  publication: OfferPublication
  onPrepare: () => void
  /** Abandonne la préparation en cours (sa version, rédigée quand même par le serveur, est ignorée). */
  onStopPreparing: () => void
  onPublish: (draft: PublicationDraft, skillsText: string) => void
  onEdit: (patch: Pick<Partial<OfferPublication>, 'draft' | 'skillsText'>) => void
  onCancel: () => void
  onClose: () => void
}

export function AoOfferPanel({ row, actions, paths, publishNote, tracking, social, publication, onPrepare, onStopPreparing, onPublish, onEdit, onCancel, onClose }: Props) {
  const { preview, draft, skillsText, running } = publication
  const [statusError, setStatusError] = useState('')
  // « Tout arrêter » : recherche de candidats en cours (section Sourcing), arrêt des tâches d'arrière-plan, compte rendu.
  const [sourcingComputing, setSourcingComputing] = useState(false)
  const stopSourcing = useRef<(() => void) | null>(null)
  const [stopping, setStopping] = useState(false)
  const [backgroundStopped, setBackgroundStopped] = useState(false)
  const [stopNotice, setStopNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pending, start] = useTransition()
  const busy = pending || running !== null
  const error = statusError || publication.error
  const jobId = publication.jobId ?? row.jobId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function changeStatus(status: 'to_review' | 'ignored') {
    setStatusError('')
    start(async () => {
      const res = await actions.setStatus(row.$id, status)
      if (res.error) setStatusError(res.error)
    })
  }

  // Toute modification invalide la relecture : la version validée est toujours celle qui sera publiée.
  const edit = <K extends keyof PublicationDraft>(key: K, value: PublicationDraft[K]) => { if (draft) onEdit({ draft: { ...draft, [key]: value, reviewed: false } }) }
  const editSkills = (value: string) => onEdit({ skillsText: value, ...(draft && { draft: { ...draft, reviewed: false } }) })
  // Noms à masquer et références encore présents, champ par champ, recalculés à chaque modification.
  const risks = useMemo(() => {
    if (!draft || !preview) return []
    const fields: [string, string][] = [
      ['titre', draft.title], ['entreprise affichée', draft.companyName], ['ville', draft.location], ['compétences', skillsText], ['description', draft.description],
    ]
    return fields.flatMap(([field, text]) => findIdentifiers(text, preview.watchNames).map(found => `« ${found} » (${field})`))
  }, [draft, preview, skillsText])
  // Le serveur marque l'offre publiée avant de créer l'offre publique : pendant la publication, le panneau montre
  // l'opération en cours, pas encore le lien vers une offre qui n'existe peut-être pas.
  const published = running !== 'publishing' && (row.status === 'published' || jobId !== null)
  // Après la publication : diffusion LinkedIn et sourcing automatique encore en cours d'après le suivi.
  const backgroundRunning = !!actions.stopTasks && published && !backgroundStopped
    && tracking.some(s => (s.key === 'social' || s.key === 'sourcing') && s.tone === 'working')
  const stoppable = [
    running === 'preparing' && 'la rédaction de la version anonymisée',
    sourcingComputing && 'la recherche de candidats',
    backgroundRunning && 'la diffusion LinkedIn et les e-mails aux candidats pas encore envoyés',
  ].filter((s): s is string => !!s)

  // Ce qui tourne dans le navigateur s'abandonne (une Server Action ne s'interrompt pas : le serveur finit la demande
  // en cours, son résultat est ignoré) ; les tâches d'arrière-plan de la publication s'arrêtent vraiment, avant d'atteindre
  // LinkedIn ou les candidats (publication-stop.ts).
  async function stopAll() {
    const done: string[] = []
    if (running === 'preparing') { onStopPreparing(); done.push('Rédaction arrêtée : sa version ne sera pas gardée.') }
    if (stopSourcing.current) { stopSourcing.current(); done.push('Recherche de candidats arrêtée : le calcul déjà demandé se termine sur le serveur, son résultat s’affichera à la prochaine ouverture.') }
    if (backgroundRunning && actions.stopTasks) {
      if (!window.confirm('Arrêter la diffusion LinkedIn pas encore envoyée et les e-mails automatiques aux candidats de cette offre ? Les e-mails arrêtés ne partiront pas plus tard ; la diffusion pourra être relancée.')) {
        if (done.length) setStopNotice({ tone: 'ok', text: done.join(' ') })
        return
      }
      setStopping(true)
      const res = await actions.stopTasks(row.$id).catch(() => ({ error: 'Arrêt impossible : connexion interrompue, réessayez.', message: undefined }))
      setStopping(false)
      if (res.error) return setStopNotice({ tone: 'error', text: [...done, res.error].join(' ') })
      setBackgroundStopped(true)
      if (res.message) done.push(res.message)
    }
    setStopNotice({ tone: 'ok', text: done.join(' ') })
  }
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
  const closeButton = <button type="button" onClick={onClose} style={{ ...secondaryButton, padding: '8px 12px' }}><X size={15} aria-hidden />Fermer</button>
  // Page où relancer la diffusion : ouverte sur l'offre publique elle-même quand elle sait la montrer.
  const socialLink = social.jobParam && jobId
    ? { label: social.label, href: `${social.href}?${social.jobParam}=${encodeURIComponent(jobId)}` }
    : social

  return (
    // Au-dessus de la barre de navigation fixe de l'espace recruteur (z-index 9000, site-navbar-client.tsx), qui
    // cachait le haut du panneau et son bouton de fermeture : même niveau que les autres fenêtres du site (10000).
    <div className="fixed inset-0 z-10000 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="ao-offer-title" onClick={e => e.stopPropagation()}
        className="h-full overflow-y-auto p-7 space-y-6"
        // ¾ de la zone de contenu (hors menu latéral de 240 px) sur grand écran, 760 px au moins, pleine largeur sur mobile.
        style={{ width: 'min(100vw, max(760px, calc((100vw - 240px) * 0.75)))', background: 'var(--admin-panel)', borderLeft: '1px solid var(--admin-line)', color: 'var(--admin-fg)' }}>

        {/* Barre du haut, visible pendant tout le défilement : état, « Tout arrêter » quand quelque chose peut l'être, « Fermer ». */}
        <div className="sticky -top-7 z-10 -mx-7 -mt-7 px-7 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-line)' }}>
          {running ? <WorkBadge work={running} /> : (
            <span className="text-xs font-medium px-2 py-1 rounded-md" style={{ color: STATUS_UI[published ? 'published' : row.status].color, background: 'var(--admin-panel-raised)' }}>
              {STATUS_UI[published ? 'published' : row.status].label}
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {stoppable.length > 0 && (
              <button type="button" onClick={stopAll} disabled={stopping} title={`Arrêter ${stoppable.join(', ')}`}
                style={{ ...secondaryButton, padding: '8px 12px', color: '#b91c1c', borderColor: '#b91c1c55', opacity: stopping ? 0.7 : 1 }}>
                {stopping ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <CircleStop size={15} aria-hidden />}
                Tout arrêter
              </button>
            )}
            {closeButton}
          </div>
          {/* Dans la barre : le compte rendu reste visible même si l'on a fait défiler le panneau. */}
          {stopNotice && (
            <div role="status" className="basis-full flex items-start gap-2 text-sm p-3 rounded-lg"
              style={stopNotice.tone === 'ok'
                ? { color: '#047857', background: 'rgba(4,120,87,0.06)', border: '1px solid rgba(4,120,87,0.2)' }
                : { color: '#b91c1c', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="flex-1">{stopNotice.text}</p>
              <button type="button" onClick={() => setStopNotice(null)} aria-label="Masquer ce message" className="shrink-0"><X size={14} aria-hidden /></button>
            </div>
          )}
        </div>

        <div>
          <div>
            <h2 id="ao-offer-title" className="text-xl font-bold text-admin-fg" style={{ textWrap: 'balance' }}>{row.title}</h2>
            <FingerprintBadge fingerprint={row.fingerprint} />
            <p className="text-xs mt-1" style={{ color: 'var(--admin-fg-muted)' }}>
              Reçue le {formatDay(row.receivedAt)} de {row.senderName ? `${row.senderName} <${row.senderAddress}>` : row.senderAddress || 'expéditeur inconnu'}
              {row.forwardedBy ? `, transférée par ${row.forwardedBy}` : ''}
              {row.subject ? ` · « ${row.subject} »` : ''}
              {` · source : ${AO_CHANNEL_LABEL[row.channel]}`}
              {row.sourceCount > 1 ? ` · reçue dans ${row.sourceCount} e-mails` : ''}
            </p>
          </div>
        </div>

        <TrackingStepper steps={tracking} social={socialLink}
          onShowCandidates={actions.sourcing ? () => document.getElementById('ao-offer-sourcing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined} />

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
        {actions.sourcing && (
          <Sourcing offerId={row.$id} sourcing={actions.sourcing} version={tracking.find(s => s.key === 'sourcing')?.text ?? ''}
            onComputingChange={setSourcingComputing} stopRef={stopSourcing} />
        )}
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
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onPrepare} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}>
                {running === 'preparing' ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : <Send size={15} />}
                {running === 'preparing' ? 'Rédaction de la version anonymisée…' : 'Préparer la publication'}
              </button>
              {running === 'preparing' && (
                <button type="button" onClick={onStopPreparing} style={{ ...secondaryButton, color: '#b91c1c', borderColor: '#b91c1c55' }}>
                  <CircleStop size={15} aria-hidden />Arrêter
                </button>
              )}
              {row.status === 'ignored'
                ? <button type="button" onClick={() => changeStatus('to_review')} disabled={busy} style={secondaryButton}><RotateCcw size={15} />Remettre à valider</button>
                : <button type="button" onClick={() => changeStatus('ignored')} disabled={busy} style={secondaryButton}><Ban size={15} />Ignorer</button>}
            </div>
            <p role="status" aria-live="polite" className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
              {running === 'preparing'
                ? 'L\'IA reformule l\'offre sans nom de client ni référence : une trentaine de secondes. Vous pouvez fermer ce panneau : la ligne indique « Modifications en cours » jusqu\'à la fin. Rien n\'est publié avant votre validation ; « Arrêter » abandonne cette version.'
                : ''}
            </p>
          </div>
        )}

        {/* Version anonymisée : relue, modifiée si besoin et validée par une personne avant toute publication (ADR 0013). */}
        {draft && preview && !published && (
          <section aria-labelledby="ao-publication-title" className="rounded-2xl p-5 space-y-5" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
            <div>
              <h3 id="ao-publication-title" className="flex items-center gap-2 font-semibold text-admin-fg">
                Version anonymisée à valider
                {preview.rewrite === 'ai' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg-muted)' }}>
                    <Sparkles size={12} aria-hidden />Rédigée par l&apos;IA
                  </span>
                )}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--admin-fg-muted)' }}>
                {preview.rewrite === 'ai'
                  ? 'Rédigée par l\'IA à partir de l\'offre : client, entités, projets, références et coordonnées retirés. Relisez-la, modifiez-la si besoin, puis validez-la.'
                  : 'Préparée par les règles automatiques : client connu remplacé, références et coordonnées retirées. Relisez-la, modifiez-la si besoin, puis validez-la.'}
                {' '}Ces règles sont réappliquées à la publication.
              </p>
            </div>
            {preview.notice && (
              <div className="flex gap-2 text-sm p-3 rounded-lg" style={{ color: '#b45309', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                <p>L&apos;IA n&apos;a pas rédigé cette version ({preview.notice.replace(/\.$/, '')}) : le texte d&apos;origine est repris sans reformulation. Relisez-le avec attention.</p>
              </div>
            )}
            {preview.similarJobs.length > 0 && (
              <div className="flex gap-2 text-sm p-3 rounded-lg" style={{ color: '#b45309', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                <p>Une offre similaire est déjà en ligne : {preview.similarJobs.map(j => `« ${j.title} » (${j.location})`).join(', ')}. Vérifiez qu&apos;il ne s&apos;agit pas d&apos;un doublon.</p>
              </div>
            )}
            <div role="status" aria-live="polite">
              {risks.length > 0 && (
                <div className="flex gap-2 text-sm p-3 rounded-lg" style={{ color: '#b91c1c', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" aria-hidden />
                  <p>Encore présents, à retirer du texte : {risks.join(', ')}. Ils identifient le client ou sa demande.</p>
                </div>
              )}
            </div>

            {/* Figé pendant la publication : la version envoyée au serveur est celle qui a été validée. */}
            <fieldset disabled={running === 'publishing'} className="min-w-0 m-0 p-0 border-0 space-y-5">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-4">
                <Field label="Titre"><input value={draft.title} onChange={e => edit('title', e.target.value)} style={{ ...control, width: '100%' }} /></Field>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Entreprise affichée"><input value={draft.companyName} onChange={e => edit('companyName', e.target.value)} placeholder="ex. Grand groupe bancaire" style={{ ...control, width: '100%' }} /></Field>
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
                  <input value={skillsText} onChange={e => editSkills(e.target.value)} style={{ ...control, width: '100%' }} />
                </Field>
                <Field label="Description (### titre de section, - puce)">
                  <textarea value={draft.description} onChange={e => edit('description', e.target.value)} rows={16}
                    style={{ ...control, width: '100%', height: 'auto', padding: 12, lineHeight: 1.55 }} />
                </Field>
              </div>
              <PublicationPreviewCard draft={draft} skills={skillsText} />
            </div>

            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer text-sm text-admin-fg" style={{ background: 'var(--admin-panel-raised)', border: '1px solid var(--admin-line)' }}>
              <input type="checkbox" checked={draft.reviewed} onChange={e => onEdit({ draft: { ...draft, reviewed: e.target.checked } })}
                className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: '#F97316' }} />
              <span>J&apos;ai relu cette version : elle ne contient aucun nom de société, aucune référence ni aucune coordonnée, et je la valide pour publication.</span>
            </label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => onPublish(draft, skillsText)} disabled={busy || !draft.reviewed}
                style={{ ...primaryButton, opacity: busy || !draft.reviewed ? 0.5 : 1, cursor: busy || !draft.reviewed ? 'not-allowed' : 'pointer' }}>
                {running === 'publishing' ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : <Send size={15} />}
                {running === 'publishing' ? 'Publication en cours…' : 'Publier l\'offre anonymisée'}
              </button>
              <button type="button" onClick={onCancel} disabled={busy} style={secondaryButton}>Annuler</button>
              {!draft.reviewed && !running && <span className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>Cochez la case de relecture pour publier.</span>}
            </div>
            <p role="status" aria-live="polite" className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
              {running === 'publishing'
                ? 'Création de l\'offre, diffusion et recherche de candidats : une minute ou plus. Vous pouvez fermer ce panneau : la ligne indique « Modifications en cours » jusqu\'à la fin.'
                : publishNote}
            </p>
          </section>
        )}

        {/* Bas du panneau : « Fermer » aussi, pour ne pas avoir à remonter après avoir lu ou publié. */}
        <div className="-mx-7 -mb-7 px-7 py-3 flex justify-end" style={{ borderTop: '1px solid var(--admin-line)' }}>
          {closeButton}
        </div>
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

/** Aperçu de l'offre telle qu'elle sera publiée, mis à jour à chaque modification : c'est ce qui est relu et validé. */
function PublicationPreviewCard({ draft, skills }: { draft: PublicationDraft; skills: string }) {
  const tags = skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
  const facts = [CONTRACT_LABEL[draft.contractType], REMOTE_LABEL[draft.remote], draft.salary ? formatAmount(draft.salary, draft.contractType) : '']
    .filter(Boolean)
  return (
    <div>
      <p style={fieldLabel}>Aperçu de l&apos;offre publiée</p>
      <article className="rounded-xl p-5 space-y-4" style={{ background: 'var(--admin-bg)', border: '1px solid var(--admin-line)' }}>
        <header className="space-y-1">
          <h4 className="text-lg font-bold text-admin-fg" style={{ textWrap: 'balance' }}>{draft.title || 'Titre de l’offre'}</h4>
          <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>{[draft.companyName, draft.location].filter(Boolean).join(' · ')}</p>
        </header>
        {facts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {facts.map(f => <span key={f} className="text-xs font-medium px-2.5 py-1 rounded-full text-admin-fg" style={{ background: `${BRAND}1A` }}>{f}</span>)}
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(t => <span key={t} className="text-xs px-2 py-1 rounded-md text-admin-fg" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>{t}</span>)}
          </div>
        )}
        <div className="pt-4" style={{ borderTop: '1px solid var(--admin-line)' }}>
          <AoDescription text={draft.description} />
        </div>
      </article>
    </div>
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
function Sourcing({ offerId, sourcing, version, onComputingChange, stopRef }: {
  offerId: string
  sourcing: NonNullable<AoDashboardActions['sourcing']>
  /** État du sourcing dans le suivi de l'offre : le résultat est relu quand il change (fin du sourcing automatique). */
  version: string
  /** Recherche en cours ou non (« Tout arrêter » du panneau). */
  onComputingChange: (computing: boolean) => void
  /** Arrêt de la recherche en cours, pour « Tout arrêter » ; null quand rien ne tourne. */
  stopRef: RefObject<(() => void) | null>
}) {
  const [result, setResult] = useState<SourcingResult | null>(null)
  const [computing, setComputing] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [pending, startTransition] = useTransition()
  // Recherche abandonnée : une Server Action ne s'interrompt pas, sa réponse est ignorée grâce à ce numéro de lancement.
  const runs = useRef(0)
  // L'action change d'identité à chaque relecture de la page (suivi en cours : toutes les 15 s) : lue par une ref, pour
  // ne relire le résultat qu'à l'ouverture de l'offre et quand son suivi change, pas à chaque relecture.
  const sourcingRef = useRef(sourcing)
  useEffect(() => { sourcingRef.current = sourcing })
  useEffect(() => {
    startTransition(async () => setResult(await sourcingRef.current(offerId)))
  }, [offerId, version])
  // Hors transition : abandonnée, la recherche ne doit pas garder le bouton en attente jusqu'à la réponse du serveur.
  async function run() {
    const token = ++runs.current
    setStopped(false)
    setComputing(true)
    onComputingChange(true)
    const res = await sourcing(offerId, true).catch((): SourcingResult => ({ error: 'Recherche interrompue (connexion perdue) : réessayez.' }))
    if (runs.current !== token) return
    setResult(res)
    setComputing(false)
    onComputingChange(false)
  }
  function stop() {
    runs.current++
    setComputing(false)
    setStopped(true)
    onComputingChange(false)
  }
  useEffect(() => { stopRef.current = computing ? stop : null })
  const candidates = result?.candidates
  const computed = !!result?.computedAt
  return (
    <section id="ao-offer-sourcing" className="scroll-mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ ...fieldLabel, marginBottom: 0 }}>Sourcing : meilleurs candidats</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={run} disabled={pending || computing} style={{ ...secondaryButton, fontSize: 13 }}>
            {pending || computing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            {computing ? 'Analyse des CV…' : pending ? 'Lecture…' : computed ? 'Recalculer' : 'Trouver des candidats'}
          </button>
          {computing && (
            <button type="button" onClick={stop} style={{ ...secondaryButton, fontSize: 13, color: '#b91c1c', borderColor: '#b91c1c55' }}>
              <CircleStop size={14} aria-hidden />Arrêter
            </button>
          )}
        </div>
      </div>
      <div aria-live="polite">
        {stopped && (
          <p className="text-xs mt-2" style={{ color: 'var(--admin-fg-muted)' }}>
            Recherche arrêtée : le calcul déjà demandé se termine sur le serveur ; son résultat s’affichera à la prochaine ouverture.
          </p>
        )}
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
