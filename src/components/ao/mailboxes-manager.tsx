'use client'

import { useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, Inbox, Loader2, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import type { MailboxView, MailboxTest } from '@/lib/ao/mailboxes'

// Boîtes de réception d'appels d'offres : liste, ajout, modification, test de connexion. Même composant pour les
// recruteurs d'une organisation (espace recruteur) et pour la plateforme (admin) : les actions serveur reçues en
// propriétés portent chacune leur contrôle d'accès. Couleurs : tokens de l'admin clair s'ils existent (page admin),
// sinon ceux du site (espace recruteur).

export interface MailboxActions {
  test: (input: MailboxForm, id: string | null) => Promise<MailboxTest>
  save: (input: MailboxForm, id: string | null) => Promise<{ mailbox?: MailboxView; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ mailbox?: MailboxView; error?: string }>
  remove: (id: string) => Promise<{ error?: string }>
}

export interface MailboxForm {
  label: string
  host: string
  username: string
  password: string
  mailbox: string
  ownDomains: string
}

const C = {
  surface: 'var(--admin-panel, var(--color-surface))',
  field: 'var(--admin-panel-raised, var(--color-background))',
  border: 'var(--admin-line, var(--color-border))',
  text: 'var(--admin-fg, var(--color-text))',
  muted: 'var(--admin-fg-muted, var(--color-text-muted))',
  primary: 'var(--color-primary)',
  ok: '#047857',
  error: '#b91c1c',
}
const inputCls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-1'
const inputStyle = { background: C.field, border: `1px solid ${C.border}`, color: C.text } as const
const buttonCls = 'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1'

// Serveurs IMAP courants, proposés à la saisie ; le serveur est déduit de l'adresse pour les messageries connues.
const KNOWN_HOSTS: [RegExp, string][] = [
  [/@(gmail|googlemail)\.com$/, 'imap.gmail.com'],
  [/@(outlook|hotmail|live|msn)\.[a-z.]+$/, 'outlook.office365.com'],
  [/@yahoo\.[a-z.]+$/, 'imap.mail.yahoo.com'],
]
const SUGGESTED_HOSTS = ['imap.gmail.com', 'outlook.office365.com', 'imap.ionos.fr', 'ssl0.ovh.net', 'imap.mail.yahoo.com']

const emptyForm: MailboxForm = { label: '', host: '', username: '', password: '', mailbox: 'INBOX', ownDomains: '' }
const formOf = (m: MailboxView): MailboxForm => ({ label: m.label, host: m.host, username: m.username, password: '', mailbox: m.mailbox, ownDomains: m.ownDomains.join(', ') })

function since(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 1440) return `il y a ${Math.round(minutes / 60)} h`
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}

