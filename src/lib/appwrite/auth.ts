import { cookies } from 'next/headers'
import { createAdminClient, createSessionClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from './config'
import { AppwriteException, ID, Query, type Models } from 'node-appwrite'
import type { UserProfile, UserRole } from '@/types'
import { READABLE_SLUG_ATTEMPTS, slugCandidate } from '@/lib/tenant-slug'

const SESSION_COOKIE = 'mbc-session'
const ROLE_COOKIE = 'mbc-role'

// ── Session helpers ──────────────────────────────────────────────

export async function createSession(email: string, password: string) {
  const { account } = createAdminClient()
  return account.createEmailPasswordSession(email, password)
}

export async function deleteSession() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value
  if (sessionToken) {
    try {
      const { account } = createSessionClient(sessionToken)
      await account.deleteSession('current')
    } catch {
      // session may already be expired
    }
  }
  cookieStore.delete(SESSION_COOKIE)
  cookieStore.delete(ROLE_COOKIE)
}

export async function setSessionCookies(sessionToken: string, role: UserRole) {
  const cookieStore = await cookies()
  const isProduction = process.env.NODE_ENV === 'production'
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  cookieStore.set(ROLE_COOKIE, role, {
    httpOnly: false, // readable by middleware
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE)?.value ?? null
}

// ── Current user ─────────────────────────────────────────────────

/**
 * Creates a NEW organisation owned by `recruiterId`. A name typed at sign-up never joins an existing organisation
 * (anyone could otherwise enter a company by typing its name and see its data): colleagues join through invitations
 * (src/lib/team.ts). `slug` has a unique index, so a taken slug is retried with a suffix (src/lib/tenant-slug.ts).
 */
async function createTenantForRecruiter(recruiterId: string, companyNameHint: string): Promise<string> {
  const { databases } = createAdminClient()
  const companyName = companyNameHint.trim() || 'Entreprise'
  for (let attempt = 0; ; attempt++) {
    try {
      const tenant = await databases.createDocument(DB_ID, COLLECTIONS.TENANTS, ID.unique(), {
        name: companyName,
        slug: slugCandidate(companyName, attempt, () => ID.unique().slice(-6)),
        recruiterId,
        // Every account starts on Free — the admin Abonnements dashboard manages upgrades from here.
        plan: 'free',
        subscriptionStatus: 'active',
      })
      return tenant.$id
    } catch (err) {
      // 409: slug already taken (unique index) — try the next candidate; anything else is a real failure.
      if ((err as { code?: number }).code !== 409 || attempt >= READABLE_SLUG_ATTEMPTS + 2) throw err
    }
  }
}

// A valid Appwrite Auth account can end up without a USERS profile document if a
// previous registration attempt failed partway through (see createUserAccountAndProfile).
// Rather than leaving that person permanently locked out, rebuild the missing profile
// from their Appwrite Auth record so they can log in normally. Recruiters also need a
// tenant to use their dashboard (/recruiter/dashboard redirects without one) — heal that
// too, both for freshly-rebuilt profiles and for existing ones missing it.
export async function getOrCreateUserProfile(authUserId: string): Promise<Models.Document> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
    Query.equal('userId', authUserId),
    Query.limit(1),
  ])

  if (result.documents.length > 0) {
    const doc = result.documents[0]
    if (doc.role === 'recruiter' && !doc.tenantId) {
      const tenantId = await createTenantForRecruiter(authUserId, `${doc.firstName ?? ''} ${doc.lastName ?? ''}`)
      return databases.updateDocument(DB_ID, COLLECTIONS.USERS, doc.$id, { tenantId })
    }
    return doc
  }

  const { users } = createAdminClient()
  const authRecord = await users.get(authUserId)
  const role = (authRecord.labels[0] as UserRole) ?? 'candidate'
  const [firstName, ...rest] = authRecord.name.split(' ')
  const tenantId = role === 'recruiter' ? await createTenantForRecruiter(authUserId, authRecord.name) : null

  return databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
    userId: authUserId,
    role,
    firstName: firstName || authRecord.name || '',
    lastName: rest.join(' '),
    email: authRecord.email,
    tenantId,
  })
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const sessionToken = await getSessionToken()
  if (!sessionToken) return null

  try {
    const { account } = createSessionClient(sessionToken)
    const authUser = await account.get()

    const doc = await getOrCreateUserProfile(authUser.$id)
    return {
      $id: doc.$id,
      userId: doc.userId,
      role: doc.role as UserRole,
      tenantId: doc.tenantId,
      firstName: doc.firstName,
      lastName: doc.lastName,
      email: doc.email,
      companyName: doc.companyName as string | undefined,
      phone: doc.phone as string | undefined,
      city: doc.city as string | undefined,
      mobilityRadiusKm: doc.mobilityRadiusKm as number | undefined,
      cvProfileJson: doc.cvProfileJson as string | undefined,
      cvFileId: doc.cvFileId,
      openToWork: doc.openToWork as boolean | undefined,
      desiredSector: doc.desiredSector ? (doc.desiredSector as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      desiredRoles: doc.desiredRoles ? (doc.desiredRoles as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      photoUrl: doc.photoUrl as string | undefined,
      linkedinUrl: doc.linkedinUrl as string | undefined,
      whatsapp: (doc.whatsapp as string | null) || undefined,
      createdAt: doc.$createdAt,
      emailVerification: authUser.emailVerification,
    }
  } catch {
    return null
  }
}

// Server Actions are public POST endpoints: the admin layout only guards page rendering,
// so every admin action must check the caller itself.
export async function requireAdmin(): Promise<UserProfile> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

// ── Register ─────────────────────────────────────────────────────

export async function createUserAccountAndProfile(params: {
  email: string
  password: string
  firstName: string
  lastName: string
  role: UserRole
  companyName?: string
  phone?: string
}): Promise<{ authUserId: string; tenantId?: string }> {
  const { account, databases, users } = createAdminClient()

  // 1. Create Appwrite auth account
  const authUser = await account.create(
    ID.unique(),
    params.email,
    params.password,
    `${params.firstName} ${params.lastName}`,
  )

  // Steps 2-4 must all succeed, or the auth account becomes an orphan (exists in
  // Appwrite Auth but has no USERS profile document, so the person can never log
  // in again yet can't re-register either since the email is taken). If anything
  // fails here, roll back by deleting the auth account so the email is free again.
  try {
    // 2. Add role label via Users admin API
    await users.updateLabels(authUser.$id, [params.role])

    // 3. A recruiter always gets their own new organisation (see createTenantForRecruiter): colleagues of an
    // existing one join through an invitation, never by typing the same company name.
    let tenantId: string | undefined
    if (params.role === 'recruiter' && params.companyName) {
      tenantId = await createTenantForRecruiter(authUser.$id, params.companyName)
    }

    // 4. Create user profile document
    await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
      userId: authUser.$id,
      role: params.role,
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      tenantId: tenantId ?? null,
      phone: params.phone ? params.phone.slice(0, 30) : null,
    })

    return { authUserId: authUser.$id, tenantId }
  } catch (err) {
    try { await users.delete(authUser.$id) } catch { /* best effort rollback */ }
    throw err
  }
}

export async function registerUser(params: {
  email: string
  password: string
  firstName: string
  lastName: string
  role: UserRole
  companyName?: string
  phone?: string
}) {
  await createUserAccountAndProfile(params)

  // Create session for the newly registered user
  const { account } = createAdminClient()
  const session = await account.createEmailPasswordSession(params.email, params.password)

  // Best-effort: send the verification email right away. Must not block registration
  // if SMTP is down or misconfigured.
  try {
    const { account: sessionAccount } = createSessionClient(session.secret)
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    await sessionAccount.createVerification(`${origin}/verify-email/confirm`)
  } catch (err) {
    // L'inscription continue (l'email se redemande depuis /verify-email), mais l'échec est journalisé : sans SMTP sur le
    // serveur Appwrite (« general_smtp_disabled »), ou avec un NEXT_PUBLIC_APP_URL dont l'hôte n'est pas une plateforme Web
    // du projet (« general_argument_invalid »), aucun email de vérification ne part.
    console.error('[auth] email de vérification non envoyé à l’inscription :', err instanceof AppwriteException ? `${err.type} — ${err.message}` : err instanceof Error ? err.message : err)
  }

  return { session, role: params.role }
}
