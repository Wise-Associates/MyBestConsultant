import Link from 'next/link'
import { Laptop, MapPin } from 'lucide-react'
import type { Job } from '@/types'
import { badge, columnHeaderStyle, muted, neutralBadge } from '@/components/shared/list-styles'
import { isNewJob, publishedAgo, skillsPreview } from '@/lib/job-listing'
import { payListText } from '@/lib/job-pay'
import { CONTRACT_LABELS, REMOTE_LABELS } from './labels'

// Une offre de la liste publique (/jobs), avec la charte des lignes de « Mes offres » du tableau de bord recruteur
// (list-styles.ts) : tableau à quatre colonnes dès 1024 px (offre, lieu, compétences, contrat et rémunération), carte
// empilée en dessous. Toute la ligne mène à l'offre.

const COLUMNS = 'lg:grid lg:grid-cols-12 lg:gap-x-5'

/** En-tête des colonnes (grand écran) ; décoratif : chaque ligne nomme déjà ses informations. */
export function JobTableHeader() {
  return (
    <div aria-hidden className={`hidden ${COLUMNS} px-6 py-2.5 text-xs font-semibold`} style={columnHeaderStyle}>
      <span className="col-span-4">Offre</span>
      <span className="col-span-2">Lieu</span>
      <span className="col-span-3">Compétences</span>
      <span className="col-span-3 text-right">Contrat · rémunération</span>
    </div>
  )
}

export function JobRow({ job, nowMs, first }: { job: Job; nowMs: number; first: boolean }) {
  const { shown, more } = skillsPreview(job.skills)
  const contract = job.contractType ? CONTRACT_LABELS[job.contractType] : null
  return (
    <li style={first ? undefined : { borderTop: '1px solid var(--color-border)' }}>
      <Link href={`/jobs/${job.$id}`}
        className={`group mbc-job-row flex flex-col gap-2.5 px-4 sm:px-6 py-4 ${COLUMNS} lg:items-center no-underline`}>
        <div className="lg:col-span-4 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
            <h3 className="group-hover:underline underline-offset-[3px]" style={{ color: 'var(--color-text)', fontSize: 15, fontWeight: 600, lineHeight: 1.375 }}>{job.title}</h3>
            {isNewJob(job.createdAt, nowMs) && (
              <span className={badge} style={neutralBadge}>
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-primary)' }} />Nouveau
              </span>
            )}
          </div>
          {job.companyName && <p className="text-[13px]" style={muted}>{job.companyName}</p>}
        </div>

        <div className="lg:col-span-2 text-[13px] flex flex-wrap gap-x-3 gap-y-1 lg:flex-col" style={muted}>
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.25 w-3.25 shrink-0" aria-hidden />{job.location}</span>
          {job.remote && <span className="inline-flex items-center gap-1.5"><Laptop className="h-3.25 w-3.25 shrink-0" aria-hidden />{REMOTE_LABELS[job.remote]}</span>}
        </div>

        <div className="lg:col-span-3 flex flex-wrap items-center gap-1.5 min-w-0">
          {shown.map(s => <span key={s} title={s} className={`${badge} max-w-full truncate`} style={neutralBadge}>{s}</span>)}
          {more > 0 && <span className="text-[11px] font-semibold" style={muted}><span className="sr-only">et </span>+{more}</span>}
        </div>

        <div className="lg:col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-col lg:items-end">
          <span className="inline-flex items-center gap-2">
            {contract && <span className={badge} style={neutralBadge}>{contract}</span>}
            {job.salary ? <span className="text-[15px] font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{payListText(job.salary, job.contractType)}</span> : null}
          </span>
          <span className="text-xs" style={muted}>Publiée {publishedAgo(job.createdAt, nowMs)}</span>
        </div>
      </Link>
    </li>
  )
}
