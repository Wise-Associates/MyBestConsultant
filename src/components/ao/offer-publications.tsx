'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AoDashboardActions, PublicationDraft, PublicationPreview } from '@/lib/ao/dashboard-types'

// Préparation et publication d'une offre AO, tenues par le tableau et non par le panneau de détail : elles durent
// (rédaction par l'IA : une trentaine de secondes ; publication avec diffusion et sourcing : une minute ou plus) et
// continuent si l'on ferme le panneau. La ligne affiche alors « Modifications en cours », et le panneau rouvert retrouve
// l'opération, le brouillon ou son résultat. Rien n'est gardé si l'on quitte la page : le serveur termine quand même
// l'opération lancée (offre publiée visible au retour ; brouillon à préparer de nouveau).

export type PublicationWork = 'preparing' | 'publishing'

export interface OfferPublication {
  /** Opération en cours sur le serveur, null sinon. */
  running: PublicationWork | null
  preview: PublicationPreview | null
  draft: PublicationDraft | null
  /** Compétences telles que saisies (séparées par des virgules), découpées à la publication. */
  skillsText: string
  error: string
  /** Offre publique créée par la publication. */
  jobId: string | null
}

export const IDLE_PUBLICATION: OfferPublication = { running: null, preview: null, draft: null, skillsText: '', error: '', jobId: null }

/** Fin d'une opération : le tableau prévient si le panneau de l'offre a été fermé entre-temps. */
export interface PublicationOutcome {
  id: string
  title: string
  work: PublicationWork
  error: string
}

export function useOfferPublications(
  actions: Pick<AoDashboardActions, 'previewPublication' | 'publish'>,
  onSettled: (outcome: PublicationOutcome) => void,
) {
  const [byOffer, setByOffer] = useState<Record<string, OfferPublication>>({})
  const update = (id: string, patch: Partial<OfferPublication>) =>
    setByOffer(all => ({ ...all, [id]: { ...(all[id] ?? IDLE_PUBLICATION), ...patch } }))

  async function prepare(id: string, title: string) {
    update(id, { running: 'preparing', error: '' })
    let error = ''
    try {
      const res = await actions.previewPublication(id)
      if (res.preview) update(id, { preview: res.preview, draft: res.preview.draft, skillsText: res.preview.draft.skills.join(', ') })
      else error = res.error ?? 'Aperçu impossible.'
    } catch (err) {
      console.error('AO: préparation de la publication interrompue', err instanceof Error ? err.message : String(err))
      error = 'Préparation interrompue (connexion perdue) : réessayez.'
    }
    update(id, { running: null, error })
    onSettled({ id, title, work: 'preparing', error })
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
    onSettled({ id, title, work: 'publishing', error })
  }

  return {
    of: (id: string): OfferPublication => byOffer[id] ?? IDLE_PUBLICATION,
    prepare,
    publish,
    /** Modification du brouillon pendant la relecture. */
    edit: (id: string, patch: Pick<Partial<OfferPublication>, 'draft' | 'skillsText'>) => update(id, patch),
    cancel: (id: string) => update(id, { preview: null, draft: null, error: '' }),
  }
}

const WORK_DETAIL: Record<PublicationWork, string> = {
  preparing: 'Rédaction de la version anonymisée en cours',
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
