'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { SAVED_SEARCHES_MAX, parseSavedSearchInput, type SavedSearch } from '@/lib/saved-searches'
import {
  createSavedSearch, deleteSavedSearch, isSavedSearchesConfigured, setSavedSearchFlags, updateSavedSearch,
} from '@/lib/saved-searches-store'

// Recherches enregistrées de la CV Thèque (ADR 0046), pour la CV Thèque et la page « Alertes ». Chaque action vérifie
// le recruteur de la session ; une recherche est personnelle : celle d'un autre est « introuvable ».

type Result = { search?: SavedSearch; error?: string }

const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'
const NOT_FOUND = 'Recherche introuvable : elle a peut-être été supprimée. Rechargez la page.'
const NOT_CONFIGURED = 'Les recherches enregistrées ne sont pas encore activées sur la plateforme.'
const FAILED = 'L’enregistrement a échoué. Réessayez dans quelques instants.'
// Les alertes partent par e-mail : adresse vérifiée exigée, comme pour les autres envois (inscription libre : un compte
// ouvert avec l'adresse d'un tiers lui ferait envoyer des e-mails de la plateforme). Retirer ou couper reste permis.
const UNVERIFIED = 'Vérifiez votre adresse e-mail (lien reçu à l’inscription) pour enregistrer des recherches et recevoir leurs alertes.'
const IdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/)

async function recruiter() {
  const user = await getCurrentUser()
  return user && user.role === 'recruiter' && user.tenantId
    ? { ownerId: user.$id, tenantId: user.tenantId, emailVerified: user.emailVerification === true }
    : null
}

function revalidate() {
  revalidatePath('/recruiter/alertes')
  revalidatePath('/recruiter/cvtheque')
}

function failed(action: string, err: unknown): Result {
  console.error(`[recherches] ${action} en échec`, err instanceof Error ? err.message : String(err))
  return { error: FAILED }
}

/** Enregistre les filtres de la liste sous un nom (fenêtre « Enregistrer la recherche »). */
export async function createSavedSearchAction(raw: unknown): Promise<Result> {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!isSavedSearchesConfigured()) return { error: NOT_CONFIGURED }
  if (!me.emailVerified) return { error: UNVERIFIED }
  const parsed = parseSavedSearchInput(raw)
  if ('error' in parsed) return parsed
  try {
    const search = await createSavedSearch(me, parsed.input)
    if (search === 'full') return { error: `Vous avez déjà ${SAVED_SEARCHES_MAX} recherches enregistrées : supprimez-en une pour en ajouter.` }
    revalidate()
    return { search }
  } catch (err) {
    return failed('création', err)
  }
}

/** Remplace le nom, la description, l'e-mail et les filtres d'une recherche du recruteur. */
export async function updateSavedSearchAction(id: unknown, raw: unknown): Promise<Result> {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!isSavedSearchesConfigured()) return { error: NOT_CONFIGURED }
  const searchId = IdSchema.safeParse(id)
  if (!searchId.success) return { error: NOT_FOUND }
  if (!me.emailVerified) return { error: UNVERIFIED }
  const parsed = parseSavedSearchInput(raw)
  if ('error' in parsed) return parsed
  try {
    const search = await updateSavedSearch(me.ownerId, searchId.data, parsed.input)
    if (!search) return { error: NOT_FOUND }
    revalidate()
    return { search }
  } catch (err) {
    return failed('modification', err)
  }
}

const FlagsSchema = z.object({ active: z.boolean().optional(), emailAlerts: z.boolean().optional() }).strict()
  .refine(f => f.active !== undefined || f.emailAlerts !== undefined)

/** Active ou désactive la recherche, ou ses e-mails. */
export async function setSavedSearchFlagsAction(id: unknown, flags: unknown): Promise<Result> {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!isSavedSearchesConfigured()) return { error: NOT_CONFIGURED }
  const searchId = IdSchema.safeParse(id)
  const parsed = FlagsSchema.safeParse(flags)
  if (!searchId.success || !parsed.success) return { error: NOT_FOUND }
  if (!me.emailVerified && (parsed.data.active === true || parsed.data.emailAlerts === true)) return { error: UNVERIFIED }
  try {
    const search = await setSavedSearchFlags(me.ownerId, searchId.data, parsed.data)
    if (!search) return { error: NOT_FOUND }
    revalidate()
    return { search }
  } catch (err) {
    return failed('réglage', err)
  }
}

export async function deleteSavedSearchAction(id: unknown): Promise<{ error?: string }> {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!isSavedSearchesConfigured()) return { error: NOT_CONFIGURED }
  const searchId = IdSchema.safeParse(id)
  if (!searchId.success) return { error: NOT_FOUND }
  try {
    if (!await deleteSavedSearch(me.ownerId, searchId.data)) return { error: NOT_FOUND }
    revalidate()
    return {}
  } catch (err) {
    return failed('suppression', err)
  }
}
