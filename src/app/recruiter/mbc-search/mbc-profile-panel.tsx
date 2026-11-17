'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Bookmark, Check, Copy, ExternalLink, Globe, Loader2, Mail, MapPin, MessageSquareText, Phone, Plus, Sparkles, UserRound, Users, X,
} from 'lucide-react'
import { addMbcProfileToVivier } from '@/app/recruiter/vivier/actions'
import { draftMbcOutreach } from './actions'
import { SCORE_WEIGHTS, type MbcCriteria, type MbcRevealed, type OutreachChannel, type ScoredProfile } from '@/lib/mbc-search/rules'
import type { MbcEvaluation } from '@/lib/mbc-search/evaluation'
import { FOLLOW_LIMITS, FOLLOW_STATUSES, type FollowStatus, type MbcFollow } from '@/lib/mbc-search/follow'
import { Avatar, ChipField, ErrorNote, orangeTint, surface, type Evaluation, type PhoneControl, type Reveal, type SaveButton } from './mbc-search-ui'
import { canRequestPhone, phoneTypeLabel, type MbcPhone } from '@/lib/mbc-search/phone'

// Panneau du profil choisi dans la liste : score détaillé, puis, une fois révélé, données d'Apollo (coordonnées,
// parcours), suites (vivier, offre, profils similaires, message d'approche) et analyse de l'IA, présentée à part des
// données d'Apollo (ADR 0037, phase 2). Colonne de droite sur grand écran, fenêtre plein écran en dessous.

const CHANNELS: { id: OutreachChannel; label: string }[] = [
  { id: 'email', label: 'E-mail' }, { id: 'linkedin', label: 'LinkedIn' }, { id: 'whatsapp', label: 'WhatsApp' },
]

const sectionTitle = 'mt-5 mb-2 font-bold uppercase tracking-wider'

/** Liste de textes de l'analyse, sous un titre ; rien si elle est vide. */
function NoteList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {/* Textes de l'IA : deux identiques sont possibles, la position départage. */}
        {items.map((item, i) => <li key={`${i}-${item}`}>· {item}</li>)}
      </ul>
    </div>
  )
}

/**
 * Suivi d'une personne enregistrée (ADR 0039) : statut, étiquettes et note du recruteur, gardés avec elle. `onSave` :
 * le suivi tel qu'enregistré (note nettoyée par le serveur), ou l'erreur à afficher.
 */
