'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID } from '@/lib/appwrite/config'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'

const COL = 'blog_posts'

export interface BlogPost {
  $id: string
  title: string
  slug: string
  excerpt: string
  content: string
  coverImageUrl: string
  author: string
  publishedAt: string
  isPublished: boolean
}

function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function docToPost(doc: Record<string, unknown>): BlogPost {
  return {
    $id: doc.$id as string,
    title: (doc.title as string) ?? '',
    slug: (doc.slug as string) ?? '',
    excerpt: (doc.excerpt as string) ?? '',
    content: (doc.content as string) ?? '',
    coverImageUrl: (doc.coverImageUrl as string) ?? '',
    author: (doc.author as string) ?? '',
    publishedAt: (doc.publishedAt as string) || (doc.$createdAt as string),
    isPublished: Boolean(doc.isPublished),
  }
}

export async function getAdminBlogPosts(): Promise<BlogPost[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COL, [Query.orderDesc('$createdAt'), Query.limit(200)])
  return result.documents.map(docToPost)
}

export async function createBlogPost(data: {
  title: string; excerpt: string; content: string; coverImageUrl: string; author: string; isPublished: boolean
}): Promise<{ post?: BlogPost; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    let slug = slugify(data.title)
    if (!slug) return { error: 'Titre invalide' }

    // Ensure slug uniqueness by appending a suffix on collision
    const existing = await databases.listDocuments(DB_ID, COL, [Query.equal('slug', slug), Query.limit(1)])
    if (existing.documents.length > 0) slug = `${slug}-${Date.now().toString(36)}`

    const doc = await databases.createDocument(DB_ID, COL, ID.unique(), {
      title: data.title,
      slug,
      excerpt: data.excerpt,
      content: data.content,
      coverImageUrl: data.coverImageUrl,
      author: data.author,
      isPublished: data.isPublished,
      publishedAt: new Date().toISOString(),
    })
    revalidatePath('/blog')
    return { post: docToPost(doc as unknown as Record<string, unknown>) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function updateBlogPost(id: string, data: {
  title: string; excerpt: string; content: string; coverImageUrl: string; author: string; isPublished: boolean
}): Promise<{ post?: BlogPost; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    const doc = await databases.updateDocument(DB_ID, COL, id, {
      title: data.title,
      excerpt: data.excerpt,
      content: data.content,
      coverImageUrl: data.coverImageUrl,
      author: data.author,
      isPublished: data.isPublished,
    })
    revalidatePath('/blog')
    return { post: docToPost(doc as unknown as Record<string, unknown>) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function deleteBlogPost(id: string): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    await databases.deleteDocument(DB_ID, COL, id)
    revalidatePath('/blog')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