export function MailboxesManager({ initial, actions }: { initial: MailboxView[]; actions: MailboxActions }) {
  const [mailboxes, setMailboxes] = useState(initial)
  // null : formulaire fermé ; 'new' : ajout ; sinon identifiant de la boîte modifiée.
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<MailboxForm>(emptyForm)
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [listError, setListError] = useState('')
  const [pending, startTransition] = useTransition()

  const open = (id: string | null) => {
    const current = id ? mailboxes.find(m => m.id === id) : null
    setForm(current ? formOf(current) : emptyForm)
    setEditing(id ?? 'new')
    setResult(null)
  }
  const field = <K extends keyof MailboxForm>(key: K, value: MailboxForm[K]) => setForm(f => {
    const next = { ...f, [key]: value }
    // Serveur déduit de l'adresse pour Gmail, Outlook, Yahoo, tant que l'utilisateur ne l'a pas saisi lui-même.
    if (key === 'username' && (!f.host || KNOWN_HOSTS.some(([, h]) => h === f.host))) {
      next.host = KNOWN_HOSTS.find(([re]) => re.test(String(value).trim().toLowerCase()))?.[1] ?? f.host
    }
    return next
  })
  const id = editing === 'new' ? null : editing

  const test = () => startTransition(async () => {
    setResult(null)
    const r = await actions.test(form, id)
    setResult(r.ok
      ? { tone: 'ok', text: `Connexion réussie : ${r.messages.toLocaleString('fr-FR')} message${r.messages > 1 ? 's' : ''} dans ${form.mailbox || 'INBOX'}.` }
      : { tone: 'error', text: r.error })
  })
  const save = () => startTransition(async () => {
    setResult(null)
    const r = await actions.save(form, id)
    if (!r.mailbox) return setResult({ tone: 'error', text: r.error ?? 'Enregistrement impossible.' })
    const saved = r.mailbox
    setMailboxes(list => (id ? list.map(m => (m.id === id ? saved : m)) : [...list, saved]))
    setEditing(null)
  })
  const toggle = (m: MailboxView) => startTransition(async () => {
    setListError('')
    const r = await actions.setEnabled(m.id, !m.enabled)
    if (r.mailbox) setMailboxes(list => list.map(x => (x.id === m.id ? r.mailbox! : x)))
    else setListError(r.error ?? 'Modification impossible.')
  })
  const remove = (m: MailboxView) => startTransition(async () => {
    setListError('')
    const r = await actions.remove(m.id)
    if (r.error) return setListError(r.error)
    setMailboxes(list => list.filter(x => x.id !== m.id))
    setConfirmDelete(null)
  })

  return (
    <section className="rounded-3xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      <div className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
        <h2 className="font-bold" style={{ color: C.text, fontSize: '1rem' }}>Boîtes de réception ({mailboxes.length})</h2>
        {editing === null && (
          <button type="button" onClick={() => open(null)} className={buttonCls} style={{ background: C.primary, color: 'white' }}>
            <Plus className="h-4 w-4" /> Ajouter une boîte
          </button>
        )}
      </div>

      {listError && <Notice tone="error" text={listError} />}

      {mailboxes.length === 0 && editing === null && (
        <div className="px-6 py-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-3" style={{ color: C.muted }} />
          <p className="text-sm" style={{ color: C.muted }}>
            Aucune boîte. Ajoutez celle où vous recevez les appels d’offres, quelle que soit son adresse : ses e-mails seront lus automatiquement.
          </p>
        </div>
      )}

      <ul>
        {mailboxes.map(m => (
          <li key={m.id} className="px-5 sm:px-6 py-4 flex items-start gap-4 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm break-all" style={{ color: C.text }}>{m.label}</p>
                <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ color: m.enabled ? C.ok : C.muted, background: C.field }}>
                  {m.enabled ? 'Active' : 'Désactivée'}
                </span>
              </div>
              <p className="text-xs mt-1 break-all" style={{ color: C.muted }}>{m.username} · {m.host} · dossier {m.mailbox}</p>
              {m.lastError ? (
                <p className="text-xs mt-1.5 flex items-start gap-1.5" style={{ color: C.error }}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" /> {m.lastError}{m.lastSyncAt ? ` (${since(m.lastSyncAt)})` : ''}
                </p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: C.muted }}>{m.lastSyncAt ? `Dernière lecture ${since(m.lastSyncAt)}` : 'Pas encore lue : la première lecture a lieu au prochain passage automatique.'}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => open(m.id)} disabled={pending} className={buttonCls} style={{ border: `1px solid ${C.border}`, color: C.text }}>
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </button>
              <button type="button" onClick={() => toggle(m)} disabled={pending} className={buttonCls} style={{ border: `1px solid ${C.border}`, color: C.text }}>
                <Power className="h-3.5 w-3.5" /> {m.enabled ? 'Désactiver' : 'Activer'}
              </button>
              {confirmDelete === m.id ? (
                <button type="button" onClick={() => remove(m)} disabled={pending} className={buttonCls} style={{ background: C.error, color: 'white' }}>
                  <Trash2 className="h-3.5 w-3.5" /> Confirmer la suppression
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(m.id)} disabled={pending} className={buttonCls} style={{ border: `1px solid ${C.border}`, color: C.error }}>
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing !== null && (
        <form className="px-5 sm:px-6 py-5 space-y-4" onSubmit={e => { e.preventDefault(); save() }} aria-label={id ? 'Modifier la boîte' : 'Ajouter une boîte'}>
          <h3 className="font-semibold text-sm" style={{ color: C.text }}>{id ? 'Modifier la boîte' : 'Nouvelle boîte'}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Adresse ou identifiant de connexion" hint="Souvent l’adresse e-mail de la boîte, par exemple recrutement@votre-entreprise.fr.">
              <input className={inputCls} style={inputStyle} value={form.username} onChange={e => field('username', e.target.value)} autoComplete="off" required />
            </Field>
            <Field label="Mot de passe" hint={id ? 'Laisser vide pour garder le mot de passe enregistré (à ressaisir si le serveur ou l’identifiant change).' : 'Gmail, Outlook : un mot de passe d’application. Enregistré chiffré, jamais réaffiché.'}>
              <input className={inputCls} style={inputStyle} type="password" value={form.password} onChange={e => field('password', e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Serveur IMAP" hint="Port 993 (IMAP sécurisé). Gmail : imap.gmail.com · Outlook / Microsoft 365 : outlook.office365.com · IONOS : imap.ionos.fr · OVH : ssl0.ovh.net.">
              <input className={inputCls} style={inputStyle} value={form.host} onChange={e => field('host', e.target.value)} list="ao-imap-hosts" autoComplete="off" required />
              <datalist id="ao-imap-hosts">{SUGGESTED_HOSTS.map(h => <option key={h} value={h} />)}</datalist>
            </Field>
            <Field label="Dossier lu" hint="INBOX pour la boîte de réception. Lu en lecture seule : aucun e-mail n’est modifié ni supprimé.">
              <input className={inputCls} style={inputStyle} value={form.mailbox} onChange={e => field('mailbox', e.target.value)} />
            </Field>
            <Field label="Nom affiché (facultatif)" hint="Par défaut, l’adresse de la boîte.">
              <input className={inputCls} style={inputStyle} value={form.label} onChange={e => field('label', e.target.value)} />
            </Field>
            <Field label="Domaines de votre organisation" hint="Séparés par des virgules ; par défaut, celui de l’adresse. Un appel d’offres transféré depuis ces domaines est attribué à son expéditeur d’origine.">
              <input className={inputCls} style={inputStyle} value={form.ownDomains} onChange={e => field('ownDomains', e.target.value)} placeholder="votre-entreprise.fr" />
            </Field>
          </div>

          <div aria-live="polite">{result && <Notice tone={result.tone} text={result.text} />}</div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={test} disabled={pending} className={buttonCls} style={{ border: `1px solid ${C.border}`, color: C.text }}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Tester la connexion
            </button>
            <button type="submit" disabled={pending} className={buttonCls} style={{ background: C.primary, color: 'white' }}>
              Enregistrer
            </button>
            <button type="button" onClick={() => setEditing(null)} disabled={pending} className={buttonCls} style={{ color: C.muted }}>
              Annuler
            </button>
            <p className="text-xs" style={{ color: C.muted }}>« Enregistrer » teste d’abord la connexion : la boîte n’est enregistrée que si elle répond.</p>
          </div>
        </form>
      )}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium" style={{ color: C.text }}>{label}</span>
      {children}
      <span className="block text-xs" style={{ color: C.muted }}>{hint}</span>
    </label>
  )
}

function Notice({ tone, text }: { tone: 'ok' | 'error'; text: string }) {
  const color = tone === 'ok' ? C.ok : C.error
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className="mx-5 sm:mx-0 my-3 flex items-start gap-2 text-sm p-3 rounded-xl" style={{ color, background: C.field, border: `1px solid ${C.border}` }}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" /> {text}
    </p>
  )
}
