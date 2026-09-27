'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID } from '@/lib/appwrite/config'
import { Query, ID } from 'node-appwrite'
import type { PageSection } from './types'
import type { NavLink } from '@/types/layout'
import { getLayoutConfig } from '@/lib/site-config'
import { saveHeaderConfig } from '@/app/admin/header/actions'

const COL = 'pages'

export type ActionResult = { ok: true } | { error: string }

export async function getPages() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return result.documents
}

export async function getPublishedPages(): Promise<{ title: string; slug: string }[]> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COL, [
      Query.equal('isPublished', true),
      Query.orderAsc('$createdAt'),
      Query.limit(20),
    ])
    return result.documents.map(d => ({ title: d.title, slug: d.slug }))
  } catch {
    return []
  }
}

export async function getPage(id: string) {
  const { databases } = createAdminClient()
  return databases.getDocument(DB_ID, COL, id)
}

// redirect() must be OUTSIDE try/catch — Next.js implements it as a thrown exception
export async function createPage(data: {
  title: string
  slug: string
  metaDescription: string
}): Promise<ActionResult> {
  let docId: string

  try {
    const { databases } = createAdminClient()
    const doc = await databases.createDocument(DB_ID, COL, ID.unique(), {
      ...data,
      sections: JSON.stringify([]),
      isPublished: false,
      createdAt: new Date().toISOString(),
    })
    revalidatePath('/admin/pages')
    docId = doc.$id
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur création page' }
  }

  redirect(`/admin/pages/${docId}`)
}

export async function savePage(
  id: string,
  sections: PageSection[],
  meta: { title: string; slug: string; metaDescription: string; metaKeywords: string; isPublished: boolean }
): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COL, id, {
      sections: JSON.stringify(sections),
      title: meta.title,
      slug: meta.slug,
      metaDescription: meta.metaDescription,
      metaKeywords: meta.metaKeywords,
      isPublished: meta.isPublished,
    })
    revalidatePath(`/${meta.slug}`)
    revalidatePath('/admin/pages')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur sauvegarde' }
  }
}

export async function deletePage(id: string): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    await databases.deleteDocument(DB_ID, COL, id)
    revalidatePath('/admin/pages')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur suppression' }
  }
}

export async function togglePublished(id: string, isPublished: boolean): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COL, id, { isPublished })
    revalidatePath('/admin/pages')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur publication' }
  }
}

export async function setHomepage(id: string): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    // Unset current homepage
    const existing = await databases.listDocuments(DB_ID, COL, [Query.equal('isHomepage', true), Query.limit(10)])
    await Promise.all(existing.documents.map(doc =>
      databases.updateDocument(DB_ID, COL, doc.$id, { isHomepage: false })
    ))
    // Set new homepage
    await databases.updateDocument(DB_ID, COL, id, { isHomepage: true })
    revalidatePath('/')
    revalidatePath('/admin/pages')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur définition homepage' }
  }
}

export async function unsetHomepage(id: string): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COL, id, { isHomepage: false })
    revalidatePath('/')
    revalidatePath('/admin/pages')
    revalidatePath('/admin/homepage')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur' }
  }
}

export async function ensureHomepage(): Promise<string> {
  const { databases } = createAdminClient()
  const existing = await databases.listDocuments(DB_ID, COL, [
    Query.equal('isHomepage', true),
    Query.limit(1),
  ])
  if (existing.documents.length > 0) return existing.documents[0].$id

  // Reuse an existing "home"-slug page instead of creating a second, disconnected
  // doc with generic placeholder content — /admin/homepage always edits this one.
  const bySlug = await databases.listDocuments(DB_ID, COL, [
    Query.equal('slug', 'home'),
    Query.limit(1),
  ])
  if (bySlug.documents.length > 0) {
    const doc = bySlug.documents[0]
    await databases.updateDocument(DB_ID, COL, doc.$id, { isHomepage: true, isPublished: true })
    return doc.$id
  }

  // Empty by default — the real homepage content is the video carousel (edited via
  // HomepageEditor). This doc only holds whatever the admin explicitly adds below it.
  const doc = await databases.createDocument(DB_ID, COL, ID.unique(), {
    title: "Page d'accueil",
    slug: 'home',
    metaDescription: '',
    sections: JSON.stringify([] as PageSection[]),
    isPublished: true,
    isHomepage: true,
    createdAt: new Date().toISOString(),
  })
  return doc.$id
}

export async function getNavLinks(): Promise<NavLink[]> {
  const { header } = await getLayoutConfig()
  return header.navLinks
}

export async function saveNavLinks(navLinks: NavLink[]): Promise<ActionResult> {
  const { header } = await getLayoutConfig()
  const result = await saveHeaderConfig({ ...header, navLinks })
  if (result.error) return { error: result.error }
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function getHomepage() {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COL, [
      Query.equal('isHomepage', true),
      Query.equal('isPublished', true),
      Query.limit(1),
    ])
    if (result.documents.length === 0) return null
    const doc = result.documents[0]
    return { sections: doc.sections ?? '[]' }
  } catch {
    return null
  }
}
