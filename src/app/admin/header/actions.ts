'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import type { HeaderConfig, FooterConfig } from '@/types/layout'
import { getSiteConfig, getLayoutConfig } from '@/lib/site-config'

async function getOrCreateLayoutDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.SITE_LAYOUT, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.SITE_LAYOUT, 'unique()', { config: '{}' })
}

export async function saveHeaderConfig(config: HeaderConfig): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const [doc, current] = await Promise.all([getOrCreateLayoutDoc(), getLayoutConfig()])
    await databases.updateDocument(DB_ID, COLLECTIONS.SITE_LAYOUT, doc.$id, {
      config: JSON.stringify({ header: config, footer: current.footer }),
    })
    revalidatePath('/', 'layout')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function saveFooterConfig(config: FooterConfig): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const [doc, current] = await Promise.all([getOrCreateLayoutDoc(), getLayoutConfig()])
    await databases.updateDocument(DB_ID, COLLECTIONS.SITE_LAYOUT, doc.$id, {
      config: JSON.stringify({ header: current.header, footer: config }),
    })
    revalidatePath('/', 'layout')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function uploadLogo(formData: FormData): Promise<{ url: string } | { error: string }> {
  try {
    const file = formData.get('file') as File
    if (!file) return { error: 'Aucun fichier reçu' }

    const { storage, databases } = createAdminClient()

    const bytes = await file.arrayBuffer()
    const blob = new Blob([bytes], { type: file.type })
    const webFile = new File([blob], file.name, { type: file.type })

    const uploaded = await storage.createFile(BUCKETS.LOGOS, 'unique()', webFile)

    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
    const url = `${endpoint}/storage/buckets/${BUCKETS.LOGOS}/files/${uploaded.$id}/view?project=${projectId}`

    // Save logoUrl to site config
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length > 0) {
      await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, result.documents[0].$id, { logoUrl: url })
    }

    revalidatePath('/', 'layout')
    return { url }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload échoué' }
  }
}
