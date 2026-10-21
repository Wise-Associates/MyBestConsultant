'use client'

import { useState, useTransition } from 'react'
import { MapPin, Building2, ToggleLeft, ToggleRight, Eye, Edit2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { JobEditModal } from './job-edit-modal'
import { deleteJob } from './actions'

type ContractType = 'cdi' | 'cdd' | 'freelance' | 'mission'
type RemoteType = 'onsite' | 'hybrid' | 'remote'

interface JobRow {
  $id: string
  title: string
  companyName?: string
  location: string
  contractType?: ContractType
  remote?: RemoteType
  salary?: number
  skills: string[]
  description: string
  isActive: boolean
  createdAt?: string
  expiresAt?: string
}

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote' }

export function JobsList({ initialJobs }: { initialJobs: JobRow[] }) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs)
  const [editing, setEditing] = useState<JobRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<JobRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSaved = (updated: JobRow) => {
    setJobs(prev => prev.map(j => j.$id === updated.$id ? updated : j))
    setEditing(null)
  }

  const handleDelete = (job: JobRow) => {
    startTransition(async () => {
      const res = await deleteJob(job.$id)
      if (!res.error) {
        setJobs(prev => prev.filter(j => j.$id !== job.$id))
      }
      setConfirmDelete(null)
    })
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {['Offre', 'Entreprise', 'Lieu', 'Contrat', 'Remote', 'Statut', 'Publiée', 'Expire le', ''].map((h, i) => (
              <th key={i}
                className={`text-left px-4 py-3 text-xs font-medium
                  ${i === 0 ? 'pl-6' : ''}
                  ${i === 3 || i === 4 ? 'hidden lg:table-cell' : ''}
                  ${i === 2 || i === 6 || i === 7 ? 'hidden md:table-cell' : ''}
                  ${i === 1 ? 'hidden sm:table-cell' : ''}`}
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-center py-20" style={{ color: 'rgba(255,255,255,0.25)' }}>
                <p>Aucune offre publiée</p>
              </td>
            </tr>
          ) : jobs.map(job => (
            <tr
              key={job.$id}
              onClick={() => setEditing(job)}
              className="cursor-pointer transition-colors hover:bg-white/[0.02]"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                opacity: job.isActive ? 1 : 0.5,
              }}
            >
              {/* Offre */}
              <td className="pl-6 pr-4 py-4">
                <p className="font-medium text-white">{job.title}</p>
              </td>

              {/* Entreprise */}
              <td className="px-4 py-4 hidden sm:table-cell">
                {job.companyName ? (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    <Building2 className="h-3 w-3 shrink-0" />{job.companyName}
                  </span>
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                )}
              </td>

              {/* Lieu */}
              <td className="px-4 py-4 hidden md:table-cell">
                <span className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  <MapPin className="h-3.5 w-3.5" />{job.location}
                </span>
              </td>

              {/* Contrat */}
              <td className="px-4 py-4 hidden lg:table-cell">
                <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
                  {CONTRACT[job.contractType ?? ''] ?? job.contractType ?? '—'}
                </span>
              </td>

              {/* Remote */}
              <td className="px-4 py-4 hidden lg:table-cell text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {REMOTE[job.remote ?? ''] ?? job.remote ?? '—'}
              </td>

              {/* Statut */}
              <td className="px-4 py-4">
                {job.isActive
                  ? <ToggleRight className="h-5 w-5" style={{ color: '#34d399' }} />
                  : <ToggleLeft className="h-5 w-5" style={{ color: 'rgba(255,255,255,0.2)' }} />}
              </td>

              {/* Date */}
              <td className="px-4 py-4 hidden md:table-cell text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {job.createdAt ? new Date(job.createdAt).toLocaleDateString('fr-FR') : '—'}
              </td>

              {/* Expiration */}
              <td className="px-4 py-4 hidden md:table-cell text-xs"
                style={{ color: job.expiresAt && new Date(job.expiresAt) < new Date() ? '#ef4444' : 'rgba(255,255,255,0.35)' }}>
                {job.expiresAt ? new Date(job.expiresAt).toLocaleDateString('fr-FR') : 'Sans limite'}
              </td>

              {/* Actions */}
              <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditing(job)}
                    className="p-2 rounded-lg transition-colors hover:bg-white/[0.06]"
                    title="Modifier"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <Link href={`/jobs/${job.$id}`} target="_blank"
                    className="p-2 rounded-lg transition-colors hover:bg-white/[0.06]"
                    title="Voir"
                    style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <Eye className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    onClick={() => setConfirmDelete(job)}
                    className="p-2 rounded-lg transition-colors hover:bg-red-500/10"
                    title="Supprimer"
                    style={{ color: 'rgba(239,68,68,0.45)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.45)')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <JobEditModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6"
            style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'rgba(239,68,68,0.12)' }}>
                <Trash2 className="h-5 w-5" style={{ color: '#ef4444' }} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Supprimer l&apos;offre</h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Cette action est irréversible
                </p>
              </div>
            </div>
            <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Voulez-vous vraiment supprimer <span className="font-medium text-white">&ldquo;{confirmDelete.title}&rdquo;</span> ?
              Toutes les candidatures associées resteront en base mais l&apos;offre ne sera plus accessible.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}>
                Annuler
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                style={{ background: '#ef4444', color: '#fff', opacity: isPending ? 0.6 : 1 }}>
                {isPending ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Suppression…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