function FollowEditor({ follow, onSave }: { follow: MbcFollow; onSave: (f: MbcFollow) => Promise<{ follow?: MbcFollow; error?: string }> }) {
  const [draft, setDraft] = useState(follow)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const changed = JSON.stringify(draft) !== JSON.stringify(follow)
  /** Modification du recruteur : le message du dernier enregistrement ne vaut plus. */
  const change = (patch: Partial<MbcFollow>) => {
    setDraft(d => ({ ...d, ...patch }))
    setMessage(null)
  }
  const save = async () => {
    setSaving(true)
    setMessage(null)
    const res = await onSave(draft)
    setSaving(false)
    // Version enregistrée reprise telle quelle : sinon une note nettoyée par le serveur paraîtrait encore modifiée.
    if (res.follow) setDraft(res.follow)
    setMessage(res.follow ? { ok: true, text: 'Suivi enregistré.' } : { ok: false, text: res.error ?? 'Suivi non enregistré.' })
  }
  return (
    <div className="grid gap-2.5">
      <div>
        <label htmlFor="mbc-follow-status" className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Statut</label>
        <select id="mbc-follow-status" value={draft.status} onChange={e => change({ status: e.target.value as FollowStatus })}
          className="mt-1 w-full rounded-xl px-3 py-2 text-sm" style={{ ...surface, color: 'var(--color-text)' }}>
          {(Object.keys(FOLLOW_STATUSES) as FollowStatus[]).map(s => <option key={s} value={s}>{FOLLOW_STATUSES[s]}</option>)}
        </select>
      </div>
      <ChipField id="mbc-follow-tags" label="Étiquettes" hint={`${FOLLOW_LIMITS.tags} au plus`} placeholder="ex : Relance, Java"
        values={draft.tags} onChange={tags => change({ tags })} limits={{ items: FOLLOW_LIMITS.tags, item: FOLLOW_LIMITS.tag }} />
      <div>
        <label htmlFor="mbc-follow-note" className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Note</label>
        <textarea id="mbc-follow-note" value={draft.note} onChange={e => change({ note: e.target.value })} rows={3}
          maxLength={FOLLOW_LIMITS.note} placeholder="Ce que vous voulez retenir de cette personne (visible par vous seul)."
          className="mt-1 w-full rounded-xl p-3 text-sm resize-y" style={{ ...surface, color: 'var(--color-text)' }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={save} disabled={!changed || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer le suivi
        </button>
        {message && (message.ok
          ? <p role="status" className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{message.text}</p>
          : <div className="flex-1 min-w-0"><ErrorNote>{message.text}</ErrorNote></div>)}
      </div>
    </div>
  )
}

/** Analyse de l'IA d'un profil révélé : score sur le barème du matching (données Apollo), critères, notes. */
function EvaluationView({ e }: { e: MbcEvaluation }) {
  return (
    <div className="rounded-xl p-3" style={{ background: orangeTint(6) }}>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
        <strong>{e.score} / 100</strong> sur ce qu’Apollo montre
        {e.cap && <span style={{ color: 'var(--color-text-muted)' }}> · plafonné à {e.cap.value} ({e.cap.label})</span>}
      </p>
      <dl className="mt-2 space-y-1.5">
        {e.parts.map(part => (
          <div key={part.key} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
            <dt>{part.label}</dt>
            {part.unavailable
              ? <dd className="col-span-2" style={{ color: 'var(--color-text-muted)' }}>Non disponible</dd>
              : (
                <>
                  <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }} aria-hidden>
                    <span className="block h-full" style={{ width: `${part.max > 0 ? (part.points / part.max) * 100 : 0}%`, background: 'var(--color-brand-orange)' }} />
                  </span>
                  <dd className="text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }} title={part.detail}>{Math.round(part.points)}/{Math.round(part.max)}</dd>
                </>
              )}
          </div>
        ))}
      </dl>
      {e.summary && <p className="mt-3 text-xs" style={{ color: 'var(--color-text)' }}>{e.summary}</p>}
      <NoteList title="Pourquoi il correspond" items={e.strengths} />
      <NoteList title="Non visible dans le profil" items={e.missing} />
      <NoteList title="Points de vigilance" items={e.concerns} />
      <NoteList title="Questions d’entretien" items={e.questions} />
      <NoteList title="Prochaines étapes" items={e.nextSteps} />
      <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Analyse de l’IA, à vérifier. Apollo ne donne ni compétences, ni formation, ni langues : une compétence non visible n’est pas forcément absente.
      </p>
    </div>
  )
}

const BREAKDOWN: { key: keyof typeof SCORE_WEIGHTS; label: string }[] = [
  { key: 'title', label: 'Intitulé' },
  { key: 'skills', label: 'Compétences' },
  { key: 'reachable', label: 'Joignable' },
  { key: 'fresh', label: 'Récent' },
]

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const month = (m: string) => (m.length >= 7 ? `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}` : m.slice(0, 4))
const period = (e: MbcRevealed['experiences'][number]) => [month(e.start), e.current ? 'aujourd’hui' : month(e.end)].filter(Boolean).join(' – ')

/** Ajouts déjà faits pour ce profil pendant la session : vivier général ('general') et offres (identifiant). */
export type Added = Record<string, true>

function ContactRow({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs min-w-0" style={surface}>
      <span className="w-16 shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }} title={value}>{value}</span>
      {children}
    </div>
  )
}

const smallBtn = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 disabled:opacity-40'

/** Ligne « Téléphone » tant qu'aucun numéro n'est affiché : demande à faire, en cours, sans résultat. */
function phoneStatusText(phone: MbcPhone | undefined, flagged: boolean): string {
  if (!phone) return flagged ? 'Connu d’Apollo, pas encore demandé' : 'Pas encore demandé'
  if (phone.status === 'pending') return 'Recherche du numéro chez Apollo…'
  if (phone.status === 'failed') return 'Recherche sans résultat : vous pouvez la relancer'
  return 'Aucun numéro trouvé par Apollo'
}

