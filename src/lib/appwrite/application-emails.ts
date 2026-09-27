import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { Query } from 'node-appwrite'

export type EmailDelivery = 'sent' | 'failed' | 'processing'

export interface PipelineEmail {
  id: string
  applicationId: string
  subject: string
  message: string
  sentAt: string
  delivery: EmailDelivery
  reply?: string
  repliedAt?: string
}

async function deliveryOf(messageId: string | undefined): Promise<EmailDelivery> {
  if (!messageId) return 'processing'
  try {
    const { messaging } = createAdminClient()
    const m = await messaging.getMessage(messageId)
    if (m.status === 'failed' || (m.deliveryErrors?.length ?? 0) > 0) return 'failed'
    if (m.status === 'sent') return 'sent'
    return 'processing'
  } catch {
    return 'processing'
  }
}

export async function docToEmail(doc: Record<string, unknown>, delivery?: EmailDelivery): Promise<PipelineEmail> {
  return {
    id: doc.$id as string,
    applicationId: doc.applicationId as string,
    subject: doc.subject as string,
    message: doc.message as string,
    sentAt: doc.$createdAt as string,
    delivery: delivery ?? await deliveryOf(doc.messageId as string | undefined),
    reply: (doc.reply as string | null) || undefined,
    repliedAt: (doc.repliedAt as string | null) || undefined,
  }
}

// Every personalised email sent from the pipeline, newest first, with its live delivery
// state read from Appwrite Messaging (sent / failed / still processing).
export async function getEmailsForApplications(applicationIds: string[]): Promise<PipelineEmail[]> {
  if (applicationIds.length === 0) return []
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATION_EMAILS, [
      Query.equal('applicationId', applicationIds.slice(0, 100)), Query.orderDesc('$createdAt'), Query.limit(100),
    ])
    return await Promise.all(res.documents.map(d => docToEmail(d as unknown as Record<string, unknown>)))
  } catch {
    return []
  }
}
