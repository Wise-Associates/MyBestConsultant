'use client'

import { useState } from 'react'
import { Bookmark, Check, Copy, ExternalLink, Globe, Loader2, Mail, MapPin, MessageSquareText, Plus, UserRound, X } from 'lucide-react'
import { addMbcProfileToVivier } from '@/app/recruiter/vivier/actions'
import { draftMbcOutreach } from './actions'
import { SCORE_WEIGHTS, type MbcCriteria, type MbcRevealed, type ScoredProfile } from '@/lib/mbc-search/rules'
import { Avatar, ErrorNote, orangeTint, surface, type Reveal, type SaveButton } from './mbc-search-ui'

// Panneau du profil choisi dans la liste : score détaillé, puis, une fois révélé, coordonnées, parcours et suites
// (vivier, offre, message d'approche). Colonne de droite sur grand écran, fenêtre plein écran en dessous.

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

export function ProfilePanel({ profile, reveal, criteria, brief, jobs, save, added, canReveal, onReveal, onAdded, onClose }: {
  profile: ScoredProfile
  reveal?: Reveal
  criteria: MbcCriteria
  brief: string
  jobs: { id: string; title: string }[] | null
  save: SaveButton
  added: Added
  canReveal: boolean
  onReveal: () => void
  onAdded: (target: string) => void
  onClose: () => void
}) {
  const full = reveal?.state === 'done' ? reveal.profile : null
  const name = full?.name || [profile.firstName, profile.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  const [copied, setCopied] = useState<'email' | 'message' | null>(null)
  const [jobId, setJobId] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [addNote, setAddNote] = useState<{ ok: boolean; text: string; href?: string } | null>(null)
  const [draft, setDraft] = useState<{ state: 'idle' | 'loading' } | { state: 'done'; text: string } | { state: 'error'; text: string }>({ state: 'idle' })

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
    setDraft({ state: 'loading' })
    try {
      const res = await draftMbcOutreach({
        brief, criteria,
        person: {
          firstName: full.name.split(/\s+/)[0] ?? '', title: full.title, company: full.company,
          experiences: full.experiences.map(e => ({ title: e.title, company: e.company })),
        },
      })
      setDraft(res.message ? { state: 'done', text: res.message } : { state: 'error', text: res.error ?? 'Message indisponible.' })
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
        <button type="button" onClick={onClose} aria-label="Fermer le profil" className="lg:hidden rounded-lg p-1.5" style={{ color: 'var(--color-text)' }}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {full ? (
        <>
          <div className="mt-4 grid gap-2">
            {full.email ? (
              <ContactRow label={full.emailStatus === 'verified' ? 'E-mail ✓' : 'E-mail'} value={full.email}>
                <button type="button" onClick={() => copy('email', full.email)} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>
                  {copied === 'email' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copier
                </button>
              </ContactRow>
            ) : <ContactRow label="E-mail" value="Aucun e-mail professionnel connu" />}
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

          <div className="mt-4">
            {draft.state === 'done' ? (
              <div className="space-y-2">
                <label htmlFor="mbc-draft" className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Message d’approche (à relire)</label>
                <textarea id="mbc-draft" value={draft.text} onChange={e => setDraft({ state: 'done', text: e.target.value })} rows={9}
                  className="w-full rounded-xl p-3 text-sm resize-y" style={{ ...surface, color: 'var(--color-text)' }} />
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => copy('message', draft.text)} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>
                    {copied === 'message' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copier
                  </button>
                  {full.email && (
                    <a href={`mailto:${full.email}?body=${encodeURIComponent(draft.text)}`} className={`${smallBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}>
                      <Mail className="h-3 w-3" /> Ouvrir dans ma messagerie
                    </a>
                  )}
                  <button type="button" onClick={writeDraft} className={smallBtn} style={{ ...surface, color: 'var(--color-text)' }}>Réécrire</button>
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