/** « Enregistrer » / « Enregistré » ; `cost` : profil pas encore révélé, l'enregistrer coûte un crédit. */
function SaveToggle({ save, className, cost }: { save: SaveButton; className: string; cost?: boolean }) {
  return (
    <button type="button" onClick={save.onToggle} disabled={save.disabled} aria-pressed={save.saved}
      title={save.reason ?? (save.saved ? 'Retirer des personnes enregistrées' : cost ? 'Révèle le profil (1 crédit) et le garde dans vos personnes enregistrées' : 'Garder dans vos personnes enregistrées')}
      className={`inline-flex items-center gap-1.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-40 ${className}`}
      style={save.saved ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' } : { ...surface, color: 'var(--color-text)' }}>
      {save.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" fill={save.saved ? 'currentColor' : 'none'} />}
      {save.saved ? 'Enregistré' : cost ? 'Enregistrer · 1 crédit' : 'Enregistrer'}
    </button>
  )
}

export function ProfilePanel({
  profile, reveal, criteria, brief, jobs, save, added, canReveal, evaluation, canSimilar, evaluateBlocked, follow, phone,
  onReveal, onAdded, onEvaluate, onSimilar, onSaveFollow, onClose,
}: {
  profile: ScoredProfile
  reveal?: Reveal
  criteria: MbcCriteria
  brief: string
  jobs: { id: string; title: string }[] | null
  save: SaveButton
  added: Added
  canReveal: boolean
  evaluation?: Evaluation
  /** « Chercher des profils similaires » possible (rien d'autre en cours ; aucun critère requis). */
  canSimilar: boolean
  /** Pourquoi « Évaluer » est impossible (autre action en cours, besoin sans intitulé ni compétence), sinon null. */
  evaluateBlocked: string | null
  /** Suivi de la personne si elle est enregistrée (sinon : pas de section « Suivi »). */
  follow?: MbcFollow
  onSaveFollow: (f: MbcFollow) => Promise<{ follow?: MbcFollow; error?: string }>
  /** « Demander le téléphone » (profil révélé). */
  phone: PhoneControl
  onReveal: () => void
  onAdded: (target: string) => void
  onEvaluate: () => void
  onSimilar: () => void
  onClose: () => void
}) {
  const [channel, setChannel] = useState<OutreachChannel>('email')
  const full = reveal?.state === 'done' ? reveal.profile : null
  const name = full?.name || [profile.firstName, profile.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  const [copied, setCopied] = useState<'email' | 'message' | null>(null)
  const [jobId, setJobId] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [addNote, setAddNote] = useState<{ ok: boolean; text: string; href?: string } | null>(null)
  // Le brouillon garde le canal pour lequel il a été écrit (le choix peut changer pendant sa rédaction).
  const [draft, setDraft] = useState<{ state: 'idle' | 'loading' } | { state: 'done'; text: string; channel: OutreachChannel } | { state: 'error'; text: string }>({ state: 'idle' })

  const copy = async (what: 'email' | 'message', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setAddNote({ ok: false, text: 'Copie impossible dans ce navigateur : sélectionnez le texte et copiez-le.' })
    }
  }

  /** « Ajouter au vivier » (target 'general') ou « Associer à une offre » (target = offre) : le seul enregistrement. */
  const add = async (target: string) => {
    if (!full) return
    setAdding(target)
    setAddNote(null)
    try {
      const res = await addMbcProfileToVivier({
        jobId: target === 'general' ? null : target,
        profile: {
          apolloId: full.id, name: full.name, title: full.title, headline: full.headline, company: full.company, location: full.location,
          linkedinUrl: full.linkedinUrl, email: full.email, experiences: full.experiences,
        },
      })
      if (res.error) {
        setAddNote({ ok: false, text: res.error })
        return
      }
      onAdded(target)
      const where = target === 'general' ? 'à votre vivier' : `au vivier de « ${jobs?.find(j => j.id === target)?.title ?? 'l’offre'} »`
      setAddNote({
        ok: true,
        text: `Ajouté ${where}.${res.notice ? ` ${res.notice}` : ''}`,
        href: target === 'general' ? '/recruiter/vivier?vue=general' : `/recruiter/vivier/${target}`,
      })
    } catch {
      setAddNote({ ok: false, text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
    } finally {
      setAdding(null)
    }
  }

  const writeDraft = async () => {
    if (!full) return
    const asked = channel
    setDraft({ state: 'loading' })
    try {
      const res = await draftMbcOutreach({
        brief, criteria, channel: asked,
        person: {
          firstName: full.name.split(/\s+/)[0] ?? '', title: full.title, company: full.company,
          experiences: full.experiences.map(e => ({ title: e.title, company: e.company })),
        },
      })
      setDraft(res.message ? { state: 'done', text: res.message, channel: asked } : { state: 'error', text: res.error ?? 'Message indisponible.' })
    } catch {
      setDraft({ state: 'error', text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
    }
  }

  return (
    <div className="rounded-2xl p-5" style={surface}>
      <div className="flex items-start gap-3">
        <Avatar name={name} photoUrl={full?.photoUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-tight" style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 700 }}>{name}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {full?.headline || [full?.title || profile.title, full?.company || profile.company].filter(Boolean).join(' · ')}
          </p>
          {full?.email && (
            <p className="text-[11px] font-bold mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {full.emailStatus === 'verified' ? 'E-mail vérifié par Apollo' : 'E-mail non vérifié'}
            </p>
          )}
          {full?.location && <p className="text-xs mt-1 inline-flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><MapPin className="h-3 w-3" />{full.location}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer le profil" className="rounded-lg p-1.5" style={{ color: 'var(--color-text)' }}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {full ? (
        <>
          <h3 className={sectionTitle} style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 700 }}>Données Apollo</h3>
          <div className="grid gap-2">
            {full.email ? (
              <ContactRow label={full.emailStatus === 'verified' ? 'E-mail ✓' : 'E-mail'} value={full.email}>
                <button type="button" onClick={() => copy('email', full.email)} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>
                  {copied === 'email' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copier
                </button>
              </ContactRow>
            ) : <ContactRow label="E-mail" value="Aucun e-mail professionnel connu" />}
            {full.phone?.numbers.map(n => (
              <ContactRow key={n.number} label={phoneTypeLabel(n.type)} value={n.number}>
                <a href={`tel:${n.number}`} className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                  <Phone className="h-3 w-3" /> Appeler
                </a>
              </ContactRow>
            ))}
            {full.phone?.status !== 'found' && (
              <ContactRow label="Téléphone" value={canRequestPhone(full.phone) && !phone.included ? 'Réservé aux formules payantes' : phoneStatusText(full.phone, profile.hasPhone)}>
                {canRequestPhone(full.phone) && !phone.included ? (
                  <Link href="/recruiter/abonnement#formules" className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                    Voir les formules
                  </Link>
                ) : canRequestPhone(full.phone) ? (
                  <button type="button" onClick={phone.onRequest} disabled={phone.busy || phone.disabled !== null}
                    title={phone.disabled ?? 'Jusqu’à 8 crédits Apollo si un numéro est trouvé, aucun sinon'}
                    className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>
                    {phone.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Phone className="h-3 w-3" />} Demander · jusqu’à 8 crédits
                  </button>
                ) : full.phone?.status === 'pending' && (
                  phone.busy
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-label="Recherche du numéro en cours" style={{ color: 'var(--color-text-muted)' }} />
                    : <button type="button" onClick={phone.onCheck} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>Vérifier</button>
                )}
              </ContactRow>
            )}
            {full.linkedinUrl && (
              <ContactRow label="LinkedIn" value={full.linkedinUrl.replace(/^https:\/\/(www\.)?/, '')}>
                <a href={full.linkedinUrl} target="_blank" rel="noopener noreferrer" className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                  Ouvrir <ExternalLink className="h-3 w-3" />
                </a>
              </ContactRow>
            )}
            {full.company && (
              <ContactRow label="Entreprise" value={full.company}>
                {full.companyWebsite && (
                  <a href={full.companyWebsite} target="_blank" rel="noopener noreferrer" aria-label="Site de l'entreprise" className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                    <Globe className="h-3 w-3" />
                  </a>
                )}
              </ContactRow>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => add('general')} disabled={adding !== null || added.general}
              className="inline-flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-50"
              style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              {adding === 'general' ? <Loader2 className="h-4 w-4 animate-spin" /> : added.general ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {added.general ? 'Dans le vivier' : 'Ajouter au vivier'}
            </button>
            <SaveToggle save={save} className="justify-center px-2 py-2.5" />
          </div>
          {save.reason && <p className="mt-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{save.reason}</p>}
          {jobs && jobs.length > 0 && (
            <div className="mt-2 flex gap-2">
              <label htmlFor="mbc-job" className="sr-only">Offre à associer</label>
              <select id="mbc-job" value={jobId} onChange={e => setJobId(e.target.value)} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm"
                style={{ ...surface, color: 'var(--color-text)' }}>
                <option value="">Associer à une offre…</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{added[j.id] ? '✓ ' : ''}{j.title}</option>)}
              </select>
              <button type="button" onClick={() => add(jobId)} disabled={!jobId || adding !== null || added[jobId]}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                {adding === jobId && jobId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
              </button>
            </div>
          )}
          {addNote && (
            <p role="status" className="mt-2 text-xs" style={{ color: 'var(--color-text)' }}>
              {addNote.text}{' '}
              {addNote.href && <a href={addNote.href} className="font-bold underline underline-offset-2" style={{ color: 'var(--color-text)' }}>Voir</a>}
            </p>
          )}
          {/* Décision du 2026-11-17 : une personne de MBC Search entre dans le pipeline avec son CV, comme tout candidat. */}
          <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            Pour le pipeline d’une offre : demandez son CV (le message d’approche le demande), puis importez-le dans le vivier de l’offre.
          </p>
          <button type="button" onClick={onSimilar} disabled={!canSimilar}
            title="Nouvelle recherche des profils proches de celui-ci (l’IA tire les critères de son poste et de son parcours)"
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
            <Users className="h-4 w-4" /> Chercher des profils similaires
          </button>

          {follow && (
            <>
              <h3 className={sectionTitle} style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 700 }}>Suivi</h3>
              <FollowEditor follow={follow} onSave={onSaveFollow} />
            </>
          )}

          <h3 className={sectionTitle} style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 700 }}>Analyse IA</h3>
          {evaluation?.state === 'done' ? <EvaluationView e={evaluation.evaluation} /> : (
            <button type="button" onClick={onEvaluate} disabled={evaluateBlocked !== null || evaluation?.state === 'loading'}
              title={evaluateBlocked ?? 'L’IA juge le profil sur le barème du matching, avec vos poids (une recherche du quota du jour)'}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              {evaluation?.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {evaluation?.state === 'loading' ? 'Évaluation en cours…' : 'Évaluer pour ce besoin'}
            </button>
          )}
          {evaluation?.state !== 'done' && evaluation?.state !== 'loading' && evaluateBlocked && (
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{evaluateBlocked}</p>
          )}
          {evaluation?.state === 'error' && <div className="mt-2"><ErrorNote>{evaluation.text}</ErrorNote></div>}

          <div className="mt-4">
            {draft.state !== 'done' && (
              <div role="radiogroup" aria-label="Canal du message" className="mb-2 flex gap-1.5">
                {CHANNELS.map(c => (
                  <button key={c.id} type="button" role="radio" aria-checked={channel === c.id} onClick={() => setChannel(c.id)}
                    disabled={draft.state === 'loading'} className="px-2.5 py-1 rounded-full text-xs font-semibold disabled:opacity-50"
                    style={channel === c.id ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' } : { ...surface, color: 'var(--color-text-muted)' }}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {draft.state === 'done' ? (
              <div className="space-y-2">
                <label htmlFor="mbc-draft" className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                  Message {CHANNELS.find(c => c.id === draft.channel)?.label} (à relire){draft.channel === 'linkedin' ? ` · ${draft.text.length} / 300 caractères` : ''}
                </label>
                <textarea id="mbc-draft" value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} rows={9}
                  className="w-full rounded-xl p-3 text-sm resize-y" style={{ ...surface, color: 'var(--color-text)' }} />
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => copy('message', draft.text)} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>
                    {copied === 'message' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copier
                  </button>
                  {draft.channel === 'email' && full.email && (
                    <a href={`mailto:${full.email}?body=${encodeURIComponent(draft.text)}`} className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                      <Mail className="h-3 w-3" /> Ouvrir dans ma messagerie
                    </a>
                  )}
                  {draft.channel === 'linkedin' && full.linkedinUrl && (
                    <a href={full.linkedinUrl} target="_blank" rel="noopener noreferrer" className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                      Ouvrir LinkedIn <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <button type="button" onClick={writeDraft} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>Réécrire</button>
                  <button type="button" onClick={() => setDraft({ state: 'idle' })} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>Autre canal</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={writeDraft} disabled={draft.state === 'loading'}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ ...surface, color: 'var(--color-text)' }}>
                {draft.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                {draft.state === 'loading' ? 'Rédaction en cours…' : 'Rédiger une approche'}
              </button>
            )}
            {draft.state === 'error' && <div className="mt-2"><ErrorNote>{draft.text}</ErrorNote></div>}
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-xl p-4 text-sm" style={{ background: orangeTint(6), color: 'var(--color-text)' }}>
          {reveal?.state === 'missing' ? (
            <p>Apollo ne trouve pas le profil complet de cette personne : aucun crédit n’a été facturé pour elle.</p>
          ) : (
            <>
              <p>Révélez le profil pour voir le nom entier, l’e-mail professionnel, le LinkedIn et le parcours.</p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button type="button" onClick={onReveal} disabled={!canReveal || reveal?.state === 'loading' || save.saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-40"
                  style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                  {reveal?.state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                  Révéler · 1 crédit
                </button>
                <SaveToggle save={save} className="px-3 py-2" cost />
              </div>
            </>
          )}
        </div>
      )}

      <h3 className="mt-5 mb-2 font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 700 }}>Pourquoi {profile.score} / 100</h3>
      <dl className="space-y-1.5">
        {BREAKDOWN.map(b => (
          <div key={b.key} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
            <dt>{b.label}</dt>
            <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }} aria-hidden>
              <span className="block h-full" style={{ width: `${(profile.points[b.key] / SCORE_WEIGHTS[b.key]) * 100}%`, background: 'var(--color-brand-orange)' }} />
            </span>
            <dd className="text-right" style={{ color: 'var(--color-text-muted)' }}>{profile.points[b.key]}/{SCORE_WEIGHTS[b.key]}</dd>
          </div>
        ))}
      </dl>
      {profile.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {profile.reasons.map(r => <li key={r}>· {r}</li>)}
        </ul>
      )}

      {full && full.experiences.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 700 }}>Parcours</h3>
          <ol className="space-y-3 pl-4 ml-1.5" style={{ borderLeft: '2px solid var(--color-border)' }}>
            {full.experiences.map((e, i) => (
              <li key={`${e.title}-${e.company}-${i}`} className="relative text-sm" style={{ color: 'var(--color-text)' }}>
                <span className="absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full" aria-hidden
                  style={e.current ? { background: 'var(--color-brand-orange)' } : { background: 'var(--color-surface)', border: '2px solid var(--color-text-muted)' }} />
                <span className="font-semibold">{[e.title, e.company].filter(Boolean).join(' · ') || 'Poste'}</span>
                {period(e) && <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>{period(e)}</span>}
              </li>
            ))}
          </ol>
        </>
      )}

      <p className="mt-5 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        {full ? 'Profil complet révélé (1 crédit Apollo). ' : ''}Ni e-mail personnel ni téléphone. Un profil révélé est gardé 90 jours pour votre organisation ; enregistré, il reste dans votre liste jusqu’à ce que vous le retiriez.
      </p>
    </div>
  )
}
