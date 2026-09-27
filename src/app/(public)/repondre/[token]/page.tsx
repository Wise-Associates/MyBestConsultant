import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ReplyForm } from './reply-form'

export const metadata = { title: 'Répondre à un message | MyBestConsultant', robots: { index: false } }

export default async function ReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[a-f0-9]{20,64}$/.test(token)) notFound()
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATION_EMAILS, [Query.equal('replyToken', token), Query.limit(1)])
  const doc = res.documents[0]
  if (!doc) notFound()

  return (
    <div style={{ minHeight: '70vh', background: 'var(--color-background)' }}>
      <div className="max-w-xl mx-auto px-6 py-12 space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-primary)' }}>Message du recruteur</p>
          <h1 style={{ fontWeight: 300, fontSize: '1.6rem', color: 'var(--color-text)' }}>{doc.subject as string}</h1>
        </div>
        <div className="rounded-2xl p-5 text-sm whitespace-pre-line" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', lineHeight: 1.7 }}>
          {doc.message as string}
        </div>
        {doc.reply ? (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#059669' }}>Votre réponse (envoyée)</p>
            <p className="text-sm whitespace-pre-line" style={{ color: 'var(--color-text)', lineHeight: 1.7 }}>{doc.reply as string}</p>
          </div>
        ) : (
          <ReplyForm token={token} />
        )}
      </div>
    </div>
  )
}
