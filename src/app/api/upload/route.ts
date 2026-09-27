import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { ID } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) return NextResponse.json({ error: 'Fichier trop grand (max 10 Mo)' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const inputFile = InputFile.fromBuffer(buffer, file.name)

    const bucketParam = formData.get('bucket') as string | null
    const bucketId = bucketParam === 'logos'
      ? process.env.APPWRITE_STORAGE_LOGOS!
      : process.env.APPWRITE_STORAGE_CVS!
    const { storage } = createAdminClient()
    const result = await storage.createFile(bucketId, ID.unique(), inputFile)

    const endpoint = process.env.APPWRITE_ENDPOINT!
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
    const url = `${endpoint}/storage/buckets/${bucketId}/files/${result.$id}/view?project=${projectId}`

    return NextResponse.json({ url, fileId: result.$id, name: result.name })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
