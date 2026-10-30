'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { AoDashboardActions, PublicationDraft, PublicationMode, PublicationPreview } from '@/lib/ao/dashboard-types'

// Préparation et publication d'une offre AO, tenues par la section AO (AoPublicationsProvider, dans le layout de la
// section : liste et pages des offres) et non par la page de l'offre : elles durent (rédaction par l'IA : une trentaine
// de secondes ; publication avec diffusion et sourcing : une minute ou plus) et continuent si l'on passe à l'offre
// suivante ou revient à la liste. La ligne affiche alors « Modifications en cours », et la page de l'offre rouverte
// retrouve l'opération, le brouillon ou son résultat. Rien n'est gardé si l'on quitte la section : le serveur termine
// quand même l'opération lancée (offre publiée visible au retour ; brouillon à préparer de nouveau).

export type PublicationWork = 'preparing' | 'publishing'

export interface OfferPublication {
  /** Opération en cours sur le serveur, null sinon. */
  running: PublicationWork | null
  /** Version préparée (ou en préparation) : anonymisée, ou telle que reçue (« Publier sans anonymiser »). */
  mode: PublicationMode
  preview: PublicationPreview | null
  draft: PublicationDraft | null
  /** Compétences telles que saisies (séparées par des virgules), découpées à la publication. */
  skillsText: string
  error: string
  /** Offre publique créée par la publication. */
  jobId: string | null
}

export const IDLE_PUBLICATION: OfferPublication = { running: null, mode: 'anonymized', preview: null, draft: null, skillsText: '', error: '', jobId: null }

/** Fin d'une opération : un message prévient si la page de l'offre n'est plus affichée. */
export interface PublicationOutcome {
  id: string
  title: string
  work: PublicationWork
  mode: PublicationMode
  error: string
}

function useOfferPublications(
  actions: Pick<AoDashboardActions, 'previewPublication' | 'publish'>,
  onSettled: (outcome: PublicationOutcome) => void,
) {
  const [byOffer, setByOffer] = useState<Record<string, OfferPublication>>({})
  const update = (id: string, patch: Partial<OfferPublication>) =>
    setByOffer(all => ({ ...all, [id]: { ...(all[id] ?? IDLE_PUBLICATION), ...patch } }))
  // Préparation abandonnée (« Arrêter ») : une Server Action ne s'interrompt pas, sa réponse arrive quand même et
  // est ignorée grâce à ce numéro de lancement.
  const preparations = useRef<Record<string, number>>({})

  async function prepare(id: string, title: string, mode: PublicationMode) {
    const run = (preparations.current[id] ?? 0) + 1
    preparations.current[id] = run
    update(id, { running: 'preparing', mode, error: '' })
    let error = ''
    let preview: PublicationPreview | undefined
    try {
      const res = await actions.previewPublication(id, mode)
      if (res.preview) preview = res.preview
      else error = res.error ?? 'Aperçu impossible.'
    } catch (err) {
      console.error('AO: préparation de la publication interrompue', err instanceof Error ? err.message : String(err))
      error = 'Préparation interrompue (connexion perdue) : réessayez.'
    }
    if (preparations.current[id] !== run) return
    update(id, { running: null, error, ...(preview && { preview, draft: preview.draft, skillsText: preview.draft.skills.join(', ') }) })
    onSettled({ id, title, work: 'preparing', mode, error })
  }

  /** Abandonne la préparation en cours : la rédaction déjà demandée se termine sur le serveur, sa version est ignorée. */
  function stopPreparing(id: string) {
    preparations.current[id] = (preparations.current[id] ?? 0) + 1
    update(id, { running: null, error: '' })
  }

  async function publish(id: string, title: string, draft: PublicationDraft, skillsText: string) {
    update(id, { running: 'publishing', error: '' })
    const skills = skillsText.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
    let error = ''
    try {
      const res = await actions.publish(id, { ...draft, skills })
      if (res.jobId) update(id, { jobId: res.jobId, preview: null, draft: null })
      else error = res.error ?? 'Publication impossible.'
    } catch (err) {
      console.error('AO: publication interrompue', err instanceof Error ? err.message : String(err))
      // La requête a pu aboutir sur le serveur : l'offre est peut-être publiée.
      error = 'Publication interrompue (connexion perdue) : rechargez la page pour voir si l\'offre a été publiée.'
    }
    update(id, { running: null, error })
    onSettled({ id, title, work: 'publishing', mode: draft.anonymized ? 'anonymized' : 'raw', error })
  }

  return {
    of: (id: string): OfferPublication => byOffer[id] ?? IDLE_PUBLICATION,
    prepare,
    stopPreparing,
    publish,
    /** Modification du brouillon pendant la relecture. */
    edit: (id: string, patch: Pick<Partial<OfferPublication>, 'draft' | 'skillsText'>) => update(id, patch),
    cancel: (id: string) => update(id, { preview: null, draft: null, error: '' }),
  }
}

