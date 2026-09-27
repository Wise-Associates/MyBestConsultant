'use server'

import { notificationUserId } from '@/lib/candidate-identity'
import { randomBytes } from 'crypto'
import { ID } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'
import { docToEmail, type PipelineEmail } from '@/lib/appwrite/application-emails'
import { revalidatePath } from 'next/cache'
import { requireRecruiter } from './actions'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Personalised email from a pipeline card. Unlike the generic sendCustomMessage, it's
// recorded (so the card can show it and its delivery state) and carries a "Répondre"
// button pointing to a small in-platform page — that's what lets us know the candidate
// answered, since replies to an Appwrite Messaging email never come back to the platform.
export async function sendCandidateEmailAction(params: {
  applicationId: string; jobId: string; subject: string; message: string
}): Promise<{ email?: PipelineEmail; error?: string }> {
  try {
    const user = await requireRecruiter()
    const subject = params.subject.trim().slice(0, 200)
    const message = params.message.trim().slice(0, 3000)
    if (!subject || !message) return { error: 'Objet et message requis' }

    const { databases, messaging } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, params.applicationId)
    if (app.tenantId !== user.tenantId) return { error: 'Non autorisé' }
    const candidate = await databases.getDocument(DB_ID, COLLECTIONS.USERS, app.candidateId as string)
    const authId = notificationUserId(candidate as unknown as Record<string, unknown>) ?? undefined // chasseur si profil de vivier
    if (!authId) return { error: 'Candidat introuvable' }

    const token = randomBytes(18).toString('hex')
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const replyUrl = `${origin}/repondre/${token}`

    const bodyHtml = message.split('\n')
      .map(line => `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#45454A;">${line ? escapeHtml(line) : '&nbsp;'}</p>`)
      .join('') + `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${replyUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Répondre</a>
        </td></tr>
      </table>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">Ou copiez ce lien : <a href="${replyUrl}" style="color:#E8A33D;">${replyUrl}</a></p>`

    const sent = await messaging.createEmail(
      ID.unique(), subject, wrapEmailHtml(subject, bodyHtml),
      [], [authId], [], [], [], [], false, true,
    )

    const doc = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATION_EMAILS, ID.unique(), {
      applicationId: params.applicationId, tenantId: user.tenantId!, subject, message,
      messageId: sent.$id, replyToken: token,
    })

    revalidatePath(`/recruiter/pipeline/${params.jobId}`)
    return { email: await docToEmail(doc as unknown as Record<string, unknown>, 'processing') }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

// Manual fallback — the recruiter got an answer some other way (phone, their own inbox).
export async function setEmailRepliedAction(emailId: string, replied: boolean): Promise<{ repliedAt?: string; error?: string }> {
  try {
    const user = await requireRecruiter()
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATION_EMAILS, emailId)
    if (doc.tenantId !== user.tenantId) return { error: 'Non autorisé' }
    const repliedAt = replied ? new Date().toISOString() : null
    await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATION_EMAILS, emailId, { repliedAt })
    return { repliedAt: repliedAt ?? undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
