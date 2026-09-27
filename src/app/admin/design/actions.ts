'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query, ID } from 'node-appwrite'

export type ActionResult = { ok: true } | { error: string }

async function getOrCreateConfigDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, ID.unique(), {
    activeTemplate: 'modern_blue',
  })
}

export async function updateTemplate(templateId: string): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    const doc = await getOrCreateConfigDoc()
    await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, doc.$id, { activeTemplate: templateId })
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur inconnue' }
  }
}

export async function updateCustomColors(colors: Record<string, string>): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    const doc = await getOrCreateConfigDoc()
    // Preserve __scenes, __llm, __contactEmail, __trustedLogos, __googleTagId and __homepage when updating design colors
    const existing = doc.customColors ? JSON.parse(doc.customColors as string) : {}
    const merged = { ...colors }
    if (existing.__scenes) merged.__scenes = existing.__scenes
    if (existing.__llm) merged.__llm = existing.__llm
    if (existing.__contactEmail) merged.__contactEmail = existing.__contactEmail
    if (existing.__trustedLogos) merged.__trustedLogos = existing.__trustedLogos
    if (existing.__googleTagId) merged.__googleTagId = existing.__googleTagId
    if (existing.__homepage) merged.__homepage = existing.__homepage
    await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, doc.$id, {
      customColors: JSON.stringify(merged),
    })
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur inconnue' }
  }
}

export async function updateSiteContent(data: Record<string, string>): Promise<ActionResult> {
  try {
    const { databases } = createAdminClient()
    const doc = await getOrCreateConfigDoc()

    // scenesJson, contactEmail, trustedLogosJson, googleTagId and the SEO fields have no
    // dedicated attribute (attr limit reached). Merge them into the customColors JSON field
    // under their own keys.
    const { scenesJson, contactEmail, trustedLogosJson, googleTagId, seoTitle, seoDescription, seoKeywords, homepageContentJson, ...rest } = data
    const payload: Record<string, string> = { ...rest }

    if (scenesJson !== undefined || contactEmail !== undefined || trustedLogosJson !== undefined || googleTagId !== undefined
      || seoTitle !== undefined || seoDescription !== undefined || seoKeywords !== undefined || homepageContentJson !== undefined) {
      const existingColors = doc.customColors ? JSON.parse(doc.customColors as string) : {}
      if (scenesJson !== undefined) existingColors.__scenes = scenesJson
      if (contactEmail !== undefined) existingColors.__contactEmail = contactEmail
      if (trustedLogosJson !== undefined) existingColors.__trustedLogos = JSON.parse(trustedLogosJson)
      if (googleTagId !== undefined) existingColors.__googleTagId = googleTagId
      if (seoTitle !== undefined) existingColors.__seoTitle = seoTitle
      if (seoDescription !== undefined) existingColors.__seoDescription = seoDescription
      if (seoKeywords !== undefined) existingColors.__seoKeywords = seoKeywords
      if (homepageContentJson !== undefined) existingColors.__homepage = homepageContentJson
      // __llm is preserved automatically since we spread existingColors
      payload.customColors = JSON.stringify(existingColors)
    }

    await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, doc.$id, payload)
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur inconnue' }
  }
}
