import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById } from '@/lib/appwrite/jobs'
import { autoScreenApplication } from '@/lib/screening-core'
import {
  APPLY_GENERIC_ERROR, APPLY_REFUSAL_MESSAGE, APPLY_SESSION_EXPIRED, applyRefusal, filesProblem, storageErrorMessage,
} from '@/lib/application-submit'

// Candidature d'un candidat connecté depuis la page publique d'une offre (fenêtre « Postuler », apply-modal.tsx).
// Règles et messages : src/lib/application-submit.ts. Tout est vérifié avant le premier envoi de fichier, et le CV du
// profil n'est remplacé qu'une fois la candidature créée : un échec ne laisse ni profil modifié ni fichier orphelin.

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

const errorInfo = (e: unknown) => {
  const err = e as { code?: unknown; type?: unknown; message?: unknown } | null
  return { code: err?.code, type: err?.type, message: err?.message }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return fail(APPLY_SESSION_EXPIRED, 401)
  if (user.role !== 'candidate') return fail('Seul un compte candidat peut postuler à une offre.', 403)

  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    console.warn('[candidature] formulaire illisible', errorInfo(e))
    return fail(APPLY_GENERIC_ERROR, 400)
  }
  const jobId = form.get('jobId')
  const coverLetterRaw = form.get('coverLetter')
  const coverLetter = typeof coverLetterRaw === 'string' ? coverLetterRaw.trim().slice(0, 3000) : ''
  const cvEntry = form.get('cv')
  const cvFile = cvEntry instanceof File && cvEntry.size > 0 ? cvEntry : null
  const docFiles = form.getAll('docs').filter((d): d is File => d instanceof File && d.size > 0)

  // Organisation de la candidature = celle de l'offre, relue ici (vide pour une offre partagée de la plateforme),
  // jamais une valeur envoyée par le navigateur.
  const job = typeof jobId === 'string' ? await getJobById(jobId) : null
  const refusal = applyRefusal(job, new Date())
  if (refusal || !job) return fail(APPLY_REFUSAL_MESSAGE[refusal ?? 'introuvable'], refusal === 'fermee' ? 409 : 404)

  const problem = filesProblem(cvFile, docFiles)
  if (problem) return fail(problem, 400)
  if (!cvFile && !user.cvFileId) return fail('Ajoutez votre CV pour postuler.', 400)

  const { databases, storage } = createAdminClient()
  const uploaded: string[] = []
  const removeUploaded = async () => {
    for (const fileId of uploaded) {
      await storage.deleteFile(BUCKETS.CVS, fileId).catch(e =>
        console.error('[candidature] fichier envoyé non supprimé après un échec', { fileId, ...errorInfo(e) }))
    }
  }

  try {
    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
      Query.equal('jobId', job.$id),
      Query.equal('candidateId', user.$id),
      Query.limit(1),
    ])
    if (existing.total > 0) return fail('Vous avez déjà postulé à cette offre.', 409)

    let cvFileId = user.cvFileId ?? ''
    if (cvFile) {
      const file = await storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(await cvFile.arrayBuffer()), cvFile.name))
      uploaded.push(file.$id)
      cvFileId = file.$id
    }
    const docIds: string[] = []
    for (const doc of docFiles) {
      const file = await storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(await doc.arrayBuffer()), doc.name))
      uploaded.push(file.$id)
      docIds.push(file.$id)
    }

    const base = { jobId: job.$id, tenantId: job.tenantId, candidateId: user.$id, cvFileId, status: 'pending' }
    const extras = {
      ...(coverLetter ? { coverLetter } : {}),
      ...(docIds.length > 0 ? { documentsJson: JSON.stringify(docIds) } : {}),
    }
    let created
    try {
      created = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), { ...base, ...extras })
    } catch (e) {
      // Projet sans les attributs coverLetter / documentsJson (comportement d'avant, gardé) : candidature créée sans eux.
      const message = String(errorInfo(e).message ?? '')
      if (!message.includes('coverLetter') && !message.includes('documentsJson')) throw e
      console.warn('[candidature] attributs coverLetter / documentsJson absents : candidature créée sans eux')
      created = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), base)
    }

    // Nouveau CV : il devient celui du profil, une fois la candidature enregistrée. Un échec ici n'annule pas la
    // candidature (elle a son CV) : il est journalisé.
    if (cvFile) {
      await databases.updateDocument(DB_ID, COLLECTIONS.USERS, user.$id, { cvFileId }).catch(e =>
        console.error('[candidature] CV du profil non remplacé', { applicationId: created.$id, ...errorInfo(e) }))
    }

    after(() => autoScreenApplication(created.$id))
    return NextResponse.json({ ok: true, id: created.$id })
  } catch (e) {
    await removeUploaded()
    const info = errorInfo(e)
    console.error('[candidature] échec', { jobId: job.$id, ...info })
    const message = storageErrorMessage(info.type)
    return message ? fail(message, 400) : fail(APPLY_GENERIC_ERROR, 500)
  }
}
