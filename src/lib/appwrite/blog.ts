import { createAdminClient } from './client'
import { DB_ID } from './config'
import { Query } from 'node-appwrite'

const COL = 'blog_posts'

export interface PublicBlogPost {
  $id: string
  title: string
  slug: string
  excerpt: string
  content: string
  coverImageUrl: string
  author: string
  publishedAt: string
}

function docToPost(doc: Record<string, unknown>): PublicBlogPost {
  return {
    $id: doc.$id as string,
    title: (doc.title as string) ?? '',
    slug: (doc.slug as string) ?? '',
    excerpt: (doc.excerpt as string) ?? '',
    content: (doc.content as string) ?? '',
    coverImageUrl: (doc.coverImageUrl as string) ?? '',
    author: (doc.author as string) ?? '',
    publishedAt: (doc.publishedAt as string) || (doc.$createdAt as string),
  }
}

export async function getPublishedBlogPosts(): Promise<PublicBlogPost[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COL, [
    Query.equal('isPublished', true),
    Query.orderDesc('publishedAt'),
    Query.limit(100),
  ])
  return result.documents.map(docToPost)
}

export async function getBlogPostBySlug(slug: string): Promise<PublicBlogPost | null> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COL, [
    Query.equal('slug', slug),
    Query.equal('isPublished', true),
    Query.limit(1),
  ])
  return result.documents[0] ? docToPost(result.documents[0] as unknown as Record<string, unknown>) : null
}
