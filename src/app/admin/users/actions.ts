'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser, createUserAccountAndProfile } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@/types'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

export interface AdminUserRow {
  authId: string
  profileId: string | null
  firstName: string
  lastName: string
  email: string
  role: UserRole
  tenantId: string | null
  companyName: string | null
  status: boolean
  createdAt: string
}

export async function listAllUsers(): Promise<{ users: AdminUserRow[]; tenants: Record<string, string>; error?: string }> {
  try {
    await requireAdmin()
    const { databases, users } = createAdminClient()

    const [authRes, profileRes, tenantsRes] = await Promise.all([
      users.list([Query.limit(500)]),
      databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.limit(500)]),
      databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.limit(200)]),
    ])

    const profileByAuthId = new Map(profileRes.documents.map(d => [d.userId as string, d]))
    const tenants: Record<string, string> = {}
    for (const t of tenantsRes.documents) tenants[t.$id] = t.name as string

    const rows: AdminUserRow[] = authRes.users.map(u => {
      const profile = profileByAuthId.get(u.$id)
      const [nameFirst, ...nameRest] = u.name.split(' ')
      const role = ((profile?.role as UserRole) ?? (u.labels[0] as UserRole) ?? 'candidate')
      const tenantId = (profile?.tenantId as string) || null
      return {
        authId: u.$id,
        profileId: profile?.$id ?? null,
        firstName: (profile?.firstName as string) ?? nameFirst ?? '',
        lastName: (profile?.lastName as string) ?? nameRest.join(' '),
        email: (profile?.email as string) || u.email,
        role,
        tenantId,
        companyName: (profile?.companyName as string) || (tenantId ? tenants[tenantId] ?? null : null),
        status: u.status,
        createdAt: u.registration,
      }
    })

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return { users: rows, tenants }
  } catch (e) {
    return { users: [], tenants: {}, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function createUserManually(params: {
  email: string
  password: string
  firstName: string
  lastName: string
  role: UserRole
  companyName?: string
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    if (!params.email.trim() || !params.password || params.password.length < 8) {
      return { error: 'Email requis et mot de passe d\'au moins 8 caractères' }
    }
    await createUserAccountAndProfile(params)
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function toggleUserStatus(authId: string, active: boolean): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await requireAdmin()
    if (admin.userId === authId) return { error: 'Vous ne pouvez pas désactiver votre propre compte' }
    const { users } = createAdminClient()
    await users.updateStatus(authId, active)
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function deleteUserAccount(authId: string, profileId: string | null): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await requireAdmin()
    if (admin.userId === authId) return { error: 'Vous ne pouvez pas supprimer votre propre compte' }
    const { users, databases } = createAdminClient()
    await users.delete(authId)
    if (profileId) {
      try {
        await databases.deleteDocument(DB_ID, COLLECTIONS.USERS, profileId)
      } catch { /* profile doc may already be gone */ }
    }
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}
