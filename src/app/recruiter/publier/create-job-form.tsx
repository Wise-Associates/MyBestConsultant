'use client'

import { useRef, useState, useTransition } from 'react'
import { Skeleton, SkeletonRegion } from '@/components/shared/skeleton'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Sparkles, RefreshCw, Library, ChevronDown, PencilLine, FileUp } from 'lucide-react'
import { createJobAction, listMyJobsForLibrary } from '@/app/recruiter/dashboard/actions'
import { generateJobDraft, improveJobDraft, type JobDraft } from '@/app/recruiter/dashboard/ai-job-draft-actions'
import { ImportPanel } from '@/app/recruiter/dashboard/import-panel'
import { startNavigationProgress } from '@/components/shared/navigation-progress'
import type { Job } from '@/types'
import { PAY_FIELD_LABEL, payHint, payUnitFor } from '@/lib/job-pay'

/**
 * Création d'une offre, page « Publier un job » (/recruiter/publier, demande du 2026-11-17 ; avant : fenêtre « Nouvelle
 * offre » du tableau de bord). Deux façons de publier : saisie manuelle (avec l'assistant de rédaction et la
 * bibliothèque des anciennes offres) ou import IA / Excel (`?tab=import`). Offre publiée : ouverture de son détail.
 */
export function CreateJobForm({ companyName }: { companyName: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
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

  const hint = payHint(salary ? Number(salary) : null, contractType)

  function submit(formData: FormData) {
    setError('')
    startTransition(async () => {
      const result = await createJobAction(formData)
      if (result.error || !result.jobId) {
        setError(result.error ?? 'L’offre n’a pas pu être créée. Réessayez.')
        return
      }
      startNavigationProgress()
      router.push(`/recruiter/offres/${result.jobId}`)
    })
  }

  const inp = 'w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors'
  const inpStyle = {
    background: 'rgba(0,0,0,0.03)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
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
              <ImportPanel tenantName={companyName} onClose={() => { startNavigationProgress(); router.push('/recruiter/dashboard') }} onImported={() => router.refresh()} />
            )}

            <form ref={formRef} action={submit} className={`p-6 space-y-4 ${tab === 'import' ? 'hidden' : ''}`}>
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
                      <SkeletonRegion label="Chargement de vos offres…" className="px-3 py-2.5 space-y-2.5">
                        {[70, 55, 62].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}
                      </SkeletonRegion>
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

              {/* Unité fixée par le contrat (job-pay.ts) : TJM pour une mission ou un freelance, salaire annuel brut pour un
                  CDI ou un CDD. La même unité est reprise sur la page de l'offre et dans les publications (LinkedIn…). */}
              <div>
                <label htmlFor="create-job-salary" className="block text-xs font-semibold mb-1.5 uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}>{contractType ? PAY_FIELD_LABEL[payUnitFor(contractType)] : 'TJM / Salaire annuel (€)'}</label>
                <input id="create-job-salary" name="salary" type="number" min={0} className={inp} style={inpStyle}
                  value={salary} onChange={e => setSalary(e.target.value)} aria-describedby="create-job-salary-hint"
                  placeholder={contractType ? (payUnitFor(contractType) === 'an' ? 'ex. 55000' : 'ex. 650') : '650 (TJM) ou 55000 (annuel)'} />
                <p id="create-job-salary-hint" className="mt-1.5 text-xs" style={{ color: hint.warning ? '#b45309' : 'var(--color-text-muted)' }}>
                  {hint.text}
                </p>
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
                <button type="button" onClick={() => { startNavigationProgress(); router.push('/recruiter/dashboard') }}
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
  )
}