const WORK_DETAIL: Record<PublicationWork, string> = {
  preparing: 'Préparation de la version à publier en cours',
  publishing: 'Publication en cours : création de l’offre, diffusion et recherche de candidats',
}

/** Statut affiché tant qu'une préparation ou une publication tourne (tableau et panneau). */
export function WorkBadge({ work }: { work: PublicationWork }) {
  return (
    <span title={WORK_DETAIL[work]} className="inline-flex items-center gap-1.5 whitespace-normal leading-tight text-xs font-medium px-2 py-1 rounded-md"
      style={{ color: '#1d4ed8', background: 'var(--admin-panel-raised)' }}>
      <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      Modifications en cours
    </span>
  )
}

type Notice = { tone: 'ok' | 'error'; text: string }

interface AoPublicationsValue extends ReturnType<typeof useOfferPublications> {
  /** Fin d'une opération sur une offre dont la page n'est pas affichée (gardée jusqu'à sa fermeture). */
  notice: Notice | null
  clearNotice(): void
  /** Offre affichée sur sa page : la fin de ses opérations s'y lit directement, sans message en plus. */
  setOpenOffer(id: string | null): void
}

const AoPublicationsContext = createContext<AoPublicationsValue | null>(null)

export function useAoPublications(): AoPublicationsValue {
  const value = useContext(AoPublicationsContext)
  if (!value) throw new Error('useAoPublications : AoPublicationsProvider absent du layout de la section AO.')
  return value
}

/**
 * Préparations et publications des offres de la section AO, gardées d'une page à l'autre de la section (liste, offre
 * précédente ou suivante). Les actions viennent de l'espace (admin ou recruteur) et vérifient elles-mêmes l'appelant.
 */
export function AoPublicationsProvider({ actions, children }: {
  actions: Pick<AoDashboardActions, 'previewPublication' | 'publish'>
  children: ReactNode
}) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const openOffer = useRef<string | null>(null)
  const publications = useOfferPublications(actions, ({ id, title, work, mode, error }) => {
    if (openOffer.current === id) return
    if (error) return setNotice({ tone: 'error', text: `« ${title} » : ${error}` })
    const version = mode === 'raw' ? 'Version non anonymisée' : 'Version anonymisée'
    setNotice({
      tone: 'ok',
      text: work === 'preparing' ? `${version} de « ${title} » prête : ouvrez l'offre pour la relire et la publier.` : `Offre « ${title} » publiée.`,
    })
  })
  const clearNotice = useCallback(() => setNotice(null), [])
  const setOpenOffer = useCallback((id: string | null) => { openOffer.current = id }, [])
  const value: AoPublicationsValue = { ...publications, notice, clearNotice, setOpenOffer }
  return <AoPublicationsContext.Provider value={value}>{children}</AoPublicationsContext.Provider>
}
