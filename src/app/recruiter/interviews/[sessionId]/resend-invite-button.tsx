'use client'

import { useState, useTransition } from 'react'
import { Mail, Check, Loader2 } from 'lucide-react'
import { sendInterviewInvitationEmail } from '@/app/recruiter/screening/actions'

export function ResendInviteButton({
  applicationId, candidateEmail, sessionId, jobTitle, candidateName,
}: { applicationId: string; candidateEmail: string; sessionId: string; jobTitle: string; candidateName: string }) {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  function resend() {
    setError('')
    startTransition(async () => {
      const res = await sendInterviewInvitationEmail({ applicationId: applicationId || undefined, candidateEmail, sessionId, jobTitle, candidateName })
      if (res.error) setError(res.error)
      else { setSent(true); setTimeout(() => setSent(false), 3000) }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={resend} disabled={isPending}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold shrink-0 transition-all disabled:opacity-50"
        style={{ background: sent ? 'rgba(16,185,129,0.14)' : '#7c3aed', color: sent ? '#10b981' : 'white', boxShadow: sent ? 'none' : '0 8px 20px rgba(124,58,237,0.3)' }}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        {sent ? 'Invitation envoyée' : 'Renvoyer l\'invitation'}
      </button>
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  )
}
