'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import {
  createHunterProfile, deleteHunterProfile, importHunterCv, proposeProfiles, updateHunterProfile,
  type Hunter, type HunterProfile, type ProfileInput,
} from '@/lib/hunter'
import { normalizeWhatsApp } from '@/lib/whatsapp'

async function requireHunter(): Promise<Hunter & { docId: string }> {
  const u = await getCurrentUser()
  if (!u || u.role !== 'hunter') throw new Error('Non autorisé')
  return { userId: u.userId, docId: u.$id, name: `${u.firstName} ${u.lastName}`.trim() || u.email, email: u.email, whatsapp: u.whatsapp }
}

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Erreur' })

export async function importCvAction(formData: FormData): Promise<{ profile?: HunterProfile; extracted?: boolean; error?: string }> {
  try {
    const hunter = await requireHunter()
    const file = formData.get('file')
    if (!(file instanceof File)) return { error: 'Aucun fichier reçu.' }
    const res = await importHunterCv(hunter, file)
    if (res.profile) revalidatePath('/hunter/vivier')
    return res
  } catch (e) { return fail(e) }
}

export async function createProfileAction(input: ProfileInput): Promise<{ profile?: HunterProfile; error?: string }> {
  try {
    const res = await createHunterProfile(await requireHunter(), input)
    if (res.profile) revalidatePath('/hunter/vivier')
    return res
  } catch (e) { return fail(e) }
}

export async function updateProfileAction(profileId: string, input: ProfileInput): Promise<{ profile?: HunterProfile; error?: string }> {
  try {
    const res = await updateHunterProfile(await requireHunter(), profileId, input)
    if (res.profile) revalidatePath('/hunter/vivier')
    return res
  } catch (e) { return fail(e) }
}

export async function deleteProfileAction(profileId: string): Promise<{ error?: string }> {
  try {
    const res = await deleteHunterProfile(await requireHunter(), profileId)
    if (!res.error) revalidatePath('/hunter/vivier')
    return res
  } catch (e) { return fail(e) }
}

export async function proposeAction(jobId: string, profileIds: string[], pitch: string): Promise<{ proposed: number; skipped: string[]; error?: string }> {
  try {
    const res = await proposeProfiles(await requireHunter(), jobId, profileIds, pitch)
    if (res.proposed > 0) { revalidatePath('/hunter/propositions'); revalidatePath('/hunter/dashboard'); revalidatePath('/hunter/vivier') }
    return res
  } catch (e) { return { proposed: 0, skipped: [], error: e instanceof Error ? e.message : 'Erreur' } }
}

/** Coordonnées du chasseur : les recruteurs le contactent sur ce WhatsApp au sujet des profils qu'il propose. */
export async function updateHunterContactAction(input: { whatsapp: string; phone: string }): Promise<{ whatsapp?: string; error?: string }> {
  try {
    const hunter = await requireHunter()
    const wa = normalizeWhatsApp(input.whatsapp)
    if (wa.error) return { error: wa.error }
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.USERS, hunter.docId, {
      whatsapp: wa.e164 || null, phone: input.phone.trim().slice(0, 30) || null,
    })
    revalidatePath('/hunter/dashboard')
    return { whatsapp: wa.e164 ?? '' }
  } catch (e) { return fail(e) }
}
