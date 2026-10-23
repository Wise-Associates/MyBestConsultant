'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileDown, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalTime } from '@/components/shared/local-time'
import { fieldLabel, primaryButton, secondaryButton } from '@/app/admin/candidats/labels'
import { LANGS_OF, initialChoice, storedFor, type CvExportVersion, type LangChoice } from '@/lib/cv-export/stored'
import type { AnonymizationMode } from '@/lib/cv-export/types'

// Export d'un candidat au format de l'ESN, partagé par la CV Thèque admin (modèle de la plateforme, route
// /api/admin/cv-export) et celle des recruteurs (modèle de leur organisation, /api/recruiter/cv-export) : chaque page
// fournit sa route et la lecture de ses versions enregistrées. POST génère et enregistre (1 à 3 min d'IA), GET
// retélécharge la version enregistrée. Téléchargé par fetch : une erreur (IA indisponible, fuite détectée…) s'affiche
// ici au lieu d'être enregistrée en fichier.

type SaveStatus = 'saved' | 'failed' | 'off'
type Stored = { versions: CvExportVersion[]; storage: boolean; error?: string }

const LANG_OPTIONS: { value: LangChoice; label: string; hint: string }[] = [
  { value: 'both', label: 'Français + anglais', hint: 'Deux fichiers Word dans un .zip' },
  { value: 'fr', label: 'Français', hint: 'Un fichier Word' },
  { value: 'en', label: 'Anglais', hint: 'Un fichier Word' },
]

const MODE_OPTIONS: { value: AnonymizationMode; label: string; hint: string }[] = [
  {
    value: 'standard', label: 'Standard',
    hint: 'Nom, coordonnées, liens et photo retirés. Clients, dates et intitulés restent visibles : le candidat peut être retrouvé sur LinkedIn.',
  },
  {
    value: 'renforcee', label: 'Renforcée',
    hint: 'Clients et employeurs remplacés aussi par une description (« Grande banque française »), pour que le client ne contacte pas le candidat en direct.',
  },
]

const LANG_LABEL = { fr: 'Français', en: 'Anglais' } as const

function fileNameOf(res: Response): string {
  const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '')
  if (match) return decodeURIComponent(match[1])
  return res.headers.get('Content-Type')?.includes('zip') ? 'cv-format-esn.zip' : 'cv-format-esn.docx'
}

/** Compte rendu de la route ; null s'il est illisible (le fichier, lui, est téléchargé). */
function notesOf(res: Response): string[] | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(res.headers.get('X-Cv-Export-Notes') ?? '%5B%5D'))
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : null
  } catch (err) {
    console.error('[cv-export] compte rendu illisible', err)
    return null
  }
}

async function fetchVersions(loadVersions: (candidateId: string) => Promise<Stored>, candidateId: string): Promise<Stored> {
  try {
    return await loadVersions(candidateId)
  } catch (err) {
    console.error('[cv-export] lecture des versions enregistrées impossible', err)
    return { versions: [], storage: true, error: 'Versions enregistrées illisibles : connexion interrompue.' }
  }
}

