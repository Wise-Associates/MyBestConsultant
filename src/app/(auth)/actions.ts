'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { translateAuthError, EMAIL_EXISTS } from '@/lib/appwrite/auth-errors'
import {
  createSession,
  deleteSession,
  registerUser,
  setSessionCookies,
  getOrCreateUserProfile,
} from '@/lib/appwrite/auth'
import type { UserRole } from '@/types'

// ── Schemas ──────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
})

const registerSchema = z.object({
  firstName: z.string().min(1, 'Requis'),
  lastName: z.string().min(1, 'Requis'),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  role: z.enum(['candidate', 'recruiter', 'hunter']),
  companyName: z.string().optional(),
  phone: z.string().optional(),
})

export type ActionResult = { error: string } | { success: true }

// ── Login ────────────────────────────────────────────────────────

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const raw = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  let role: UserRole = 'candidate'

  try {
    const session = await createSession(parsed.data.email, parsed.data.password)

    // Look up (or self-heal) the profile document by userId — reliable even if a
    // previous registration attempt left this account without a profile document.
    const profile = await getOrCreateUserProfile(session.userId)
    role = (profile.role as UserRole) ?? 'candidate'

    await setSessionCookies(session.secret, role)
  } catch (err: unknown) {
    return { error: translateAuthError(err, 'login') }
  }

  // Redirect outside try/catch (Next.js redirect throws internally)
  redirect(getDashboardPath(role))
}

export async function registerAction(formData: FormData): Promise<ActionResult> {
  const raw = {
    firstName: formData.get('firstName') as string,
    lastName: formData.get('lastName') as string,
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    role: formData.get('role') as string,
    companyName: (formData.get('companyName') as string) || undefined,
    phone: (formData.get('phone') as string) || undefined,
  }

  const parsed = registerSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  if (parsed.data.role === 'recruiter' && !parsed.data.companyName) {
    return { error: "Le nom de l'entreprise est requis pour un recruteur" }
  }
  if (parsed.data.role === 'hunter' && !parsed.data.phone) {
    return { error: 'Le numéro de téléphone est requis pour un chasseur' }
  }
  if (parsed.data.role === 'recruiter' && !parsed.data.phone) {
    return { error: 'Le numéro de téléphone est requis pour un recruteur' }
  }

  // Adresse déjà utilisée : on le dit clairement AVANT de créer quoi que ce soit (le serveur ne renvoie sinon
  // qu'une erreur générique en anglais).
  try {
    const { users } = createAdminClient()
    const existing = await users.list([Query.equal('email', [parsed.data.email.trim().toLowerCase()]), Query.limit(1)])
    if (existing.total > 0) return { error: EMAIL_EXISTS }
  } catch { /* vérification best-effort : la création remontera l'erreur le cas échéant */ }

  try {
    const { session, role } = await registerUser(parsed.data)
    await setSessionCookies(session.secret, role)
  } catch (err: unknown) {
    // Message français clair, jamais l'erreur brute du serveur (voir lib/appwrite/auth-errors).
    return { error: translateAuthError(err, 'register') }
  }

  redirect(getDashboardPath(parsed.data.role))
}

export async function logoutAction() {
  await deleteSession()
  redirect('/login')
}

// ── Helpers ──────────────────────────────────────────────────────

function getDashboardPath(role: UserRole | string | null): string {
  switch (role) {
    case 'admin': return '/admin/dashboard'
    case 'recruiter':   return '/recruiter/dashboard'
    case 'candidate':   return '/candidate/dashboard'
    default:            return '/candidate/dashboard'
  }
}

