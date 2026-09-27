'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query, ID } from 'node-appwrite'

export async function submitContactForm(formData: FormData): Promise<{ error?: string; success?: true }> {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const subject = (formData.get('subject') as string)?.trim()
  const message = (formData.get('message') as string)?.trim()

  if (!name || !email || !message) return { error: 'Nom, email et message sont requis' }

  try {
    const { databases, messaging } = createAdminClient()

    const admins = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('role', 'admin'),
      Query.limit(50),
    ])
    const adminAuthIds = admins.documents.map(d => d.userId as string).filter(Boolean)
    if (adminAuthIds.length === 0) return { error: 'Formulaire indisponible pour le moment' }

    const bodyHtml = `
      <p style="margin:0 0 16px; font-size:14px; line-height:1.7; color:#3D4566;">
        Nouveau message depuis le formulaire de contact du site.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin-bottom:16px;">
        <tr><td style="padding:4px 0; font-size:13px; color:#8A90A8;">Nom</td><td style="padding:4px 0; font-size:13px; color:#3D4566;">${name}</td></tr>
        <tr><td style="padding:4px 0; font-size:13px; color:#8A90A8;">Email</td><td style="padding:4px 0; font-size:13px; color:#3D4566;">${email}</td></tr>
      </table>
      <p style="margin:0; font-size:14px; line-height:1.7; color:#3D4566; white-space:pre-wrap;">${message}</p>
    `
    const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F8; padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#FFFFFF; border-radius:16px; overflow:hidden; border:1px solid #E5E9F5;">
      <tr><td style="background-color:#2C2C2E; padding:32px 40px; text-align:center;">
        <span style="font-family:Georgia, 'Times New Roman', serif; font-weight:300; font-size:22px; color:#FFFFFF;">My Best Consultant</span>
      </td></tr>
      <tr><td style="padding:40px;">
        <h1 style="margin:0 0 16px; font-family:Georgia, 'Times New Roman', serif; font-weight:700; font-size:20px; color:#2C2C2E;">${subject || 'Nouveau message de contact'}</h1>
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>
</table>`

    await messaging.createEmail(
      ID.unique(),
      `[Contact] ${subject || 'Nouveau message'} — ${name}`,
      html,
      [], adminAuthIds, [], [], [], [], false, true,
    )
    return { success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}
