'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, X, Loader2, Sparkles, RefreshCw, Library, ChevronDown, PencilLine, FileUp } from 'lucide-react'
import { createJobAction, listMyJobsForLibrary } from './actions'
import { generateJobDraft, improveJobDraft, type JobDraft } from './ai-job-draft-actions'
import { ImportPanel } from './import-panel'
import type { Job } from '@/types'

export function CreateJobDialog({ tenantId, companyName, variant = 'button' }: { tenantId: string; companyName: string; variant?: 'button' | 'tile' }) {
  const searchParams = useSearchParams()
  // Le CTA "Déposer une offre" de la page d'accueil renvoie ici avec ce paramètre pour
  // ouvrir directement la saisie manuelle, au lieu de laisser le recruteur la chercher.
  const router = useRouter()
  const [open, setOpen] = useState(() => searchParams.get('openCreateJob') === '1')
  // Deux façons de publier dans la même fenêtre : saisie manuelle (avec l'assistant de rédaction) ou import IA / Excel.
  const [tab, setTab] = useState<'manual' | 'import'>(() => (searchParams.get('tab') === 'import' ? 'import' : 'manual'))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  // AI assistant — pré-remplit titre/description/compétences, le recruteur garde la main
  // pour ajuster avant publication (rien n'est publié automatiquement par l'IA).
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiError, setAiError] = useState('')
  const [isGenerating, startGenerating] = useTransition()
  const [lastDraft, setLastDraft] = useState<JobDraft | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState('')
  const [location, setLocation] = useState('')
  const [contractType, setContractType] = useState('')
  const [remote, setRemote] = useState('')
  const [salary, setSalary] = useState('')

  // Bibliothèque des anciennes offres — importer une offre déjà publiée comme point de
  // départ, à corriger à la main ou à retravailler ensuite avec l'IA.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryJobs, setLibraryJobs] = useState<Job[] | null>(null)
  const [isLoadingLibrary, startLoadingLibrary] = useTransition()

  const hasDraftContent = title.trim().length > 0 || description.trim().length > 0

  function openLibrary() {
    setLibraryOpen(v => !v)
    if (libraryJobs === null) {
      startLoadingLibrary(async () => {
        setLibraryJobs(await listMyJobsForLibrary())
      })
    }
  }

  function applyDraft(draft: JobDraft) {
    setTitle(draft.title)
    setDescription(draft.description)
    setSkills(draft.skills.join(', '))
    setLocation(draft.location)
    setContractType(draft.contractType)
    setRemote(draft.remote)
    setSalary(draft.salary != null ? String(draft.salary) : '')
    setLastDraft(draft)
  }

  function importFromLibrary(job: Job) {
    applyDraft({
      title: job.title,
      description: job.description,
      skills: job.skills,
      location: job.location,
      contractType: job.contractType ?? '',
      remote: job.remote ?? '',
      salary: job.salary ?? null,
    })
    setLibraryOpen(false)
  }

  function generate() {
    setAiError('')
    startGenerating(async () => {
      const result = await generateJobDraft(aiPrompt, lastDraft ?? undefined)
      if ('error' in result) { setAiError(result.error); return }
      applyDraft(result.draft)
    })
  }

  function improve() {
    setAiError('')
    startGenerating(async () => {
      const current: JobDraft = {
        title, description,
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
        location,
        contractType: contractType as JobDraft['contractType'],
        remote: remote as JobDraft['remote'],
        salary: salary ? Number(salary) : null,
      }
      const result = await improveJobDraft(aiPrompt, current)
      if ('error' in result) { setAiError(result.error); return }
      applyDraft(result.draft)
    })
  }

  function submit(formData: FormData) {
    setError('')
    startTransition(async () => {
      const result = await createJobAction(formData)
      if (result.error) {
        setError(result.error)
      } else {
        setOpen(false)
        formRef.current?.reset()
        setTitle(''); setDescription(''); setSkills('')
        setLocation(''); setContractType(''); setRemote(''); setSalary('')
        setAiPrompt(''); setLastDraft(null); setAiError(''); setLibraryOpen(false)
      }
    })
  }

  const inp = 'w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors'
  const inpStyle = {
    background: 'rgba(0,0,0,0.03)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  return (
    <>
      {variant === 'tile' ? (
        <button onClick={() => setOpen(true)}
          className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 text-left transition-all duration-300 w-full hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.3)] hover:shadow-[0_20px_45px_-12px_rgba(11,29,81,0.45)]"
          style={{ background: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}>
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.22), transparent 70%)' }} />
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }}>
            <Plus className="h-5 w-5" style={{ color: 'white' }} />
          </div>
          <div className="relative">
            <p className="font-semibold text-sm" style={{ color: 'white' }}>Publier une offre</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>Créer une nouvelle mission</p>
          </div>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>
          <Plus className="h-4 w-4" /> Créer une offre
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={e => { if (e.target === e.currentTarget && tab === 'manual') setOpen(false) }}>
          <div className={`w-full ${tab === 'import' ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl overflow-hidden transition-[max-width] duration-200`}
            style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
              <h2 className="font-semibold text-white">Nouvelle offre</h2>
              <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Onglets : saisie manuelle | import IA */}
            <div className="flex gap-1 px-4 pt-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              {([['manual', 'Saisie manuelle', PencilLine], ['import', 'Import IA / Excel', FileUp]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" onClick={() => setTab(id)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-colors"
                  style={tab === id ? { background: 'var(--color-surface)', color: 'var(--color-text)', borderBottom: '2px solid #E8A33D' } : { color: 'var(--color-text-muted)', borderBottom: '2px solid transparent' }}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>

            {tab === 'import' && (
              <ImportPanel tenantName={companyName} onClose={() => { setOpen(false); router.refresh() }} onImported={() => router.refresh()} />
            )}

            <form ref={formRef} action={submit} className={`p-6 space-y-4 max-h-[70vh] overflow-y-auto ${tab === 'import' ? 'hidden' : ''}`}>
              <div className="rounded-xl p-4 space-y-2.5" style={{ background: 'rgba(232,163,61,0.06)', border: '1px solid rgba(232,163,61,0.25)' }}>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest"
                    style={{ color: 'var(--color-primary)' }}>
                    <Sparkles className="h-3.5 w-3.5" /> Assistant IA de rédaction
                  </label>
                  <button type="button" onClick={openLibrary}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text-muted)' }}>
                    <Library className="h-3 w-3" /> Bibliothèque <ChevronDown className="h-3 w-3" style={{ transform: libraryOpen ? 'rotate(180deg)' : undefined }} />
                  </button>
                </div>

                {libraryOpen && (
                  <div className="rounded-lg max-h-40 overflow-y-auto" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
                    {isLoadingLibrary || libraryJobs === null ? (
                      <p className="text-xs px-3 py-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        <Loader2 className="h-3 w-3 animate-spin" /> Chargement de vos offres…
                      </p>
                    ) : libraryJobs.length === 0 ? (
                      <p className="text-xs px-3 py-3" style={{ color: 'var(--color-text-muted)' }}>Aucune offre publiée pour l&apos;instant.</p>
                    ) : (
                      libraryJobs.map(job => (
                        <button key={job.$id} type="button" onClick={() => importFromLibrary(job)}
                          className="w-full text-left px-3 py-2 text-xs transition-colors hover:opacity-80"
                          style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                          <span className="font-semibold">{job.title}</span>
                          <span style={{ color: 'var(--color-text-muted)' }}> — {job.location}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2}
                  className={inp} style={{ ...inpStyle, resize: 'vertical' }}
                  placeholder={hasDraftContent
                    ? "Décrivez ce qu'il faut changer (n'importe quel champ) : ex. « Passe le TJM à 650€, mets Lyon et full remote »"
                    : "Décrivez le besoin en quelques mots : ex. « Consultant SAP FI/CO senior, Paris, mission 6 mois, S/4HANA »"} />
                {aiError && <p className="text-xs" style={{ color: '#ef4444' }}>{aiError}</p>}
                <button type="button" onClick={hasDraftContent ? improve : generate} disabled={isGenerating || !aiPrompt.trim()}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  {isGenerating
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {hasDraftContent ? 'Amélioration…' : 'Génération…'}</>
                    : hasDraftContent
                      ? <><RefreshCw className="h-3.5 w-3.5" /> Améliorer l&apos;offre</>
                      : <><Sparkles className="h-3.5 w-3.5" /> Générer l&apos;annonce</>}
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>Titre du poste *</label>
                <input name="title" required className={inp} style={inpStyle}
                  value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="Consultant SAP FI/CO Senior" />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>Localisation *</label>
                <input name="location" required className={inp} style={inpStyle}
                  value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="Paris, Lyon, Remote…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                    style={{ color: 'var(--color-text-muted)' }}>Type de contrat</label>
                  <select name="contractType" className={inp} style={inpStyle}
                    value={contractType} onChange={e => setContractType(e.target.value)}>
                    <option value="">Sélectionner</option>
                    <option value="mission">Mission</option>
                    <option value="freelance">Freelance</option>
                    <option value="cdi">CDI</option>
                    <option value="cdd">CDD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                    style={{ color: 'var(--color-text-muted)' }}>Télétravail</label>
                  <select name="remote" className={inp} style={inpStyle}
                    value={remote} onChange={e => setRemote(e.target.value)}>
                    <option value="">Non précisé</option>
                    <option value="onsite">Présentiel</option>
                    <option value="hybrid">Hybride</option>
                    <option value="remote">Full remote</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>TJM / Salaire (€)</label>
                <input name="salary" type="number" className={inp} style={inpStyle}
                  value={salary} onChange={e => setSalary(e.target.value)}
                  placeholder="700 (TJM) ou 65000 (annuel)" />
              </div>

              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cette offre sera visible pendant <strong>1 mois</strong> puis désactivée automatiquement.
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>Compétences requises</label>
                <input name="skills" className={inp} style={inpStyle}
                  value={skills} onChange={e => setSkills(e.target.value)}
                  placeholder="SAP, ABAP, Finance, S/4HANA (séparées par virgule)" />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>Description du poste *</label>
                <textarea name="description" required rows={5}
                  className={inp} style={{ ...inpStyle, resize: 'vertical' }}
                  value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Contexte de la mission, responsabilités, profil recherché…" />
              </div>

              <input type="hidden" name="companyName" value={companyName} />

              {error && (
                <p className="text-sm px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                  Annuler
                </button>
                <button type="submit" disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Création…</> : 'Publier l\'offre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
