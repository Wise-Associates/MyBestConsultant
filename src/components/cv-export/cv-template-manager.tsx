'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Download, FileText, Loader2, Trash2 } from 'lucide-react'
import { MAX_TEMPLATE_BYTES, TEMPLATE_TOO_LARGE } from '@/lib/cv-export/limits'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalTime } from '@/components/shared/local-time'
import { fieldLabel, primaryButton, secondaryButton } from '@/app/admin/candidats/labels'

// Bouton « Modèle CV » des deux CV Thèques (ADR 0010) : modèle Word « Format ESN » de la plateforme (CV Thèque admin) ou
// de l'organisation du recruteur, déposé avec sa cartographie, vérifié par un rendu fictif à l'enregistrement, aperçu et
// exemple téléchargeables. Les actions (passées par la page) fixent l'organisation d'après la session.

export interface CvTemplateView {
  esn: string
  uploadedAt: string
  /** Modèle Wise Associates du dépôt (plateforme sans modèle déposé). */
  builtIn: boolean
}

type Kind = 'platform' | 'organisation'

const TEXT: Record<Kind, { intro: string; removeNote: string; removed: string; urls: { preview: string; example: string } }> = {
  platform: {
    intro: 'Les exports « Format ESN » de la CV Thèque admin utilisent ce modèle Word ; sans modèle déposé, celui de Wise Associates. Joignez le modèle et sa cartographie (template_map.json), préparée pour ce fichier précis avec la skill cv-esn-anonymise.',
    removeNote: 'Les exports reviendront au modèle Wise Associates. Les versions déjà générées restent enregistrées.',
    removed: 'Modèle retiré : les exports reprennent le modèle Wise Associates.',
    urls: { preview: '/api/admin/cv-templates/sample', example: '/api/admin/cv-templates/example' },
  },
  organisation: {
    intro: 'Les exports « Format ESN » de votre organisation utilisent ce modèle Word ; tous ses recruteurs peuvent le déposer, le remplacer ou le retirer. Joignez le modèle et sa cartographie (template_map.json) : elle indique où va chaque rubrique dans ce fichier précis et se prépare avec la skill Claude cv-esn-anonymise. Si vous ne pouvez pas la produire, contactez-nous.',
    removeNote: '« Format ESN » disparaîtra de la CV Thèque de votre organisation. Les versions déjà générées restent enregistrées et redeviennent accessibles si un modèle est redéposé.',
    removed: 'Modèle retiré : « Format ESN » n\'apparaît plus sur les candidats.',
    urls: { preview: '/api/recruiter/cv-templates/sample', example: '/api/recruiter/cv-templates/example' },
  },
}

const fileInput = 'block w-full text-sm text-admin-fg file:mr-3 file:rounded-lg file:border file:border-admin-line-strong file:bg-admin-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-admin-fg hover:file:bg-admin-hover'

