'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { callLLM } from '@/lib/ai/llm-router'
import { ID, Query, MessagingProviderType } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import { wrapEmailHtml } from '@/lib/email-template'
import type { Recommendation } from '@/types'
import { docToRecommendation } from '@/lib/appwrite/recommendations'
import { RELATIONSHIP_LABEL } from '@/lib/recommendation-boost'

// Drafts the personal note that goes inside the recommendation request email — the
// candidate reviews and can freely edit it before sending, this is just a starting point.
export async function generateRecommendationMessage(data: {
  recipientName: string
  recipientCompany?: string
  experience?: string
  period?: string
}): Promise<{ message?: string; error?: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Non connecté' }

  const recipientName = data.recipientName.trim()
  if (!recipientName) return { error: 'Indiquez le nom du destinataire avant de générer un message' }

  try {
    const candidateName = `${user.firstName} ${user.lastName}`.trim()
    const { content } = await callLLM([{
      role: 'user',
      content: `Rédige un court message personnalisé (3-4 phrases maximum) que ${candidateName} envoie à ${recipientName}${data.recipientCompany ? ` (${data.recipientCompany})` : ''}, un ancien employeur ou client, pour lui demander une recommandation professionnelle sur la plateforme MyBestConsultant${data.experience ? `, en rapport avec cette expérience commune : ${data.experience.trim().slice(0, 200)}${data.period ? ` (${data.period.trim().slice(0, 60)})` : ''}` : ''}. Le ton doit être chaleureux, sincère et professionnel — pas de formule de politesse d'ouverture/fermeture (ex: "Bonjour", "Cordialement"), juste le corps du message. Réponds uniquement avec le texte du message, sans guillemets.`,
    }], 'Tu es un assistant qui aide un consultant à rédiger un message court et sincère pour demander une recommandation professionnelle.')

    const message = content.trim().replace(/^["«]|["»]$/g, '')
    if (!message) return { error: 'Réponse IA vide, réessayez' }
    return { message }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur de génération' }
  }
}

export async function getMyRecommendations(): Promise<Recommendation[]> {
  const user = await getCurrentUser()
  if (!user) return []

  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.RECOMMENDATIONS, [
      Query.equal('candidateId', user.$id),
      Query.orderDesc('$createdAt'),
      Query.limit(25),
    ])
    return result.documents.map(d => docToRecommendation(d as unknown as Record<string, unknown>))
  } catch {
    return []
  }
}

// Appwrite Messaging never accepts a raw email string anywhere in createEmail — every
// slot (users/targets/cc/bcc) wants an Appwrite ID. The recipient (a former employer or
// client) has no MyBestConsultant account, so there's no user/target for them yet:
// find-or-create a lightweight Auth user (email only, no password — never logs in) and
// a matching email Target, then address the message to that Target's ID.
async function resolveEmailTargetId(email: string, name: string): Promise<string> {
  const { users } = createAdminClient()

  const existingUsers = await users.list([Query.equal('email', [email]), Query.limit(1)])
  const userId = existingUsers.users[0]?.$id ?? (await users.create(ID.unique(), email, undefined, undefined, name)).$id

  const existingTargets = await users.listTargets(userId)
  const emailTarget = existingTargets.targets.find(t => t.providerType === MessagingProviderType.Email)
  if (emailTarget) return emailTarget.$id

  const target = await users.createTarget(userId, ID.unique(), MessagingProviderType.Email, email)
  return target.$id
}

export async function requestRecommendation(data: {
  recipientName: string
  recipientEmail: string
  recipientCompany: string
  recipientRole?: string
  relationship: string
  experience: string
  period: string
  expertises: string[]
  message?: string
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Non connecté' }

  const recipientName = data.recipientName.trim()
  const recipientEmail = data.recipientEmail.trim()
  if (!recipientName || !recipientEmail) return { error: 'Nom et prénom et email du destinataire requis' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return { error: 'Email invalide' }
  const company = (data.recipientCompany ?? '').trim()
  const role = (data.recipientRole ?? '').trim().slice(0, 200)
  const experience = (data.experience ?? '').replace(/\s+/g, ' ').trim()
  const period = (data.period ?? '').replace(/\s+/g, ' ').trim()
  const expertises = [...new Set((Array.isArray(data.expertises) ? data.expertises : []).map(e => String(e).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, 8)
  if (!company) return { error: 'Indiquez l’entreprise du recommandant' }
  if (!RELATIONSHIP_LABEL[data.relationship]) return { error: 'Indiquez votre lien avec cette personne (responsable, client, collègue…)' }
  if (experience.length < 5) return { error: 'Indiquez l’expérience concernée (mission, projet ou poste)' }
  if (!period) return { error: 'Indiquez la période de collaboration' }
  if (expertises.length === 0) return { error: 'Choisissez au moins une expertise sur laquelle porte la recommandation' }

  try {
    const { databases, messaging } = createAdminClient()
    const candidateName = `${user.firstName} ${user.lastName}`.trim()

    const doc = await databases.createDocument(DB_ID, COLLECTIONS.RECOMMENDATIONS, ID.unique(), {
      candidateId: user.$id,
      candidateName,
      recipientName,
      recipientEmail,
      recipientCompany: company.slice(0, 200),
      recipientRole: role || null,
      relationship: data.relationship,
      experience: experience.slice(0, 500),
      period: period.slice(0, 100),
      expertisesJson: JSON.stringify({ requested: expertises, endorsed: [] }),
      message: data.message?.trim() || null,
      status: 'pending',
    })

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const link = `${origin}/recommandation/${doc.$id}`

    const body = `
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Bonjour ${recipientName},<br><br>
        <strong>${candidateName}</strong> souhaite mettre en avant votre collaboration passée et vous demande de lui laisser une recommandation sur MyBestConsultant, la plateforme de recrutement qu'${user.firstName} utilise pour sa recherche.
        ${data.message ? `<br><br><em>« ${data.message.trim()} »</em>` : ''}
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px; width:100%; background:#F7F5F0; border-radius:10px;">
        <tr><td style="padding:16px 18px; font-size:13px; line-height:1.7; color:#45454A;">
          <strong>Collaboration concernée</strong><br>
          ${experience}<br>
          Période : ${period}<br>
          Lien : ${RELATIONSHIP_LABEL[data.relationship]}${role ? ` — ${role}` : ''}<br>
          Expertises : ${expertises.join(', ')}
        </td></tr>
      </table>
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Cela ne prend qu'une minute, aucune création de compte n'est nécessaire.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${link}" target="_blank" style="display:inline-block; padding:14px 32px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Laisser une recommandation</a>
        </td></tr>
      </table>
      <p style="margin:0; font-size:12px; line-height:1.6; color:#9B9B9E;">Si le bouton ne fonctionne pas : <a href="${link}" style="color:#E8A33D;">${link}</a></p>
    `

    const targetId = await resolveEmailTargetId(recipientEmail, recipientName)
    await messaging.createEmail(
      ID.unique(),
      `${candidateName} vous demande une recommandation`,
      wrapEmailHtml('Une recommandation vous est demandée', body),
      [], [], [targetId], [], [], [], false, true,
    )

    revalidatePath('/candidate/dashboard')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi de la demande' }
  }
}