function ChoiceGroup<T extends string>({ legend, name, options, value, onChange, disabled }: {
  legend: string
  name: string
  options: { value: T; label: string; hint: string }[]
  value: T
  onChange: (value: T) => void
  disabled: boolean
}) {
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <legend style={{ ...fieldLabel, marginBottom: 8 }}>{legend}</legend>
      {options.map(option => (
        <label key={option.value}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-admin-line-strong px-3 py-2.5 transition-colors hover:bg-admin-hover has-checked:border-admin-fg has-checked:bg-admin-panel-raised has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-admin-fg">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}
            className="mt-0.5 size-4 shrink-0 accent-admin-fg" />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-admin-fg">{option.label}</span>
            <span className="text-xs text-admin-fg-muted">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Version enregistrée pour le choix en cours (ou son absence), avant les boutons. */
function SavedStatus({ stored, saved, onRetry }: { stored: Stored | null; saved: CvExportVersion[] | null; onRetry: () => void }) {
  if (!stored) {
    return (
      <p className="flex items-center gap-2 text-sm text-admin-fg-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Recherche d&apos;une version enregistrée…
      </p>
    )
  }
  if (stored.error) {
    return (
      <p className="text-sm" style={{ color: '#b45309' }}>
        {stored.error}{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">Réessayer</button>
        {' '}avant de générer un nouvel export : une version est peut-être déjà enregistrée.
      </p>
    )
  }
  if (!stored.storage) {
    return <p className="text-sm text-admin-fg-muted">Enregistrement des exports non configuré : chaque export est régénéré par l&apos;IA.</p>
  }
  if (!saved) {
    return <p className="text-sm text-admin-fg-muted">Aucune version enregistrée pour ce choix : elle sera générée (1 à 3 minutes), puis enregistrée.</p>
  }
  return (
    <div className="grid gap-1.5 rounded-lg border border-admin-line p-3">
      <p className="text-sm font-semibold text-admin-fg">Version enregistrée</p>
      <ul className="grid gap-0.5 text-xs text-admin-fg-muted">
        {saved.map(v => <li key={v.lang}>{LANG_LABEL[v.lang]} : générée le <LocalTime iso={v.generatedAt} /></li>)}
      </ul>
      {saved.some(v => v.stale) && (
        <p className="flex items-start gap-2 text-xs" style={{ color: '#b45309' }}>
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
          {saved.some(v => v.stale === 'cv')
            ? 'Le candidat a remplacé son CV depuis : générez une nouvelle version pour en tenir compte.'
            : 'Le modèle Word a été remplacé depuis : générez une nouvelle version pour l\'utiliser.'}
        </p>
      )}
    </div>
  )
}

export interface EsnExportDialogProps {
  candidate: { id: string; name: string } | null
  onClose: () => void
  /** Route d'export de la page, sans l'identifiant du candidat (« /api/admin/cv-export »). */
  endpoint: string
  /** Action serveur de la page qui lit les versions enregistrées de son organisation. */
  loadVersions: (candidateId: string) => Promise<Stored>
  /** ESN du modèle utilisé, affiché dans la fenêtre. */
  esn: string
  /** Raison pour laquelle la génération est refusée (abonnement, adresse e-mail) ; les versions enregistrées restent téléchargeables. */
  generationDenied?: string | null
  /**
   * Générations comptées dans un quota (recruteurs) : pas de génération tant que les versions enregistrées sont
   * illisibles, elle referait peut-être une version qui existe déjà.
   */
  quotaLimited?: boolean
}

/** Fenêtre « Format ESN » d'un candidat : choix des langues et de l'anonymisation, téléchargement ou génération. */
export function EsnExportDialog({ candidate, onClose, endpoint, loadVersions, esn, generationDenied, quotaLimited }: EsnExportDialogProps) {
  const candidateId = candidate?.id
  const [stored, setStored] = useState<Stored | null>(null)
  // Choix de l'admin ; tant qu'il n'a rien choisi, celui de la dernière version enregistrée.
  const [picked, setPicked] = useState<{ langs: LangChoice; mode: AnonymizationMode } | null>(null)
  const [busy, setBusy] = useState<'generate' | 'download' | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ fileName: string; notes: string[] | null; saved?: SaveStatus } | null>(null)
  const doneRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!candidateId) return
    let cancelled = false
    void fetchVersions(loadVersions, candidateId).then(result => { if (!cancelled) setStored(result) })
    return () => { cancelled = true }
  }, [candidateId, loadVersions])

  // Sur mobile, le compte rendu et l'erreur apparaissent sous les choix, hors de l'écran : amenés à la vue une fois,
  // à leur arrivée (pas à chaque rendu, l'admin peut remonter changer un choix).
  useEffect(() => { doneRef.current?.scrollIntoView({ block: 'nearest' }) }, [done])
  useEffect(() => { errorRef.current?.scrollIntoView({ block: 'nearest' }) }, [error])

  async function retryVersions() {
    if (!candidateId) return
    setStored(null)
    setStored(await fetchVersions(loadVersions, candidateId))
  }

  const choice = picked ?? initialChoice(stored?.versions ?? [])
  const saved = stored ? storedFor(stored.versions, choice.mode, LANGS_OF[choice.langs]) : null
  const stale = saved?.some(v => v.stale) ?? false

  /** Télécharge la réponse de la route ; null (et message affiché) si elle est en erreur. */
  async function deliver(res: Response): Promise<{ fileName: string; notes: string[] | null } | null> {
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? (res.status === 504
        ? 'Délai dépassé : la génération a pris plus de 5 minutes. Réessayez, ou exportez une seule langue.'
        : `Export impossible (${res.status}). Réessayez.`))
      return null
    }
    const fileName = fileNameOf(res)
    const url = URL.createObjectURL(await res.blob())
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName })
    link.click()
    // Révoquée plus tard : certains navigateurs (Safari) annulent un téléchargement dont l'adresse disparaît aussitôt.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { fileName, notes: notesOf(res) }
  }

  async function run(kind: 'generate' | 'download') {
    if (!candidateId) return
    setPicked(choice)
    setBusy(kind)
    setError('')
    setDone(null)
    const url = `${endpoint}/${encodeURIComponent(candidateId)}`
    try {
      if (kind === 'download') {
        const query = new URLSearchParams([['mode', choice.mode], ...LANGS_OF[choice.langs].map(lang => ['lang', lang])])
        const file = await deliver(await fetch(`${url}?${query}`))
        if (file) setDone(file)
        return
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ langs: LANGS_OF[choice.langs], mode: choice.mode }),
      })
      const file = await deliver(res)
      if (!file) return
      const status = res.headers.get('X-Cv-Export-Saved')
      setDone({ ...file, saved: status === 'saved' || status === 'failed' ? status : 'off' })
      // Même en échec : une partie a pu être enregistrée (une langue sur deux), la fenêtre affiche ce qui l'est.
      if (status === 'saved' || status === 'failed') setStored(await fetchVersions(loadVersions, candidateId))
    } catch (err) {
      console.error('[cv-export] export interrompu', err)
      if (kind === 'generate') {
        // Le serveur a peut-être terminé et enregistré la version : la relire évite de la payer une seconde fois.
        setError('Connexion interrompue pendant la génération : la version a peut-être été enregistrée, vérifiez ci-dessus avant de relancer.')
        setStored(await fetchVersions(loadVersions, candidateId))
      } else {
        setError(err instanceof TypeError
          ? 'Téléchargement impossible : connexion interrompue, réessayez.'
          : 'Téléchargement impossible : erreur inattendue dans la page. Rechargez-la et réessayez.')
      }
    } finally {
      setBusy(null)
    }
  }

  const generateButton = {
    kind: 'generate' as const, Icon: FileDown,
    label: busy === 'generate' ? 'Génération…' : saved ? 'Générer une nouvelle version' : 'Générer et télécharger',
  }
  const downloadButton = {
    kind: 'download' as const, Icon: Download,
    label: busy === 'download' ? 'Téléchargement…' : stale ? 'Télécharger l\'ancienne version' : 'Télécharger',
  }
  // Version à jour : la télécharger est l'action principale ; CV remplacé depuis : la régénérer.
  const [secondary, primary] = !saved ? [null, generateButton] : stale ? [downloadButton, generateButton] : [generateButton, downloadButton]
  // Pendant la recherche des versions, aucune action : « Générer » lancerait l'IA alors qu'une version existe peut-être.
  const locked = busy !== null || stored === null
  const actionButton = (action: typeof generateButton | typeof downloadButton, isPrimary: boolean) => {
    const disabled = locked || (action.kind === 'generate' && (!!generationDenied || (!!quotaLimited && !!stored?.error)))
    return (
    <button type="button" onClick={() => run(action.kind)} disabled={disabled}
      style={{ ...(isPrimary ? primaryButton : secondaryButton), justifyContent: 'center', opacity: disabled ? 0.7 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      {busy === action.kind ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <action.Icon size={15} aria-hidden />}
      {action.label}
    </button>
    )
  }

  return (
    <Dialog open={candidate !== null} onOpenChange={open => { if (!open && !busy) onClose() }}>
      {candidate && (
        <DialogContent className="admin-light sm:max-w-[520px] max-h-[90vh] overflow-y-auto" style={{ background: 'var(--admin-panel)' }} showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>Exporter au format ESN</DialogTitle>
            <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>
              Dossier de compétences anonymisé de {candidate.name || 'ce candidat'}, dans le modèle {esn} (Word, modifiable).
            </DialogDescription>
          </DialogHeader>

          <ChoiceGroup legend="Langues" name="esn-langs" options={LANG_OPTIONS} value={choice.langs}
            onChange={langs => setPicked({ ...choice, langs })} disabled={busy !== null} />
          <ChoiceGroup legend="Anonymisation" name="esn-mode" options={MODE_OPTIONS} value={choice.mode}
            onChange={mode => setPicked({ ...choice, mode })} disabled={busy !== null} />

          <SavedStatus stored={stored} saved={saved} onRetry={retryVersions} />
          {generationDenied && <p className="text-sm" style={{ color: '#b45309' }}>{generationDenied}</p>}

          <div aria-live="polite" className="grid gap-2">
            {busy === 'generate' && (
              <p className="text-sm text-admin-fg-muted">
                Génération en cours, 1 à 3 minutes : l&apos;IA lit le CV, l&apos;anonymise{choice.langs === 'both' ? ' et le traduit' : ''}. Gardez cette fenêtre ouverte.
              </p>
            )}
            {done && (
              <div ref={doneRef} className="grid gap-2 rounded-lg border border-admin-line p-3">
                <p className="flex items-start gap-2 text-sm font-semibold" style={{ color: '#047857' }}>
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span className="break-all">Téléchargement lancé : {done.fileName}</span>
                </p>
                {done.saved === 'saved' && (
                  <p className="text-xs text-admin-fg-muted">Version enregistrée : la prochaine fois, téléchargez-la sans la régénérer.</p>
                )}
                {done.saved === 'failed' && (
                  <p className="text-xs" style={{ color: '#b45309' }}>Enregistrement impossible ou incomplet : gardez ce fichier. Ce qui est enregistré est indiqué ci-dessus.</p>
                )}
                {done.notes === null ? (
                  <p className="text-xs" style={{ color: '#b45309' }}>Compte rendu indisponible : relisez tout le document, des champs « [À COMPLÉTER] » peuvent rester.</p>
                ) : done.notes.length > 0 && (
                  <ul className="grid list-disc gap-1 pl-5 text-xs text-admin-fg-muted">
                    {done.notes.map(note => <li key={note}>{note}</li>)}
                  </ul>
                )}
                <p className="text-xs text-admin-fg-muted">Relisez le document dans Word avant de l&apos;envoyer : titre, dates, clients et mise en page.</p>
              </div>
            )}
          </div>
          {error && <p ref={errorRef} role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}

          <DialogFooter>
            <button type="button" onClick={onClose} disabled={busy !== null} style={{ ...secondaryButton, justifyContent: 'center' }}>{done ? 'Fermer' : 'Annuler'}</button>
            {secondary && actionButton(secondary, false)}
            {actionButton(primary, true)}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
