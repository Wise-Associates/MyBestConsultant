'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { JobEditModal } from '@/app/admin/jobs/job-edit-modal'
import { updateOwnJobAction } from '@/app/recruiter/dashboard/actions'
import type { Job } from '@/types'

/** « Modifier » du détail d'une offre : même fenêtre que dans « Mes offres », la page est relue à l'enregistrement. */
export function EditJobButton({ job, className, style }: { job: Job; className: string; style: React.CSSProperties }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setEditing(true)} className={className} style={style}>
        <Pencil className="h-4 w-4" aria-hidden />Modifier
      </button>
      {editing && (
        <JobEditModal
          job={{
            $id: job.$id, title: job.title, companyName: job.companyName, location: job.location, contractType: job.contractType,
            remote: job.remote, salary: job.salary, skills: job.skills, description: job.description, isActive: job.isActive,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); router.refresh() }}
          save={updateOwnJobAction}
        />
      )}
    </>
  )
}
