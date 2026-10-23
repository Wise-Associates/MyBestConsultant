'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { deliverSocialPost, deliveryDeadline, listRecentPosts, prepareSocialPost, retryPost, saveSocialConfig, sendTestToMake, testZernioInstagram, type SocialPost } from '@/lib/social'
import type { SocialConfig } from '@/lib/social-content'

async function requireAdmin() {
  const u = await getCurrentUser()
  if (!u || u.role !== 'admin') throw new Error('Non autorisé')
  return `${u.firstName} ${u.lastName}`.trim() || u.email
}

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Erreur' })

export async function saveSocialConfigAction(cfg: SocialConfig): Promise<{ config?: SocialConfig; error?: string }> {
  try {
    await requireAdmin()
    const config = await saveSocialConfig(cfg)
    revalidatePath('/admin/social')
    return { config }
  } catch (e) { return fail(e) }
}

export async function sendTestAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await requireAdmin()
    const r = await sendTestToMake()
    return { ok: r.ok, message: r.ok ? 'Le service de diffusion a bien reçu le test.' : r.error ?? 'Échec' }
  } catch (e) { return { ok: false, message: (fail(e).error) } }
}

export async function testZernioInstagramAction(): Promise<{ ok: boolean; message: string; permalink?: string }> {
  try {
    await requireAdmin()
    const r = await testZernioInstagram()
    if (r.ok) return { ok: true, message: `Publié sur Instagram via Zernio (statut : ${r.status}).`, permalink: r.permalink }
    return { ok: false, message: r.error ?? 'Échec' }
  } catch (e) { return { ok: false, message: fail(e).error } }
}

export async function publishJobAction(jobId: string, force = false): Promise<{ id?: string; message: string; error?: string }> {
  const requestStart = Date.now()
  try {
    const who = await requireAdmin()
    const r = await prepareSocialPost(jobId, { trigger: 'manual', requestedBy: who, force })
    revalidatePath('/admin/social')
    if (r.error) return { error: r.error, message: r.error }
    if (r.skipped || !r.id) return { id: r.id, message: 'Cette offre a déjà une publication en cours ou terminée (utilisez « Republier » pour la refaire).' }
    // Photo de l'affiche (jusqu'à 2 min) puis envoi à Make, après la réponse.
    const id = r.id
    after(() => deliverSocialPost(id, deliveryDeadline(requestStart)))
    return { id, message: 'Publication lancée : le visuel est en cours de création.' }
  } catch (e) { return { error: fail(e).error, message: fail(e).error } }
}

export async function retryPostAction(id: string): Promise<{ status?: string; error?: string }> {
  const requestStart = Date.now()
  try {
    await requireAdmin()
    const r = await retryPost(id)
    revalidatePath('/admin/social')
    if (r.error || !r.id) return { error: r.error ?? 'Relance impossible.' }
    // Photo (si elle manque) puis envoi à Make, après la réponse.
    const queuedId = r.id
    after(() => deliverSocialPost(queuedId, deliveryDeadline(requestStart)))
    return { status: r.status }
  } catch (e) { return fail(e) }
}

export async function refreshPostsAction(): Promise<SocialPost[]> {
  await requireAdmin()
  return listRecentPosts(60)
}