export function CvTemplateManager({ kind, template, storage, uploadDenied, save, remove }: {
  kind: Kind
  /** null : aucun modèle (organisation). */
  template: CvTemplateView | null
  /** false : dépôt non configuré (variables CV_TEMPLATES absentes). */
  storage: boolean
  /** Raison du refus de déposer (adresse e-mail non vérifiée) ; le retrait reste permis. */
  uploadDenied?: string | null
  save: (formData: FormData) => Promise<{ error?: string }>
  remove: () => Promise<{ error?: string }>
}) {
  const text = TEXT[kind]
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  /** Dernière action réussie, annoncée dans la fenêtre. */
  const [notice, setNotice] = useState<'saved' | 'removed' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Adresse du téléchargement en cours (aperçu ou exemple). */
  const [downloading, setDownloading] = useState<string | null>(null)
  const uploaded = template && !template.builtIn ? template : null

  /** Téléchargé par fetch : une erreur du serveur (cartographie, fichier manquant) s'affiche ici. */
  async function download(href: string, fallbackName: string) {
    setError('')
    setDownloading(href)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Téléchargement impossible (${res.status}).`)
        return
      }
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')
      const url = URL.createObjectURL(await res.blob())
      Object.assign(document.createElement('a'), { href: url, download: match?.[1] ?? fallbackName }).click()
      // Révoquée plus tard : certains navigateurs (Safari) annulent un téléchargement dont l'adresse disparaît aussitôt.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('[cv-export] téléchargement interrompu', href, err)
      setError('Téléchargement impossible : connexion interrompue, réessayez.')
    } finally {
      setDownloading(null)
    }
  }

  function close() {
    if (pending) return
    setOpen(false)
    setError('')
    setNotice(null)
    setConfirmDelete(false)
  }

  // onSubmit plutôt que <form action> : React vide le formulaire après une action, même refusée, et il faudrait
  // rechoisir les deux fichiers après chaque erreur. Vidé ici seulement après un dépôt réussi.
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setError('')
    setNotice(null)
    setConfirmDelete(false)
    // Vérifié ici aussi : au-delà de la limite des requêtes de Vercel, l'action ne serait jamais appelée.
    const docx = formData.get('template')
    if (docx instanceof File && docx.size > MAX_TEMPLATE_BYTES) {
      setError(TEMPLATE_TOO_LARGE)
      return
    }
    startTransition(async () => {
      try {
        const res = await save(formData)
        if (res.error) {
          setError(res.error)
        } else {
          setNotice('saved')
          form.reset()
        }
      } catch (err) {
        console.error('[cv-export] dépôt du modèle interrompu', err)
        setError('Dépôt interrompu : connexion perdue, réessayez.')
      }
    })
  }

  function confirmRemove() {
    setError('')
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await remove()
        if (res.error) {
          setError(res.error)
        } else {
          setConfirmDelete(false)
          setNotice('removed')
        }
      } catch (err) {
        console.error('[cv-export] retrait du modèle interrompu', err)
        setError('Retrait interrompu : connexion perdue, réessayez.')
      }
    })
  }

  const busy = pending || downloading !== null
  const errorLine = error && <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>
  // Formulaire absent (stockage non configuré, adresse non vérifiée) : l'erreur d'un téléchargement s'affiche hors de lui.
  const canUpload = storage && !uploadDenied

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-85"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: 'white' }}>
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">
          {template ? `Modèle CV : ${template.esn}${template.builtIn ? ' (par défaut)' : ''}` : 'Ajouter votre modèle CV'}
        </span>
      </button>

      <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
        <DialogContent className="admin-light sm:max-w-130 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--admin-panel)' }} showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>Modèle CV « Format ESN »</DialogTitle>
            <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>{text.intro}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-line p-3">
            <p className="min-w-50 flex-1 text-xs text-admin-fg-muted">
              Point de départ : un modèle d&apos;exemple et son template_map.json, à adapter, ou à déposer tel quel pour un essai.
            </p>
            <button type="button" onClick={() => download(text.urls.example, 'modele-cv-exemple.zip')} disabled={busy}
              style={{ ...secondaryButton, fontSize: 13 }}>
              {downloading === text.urls.example ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
              Télécharger l&apos;exemple (.zip)
            </button>
          </div>

          {template ? (
            <div className="grid gap-2 rounded-lg border border-admin-line p-3">
              <p className="text-sm text-admin-fg">
                <span className="font-semibold">{template.esn}</span>
                {uploaded ? <>, déposé le <LocalTime iso={uploaded.uploadedAt} /></> : ', modèle par défaut'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => download(text.urls.preview, 'apercu-modele.zip')} disabled={busy} style={{ ...secondaryButton, fontSize: 13 }}>
                  {downloading === text.urls.preview ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
                  Télécharger un aperçu (candidat fictif)
                </button>
                {uploaded && storage && (
                  // Désactivé pendant la confirmation, qui s'affiche dessous : un double clic ne retire pas le modèle.
                  <button type="button" onClick={() => { setConfirmDelete(true); setNotice(null) }} disabled={busy || confirmDelete} style={{ ...secondaryButton, fontSize: 13 }}>
                    <Trash2 size={14} aria-hidden /> Retirer
                  </button>
                )}
              </div>
              {confirmDelete && (
                <div className="grid gap-2 rounded-lg border border-admin-line-strong p-3">
                  <p className="text-xs text-admin-fg-muted">{text.removeNote}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfirmDelete(false)} disabled={pending} style={{ ...secondaryButton, fontSize: 13 }}>Annuler</button>
                    <button type="button" onClick={confirmRemove} disabled={busy}
                      style={{ ...secondaryButton, fontSize: 13, background: '#b91c1c', borderColor: '#b91c1c', color: 'white' }}>
                      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
                      Confirmer le retrait
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-admin-fg-muted">Aucun modèle : « Format ESN » apparaîtra sur les candidats une fois le modèle déposé.</p>
          )}

          <div aria-live="polite">
            {notice && (
              <p className="flex items-start gap-2 text-sm" style={{ color: '#047857' }}>
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
                {notice === 'saved' ? 'Modèle enregistré : téléchargez l\'aperçu pour vérifier la mise en page.' : text.removed}
              </p>
            )}
          </div>

          {!canUpload ? (
            <>
              <p className="text-sm" style={{ color: '#b45309' }}>
                {storage ? uploadDenied : 'Dépôt des modèles non configuré : APPWRITE_COLLECTION_CV_TEMPLATES et APPWRITE_STORAGE_CV_TEMPLATES (npm run cv-export:setup).'}
              </p>
              {errorLine}
            </>
          ) : (
            <form onSubmit={submit} className="grid gap-3">
              <label className="grid gap-1.5">
                <span style={fieldLabel}>{uploaded ? 'Nouveau modèle Word (.docx)' : 'Modèle Word (.docx)'}</span>
                <input type="file" name="template" required accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className={fileInput} disabled={pending} />
              </label>
              <label className="grid gap-1.5">
                <span style={fieldLabel}>Cartographie (template_map.json)</span>
                <input type="file" name="map" required accept=".json,application/json" className={fileInput} disabled={pending} />
              </label>
              <p className="text-xs text-admin-fg-muted">
                Le modèle est vérifié en y rendant un candidat fictif, en français et en anglais : il n&apos;est enregistré que si les deux rendus réussissent.
              </p>
              {errorLine}
              <DialogFooter>
                <button type="button" onClick={close} disabled={pending} style={{ ...secondaryButton, justifyContent: 'center' }}>Fermer</button>
                <button type="submit" disabled={pending} style={{ ...primaryButton, justifyContent: 'center', opacity: pending ? 0.7 : 1 }}>
                  {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {pending ? 'Vérification…' : uploaded ? 'Vérifier et remplacer' : 'Vérifier et enregistrer'}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
