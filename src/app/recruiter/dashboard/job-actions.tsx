'use client'

import { useState, useTransition } from 'react'
import { Trash2, ToggleLeft, ToggleRight, Loader2, Edit2 } from 'lucide-react'
import { toggleJobStatusAction, deleteJobAction } from './actions'
import { JobEditModal } from '@/app/admin/jobs/job-edit-modal'
import type { Job } from '@/types'

export function JobActions({ job, tenantId }: { job: Job; tenantId: string }) {
  const [isPendingToggle, startToggle] = useTransition()
  const [isPendingDelete, startDelete] = useTransition()
  const [editing, setEditing] = useState(false)

  function handleToggle() {
    startToggle(async () => {
      await toggleJobStatusAction(job.$id, !job.isActive)
    })
  }

  function handleDelete() {
    if (!confirm(`Supprimer l'offre "${job.title}" ? Cette action est irréversible.`)) return
    startDelete(async () => {
      await deleteJobAction(job.$id)
    })
  }

  return (
    <>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditing(true)}
          title="Modifier"
          className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
          style={{ color: 'var(--color-primary)' }}>
          <Edit2 className="h-4 w-4" />
        </button>
        <button
          onClick={handleToggle}
          disabled={isPendingToggle}
          title={job.isActive ? 'Archiver' : 'Réactiver'}
          className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
          style={{ color: job.isActive ? '#10b981' : '#6b7280' }}>
          {isPendingToggle
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : job.isActive
              ? <ToggleRight className="h-4 w-4" />
              : <ToggleLeft className="h-4 w-4" />
          }
        </button>
        <button
          onClick={handleDelete}
          disabled={isPendingDelete}
          title="Supprimer"
          className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
          style={{ color: '#ef4444' }}>
          {isPendingDelete
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Trash2 className="h-4 w-4" />
          }
        </button>
      </div>

      {editing && (
        <JobEditModal
          job={{
            $id: job.$id,
            title: job.title,
            companyName: job.companyName,
            location: job.location,
            contractType: job.contractType,
            remote: job.remote,
            salary: job.salary,
            skills: job.skills,
            description: job.description,
            isActive: job.isActive,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); window.location.reload() }}
        />
      )}
    </>
  )
}
