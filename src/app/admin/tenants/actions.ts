'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'

function slugify(str: string) {
  return str.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function createTenant(formData: FormData): Promise<{ error?: string }> {
  const name = (formData.get('name') as string ?? '').trim()
  const email = (formData.get('email') as string ?? '').trim()
  const firstName = (formData.get('firstName') as string ?? '').trim()
  const lastName = (formData.get('lastName') as string ?? '').trim()
  const password = (formData.get('password') as string ?? '').trim()

  if (!name || !email || !firstName || !lastName || !password)
    return { error: 'Tous les champs sont requis.' }
  if (password.length < 8)
    return { error: 'Le mot de passe doit faire au moins 8 caractères.' }

  const { databases, users: usersClient } = createAdminClient()

  // Check slug uniqueness
  const slug = slugify(name)
  const existing = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('slug', slug), Query.limit(1)])
  if (existing.documents.length > 0)
    return { error: `Le slug "${slug}" est déjà pris. Choisissez un autre nom.` }

  // Create Appwrite auth account for recruiter
  let authUser
  try {
    authUser = await usersClient.create(ID.unique(), email, undefined, password, `${firstName} ${lastName}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('already exists') || msg.includes('conflict'))
      return { error: `L'email ${email} est déjà utilisé.` }
    return { error: `Erreur création compte : ${msg}` }
  }

  // Create tenant doc
  const tenantId = ID.unique()
  await databases.createDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, {
    name,
    slug,
    recruiterId: authUser.$id,
  })

  // Create user profile doc
  await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
    userId: authUser.$id,
    role: 'recruiter',
    tenantId,
    firstName,
    lastName,
    email,
    companyName: name,
  })

  revalidatePath('/admin/tenants')
  return {}
}
