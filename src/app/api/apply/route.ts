import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    if (user.role !== 'candidate') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const form = await req.formData()
    const jobId = form.get('jobId') as string
    const tenantId = form.get('tenantId') as string
    const coverLetter = (form.get('coverLetter') as string | null) ?? ''
    const cvFile = form.get('cv') as File | null
    const docFiles = form.getAll('docs') as File[]

    if (!jobId || !tenantId) return NextResponse.json({ error: 'Données manquantes' }, { status: 400 })

    const { databases, storage } = createAdminClient()

    // Check already applied
    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
      Query.equal('jobId', jobId),
      Query.equal('candidateId', user.$id),
      Query.limit(1),
    ])
    if (existing.total > 0) return NextResponse.json({ error: 'Déjà candidaté' }, { status: 409 })

    // Upload CV if provided
    let cvFileId = user.cvFileId ?? ''
    if (cvFile && cvFile.size > 0) {
      const buf = Buffer.from(await cvFile.arrayBuffer())
      const uploaded = await storage.createFile(
        BUCKETS.CVS,
        ID.unique(),
        InputFile.fromBuffer(buf, cvFile.name),
      )
      cvFileId = uploaded.$id
      // Update user's cvFileId
      await databases.updateDocument(DB_ID, COLLECTIONS.USERS, user.$id, { cvFileId })
    }

    if (!cvFileId) return NextResponse.json({ error: 'CV requis pour postuler' }, { status: 400 })

    // Upload additional docs
    const docIds: string[] = []
    for (const doc of docFiles) {
      if (doc.size === 0) continue
      const buf = Buffer.from(await doc.arrayBuffer())
      const uploaded = await storage.createFile(
        BUCKETS.CVS,
        ID.unique(),
        InputFile.fromBuffer(buf, doc.name),
      )
      docIds.push(uploaded.$id)
    }

    // Create application
    const appData: Record<string, unknown> = {
      jobId,
      tenantId,
      candidateId: user.$id,
      cvFileId,
      status: 'pending',
    }
    // Try coverLetter + documentsJson (may not exist yet if setup-attrs hasn't run)
    if (coverLetter) {
      try { appData.coverLetter = coverLetter.slice(0, 3000) } catch { /* ignore */ }
    }
    if (docIds.length > 0) {
      try { appData.documentsJson = JSON.stringify(docIds) } catch { /* ignore */ }
    }

    let created
    try {
      created = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), appData)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('coverLetter') || msg.includes('documentsJson')) {
        // Attributes not created yet — retry without them
        delete appData.coverLetter
        delete appData.documentsJson
        created = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), appData)
      } else {
        throw e
      }
    }

    after(() => autoScreenApplication(created.$id))

    return NextResponse.json({ ok: true, id: created.$id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
