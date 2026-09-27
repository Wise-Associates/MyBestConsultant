import Link from 'next/link'
import { MailWarning } from 'lucide-react'

export function VerifyEmailBanner({ verified }: { verified: boolean }) {
  if (verified) return null

  return (
    <div style={{
      background: '#E8A33D', color: '#1a1400',
      padding: '8px 16px', fontSize: 13, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      textAlign: 'center',
    }}>
      <MailWarning size={14} style={{ flexShrink: 0 }} />
      Votre adresse email n&apos;est pas encore vérifiée.
      <Link href="/verify-email" style={{ textDecoration: 'underline', flexShrink: 0 }}>
        Vérifier maintenant
      </Link>
    </div>
  )
}
