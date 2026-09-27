'use server'

import { Query, ID } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'
import { revalidatePath } from 'next/cache'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The candidate answers from the link in the email — no account needed, the unguessable
// token is the credential. One answer per email; the recruiter is notified by email.
export async function submitEmailReply(token: string, reply: string): Promise<{ error?: string }> {
  try {
    const text = reply.trim().slice(0, 3000)
    if (!text) return { error: 'Écrivez votre réponse avant d\'envoyer' }
    if (!/^[a-f0-9]{20,64}$/.test(token)) return { error: 'Lien invalide' }

    const { databases, messaging } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATION_EMAILS, [Query.equal('replyToken', token), Query.limit(1)])
    const doc = res.documents[0]
    if (!doc) return { error: 'Lien invalide ou expiré' }
    if (doc.reply) return { error: 'Vous avez déjà répondu à ce message' }

    await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATION_EMAILS, doc.$id, { reply: text, repliedAt: new Date().toISOString() })

    try {
      const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, doc.applicationId as string)
      const [tenant, candidate] = await Promise.all([
        databases.getDocument(DB_ID, COLLECTIONS.TENANTS, doc.tenantId as string),
        databases.getDocument(DB_ID, COLLECTIONS.USERS, app.candidateId as string),
      ])
      const name = `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim() || 'Un candidat'
      const recruiterAuthId = tenant.recruiterId as string | undefined
      if (recruiterAuthId) {
        const subject = `${name} a répondu à votre message`
        const body = `<p style="margin:0 0 12px; font-size:14px; color:#45454A;"><strong>${escapeHtml(name)}</strong> a répondu à « ${escapeHtml(doc.subject as string)} » :</p>
          <blockquote style="margin:0; padding:12px 16px; border-left:3px solid #E8A33D; background:#FAF7F0; font-size:14px; line-height:1.7; color:#45454A;">${escapeHtml(text).replace(/\n/g, '<br>')}</blockquote>`
        await messaging.createEmail(ID.unique(), subject, wrapEmailHtml(subject, body), [], [recruiterAuthId], [], [], [], [], false, true)
      }
      revalidatePath(`/recruiter/pipeline/${app.jobId as string}`)
    } catch { /* the reply is saved — the notification is best-effort */ }

    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
