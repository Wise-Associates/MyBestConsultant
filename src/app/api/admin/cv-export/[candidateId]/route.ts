import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { CvExportError, bundleCvExport, exportCandidateCv, type CvExportFile } from '@/lib/cv-export/export'
import { cvExportErrorName, isCvExportStorageConfigured, listCvExports, readCvExportFiles, saveCvExports } from '@/lib/cv-export/store'
import { CANDIDATE_ID, storedFor } from '@/lib/cv-export/stored'

// Export d'un candidat de la CV Thèque au format de l'ESN (.docx anonymisé, FR et/ou EN ; .zip pour deux langues).
// Admin seulement. POST génère (deux appels d'IA au plus : jamais depuis un simple lien) et enregistre le résultat ;
// GET télécharge la version enregistrée, sans appel d'IA. Le compte rendu (champs à compléter, contenus non repris)
// est renvoyé dans l'en-tête X-Cv-Export-Notes ; POST indique dans X-Cv-Export-Saved si la version a été enregistrée.
export const maxDuration = 300

const ExportRequest = z.object({
  langs: z.array(z.enum(['fr', 'en'])).min(1).max(2).transform(langs => [...new Set(langs)]),
  mode: z.enum(['standard', 'renforcee']),
})

type SaveStatus = 'saved' | 'failed' | 'off'

// Les appels d'IA peuvent prendre 260 s : l'enregistrement est abandonné avant la fin des 300 s de la fonction, pour
// que le fichier généré soit livré quoi qu'il arrive (Appwrite n'a pas de délai d'attente côté client).
const SAVE_DEADLINE_MS = 285_000
const MIN_SAVE_TIME_MS = 15_000

/** Enregistre la génération dans le temps restant ; un échec est journalisé et signalé, jamais levé. */
async function saveWithinBudget(input: Parameters<typeof saveCvExports>[0], startedAt: number): Promise<SaveStatus> {
  const remaining = SAVE_DEADLINE_MS - (Date.now() - startedAt)
  if (remaining < MIN_SAVE_TIME_MS) {
    console.error('[cv-export] version non enregistrée : plus assez de temps après la génération', input.candidateId)
    return 'failed'
  }
  const saving = saveCvExports(input)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), remaining) })
  try {
    const outcome = await Promise.race([saving, timeout])
    if (outcome === 'saved') return 'saved'
    console.error('[cv-export] version non enregistrée', input.candidateId, outcome === 'timeout' ? 'délai dépassé' : 'candidat supprimé pendant la génération')
    if (outcome === 'timeout') {
      // L'enregistrement continue peut-être : son échec éventuel est journalisé (fichier sans document : supprimé avec le compte).
      saving.catch(err => console.error('[cv-export] enregistrement en échec après le délai', input.candidateId, cvExportErrorName(err)))
    }
    return 'failed'
  } catch (err) {
    console.error('[cv-export] version non enregistrée', input.candidateId, cvExportErrorName(err))
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/** Nom de fichier pour Content-Disposition : version ASCII, plus l'original encodé (RFC 5987). */
function disposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').slice(0, 150) || 'cv.docx'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 200))}`
}

function fileResponse(file: CvExportFile, notes: string[], saved?: SaveStatus): NextResponse {
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': disposition(file.fileName),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'X-Cv-Export-Notes': encodeURIComponent(JSON.stringify(notes)),
      ...(saved ? { 'X-Cv-Export-Saved': saved } : {}),
    },
  })
}

/** Appelant admin et identifiant de candidat valide ; sinon la réponse d'erreur. */
async function authorize(params: Promise<{ candidateId: string }>): Promise<{ candidateId: string } | { denied: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { denied: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  if (user.role !== 'admin') return { denied: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  const { candidateId } = await params
  if (!CANDIDATE_ID.test(candidateId)) return { denied: NextResponse.json({ error: 'Candidat introuvable.' }, { status: 404 }) }
  return { candidateId }
}

function errorResponse(err: unknown, candidateId: string): NextResponse {
  if (err instanceof CvExportError) {
    if (err.status >= 500) {
      // Notre message (sans donnée du CV) et la classe de la cause avec son statut, jamais le message de la cause : une
      // erreur d'API peut recopier la requête, donc le CV.
      const cause = err.cause
      const detail = cause instanceof Error ? `${cause.constructor.name}${'status' in cause ? ` ${String(cause.status)}` : ''}` : ''
      console.error('[cv-export] échec', candidateId, err.status, err.message, detail)
    }
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('[cv-export] échec inattendu', candidateId, err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : String(err))
  return NextResponse.json({ error: 'Export impossible : erreur inattendue. Réessayez ; si cela se répète, signalez-le.' }, { status: 500 })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const startedAt = Date.now()
  // En plus du cookie de session SameSite=Lax : une génération coûte deux appels d'IA, elle ne part que d'une page du
  // site lui-même (un navigateur envoie toujours Sec-Fetch-Site ; son absence = client hors navigateur, avec la session).
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const auth = await authorize(params)
  if ('denied' in auth) return auth.denied
  const { candidateId } = auth
  const body = ExportRequest.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Demande invalide : langues et anonymisation attendues.' }, { status: 400 })

  let result
  try {
    result = await exportCandidateCv(candidateId, body.data)
  } catch (err) {
    return errorResponse(err, candidateId)
  }

  // Les appels d'IA sont faits : un échec d'enregistrement n'empêche pas de livrer le fichier, la fenêtre le signale.
  const saved: SaveStatus = isCvExportStorageConfigured()
    ? await saveWithinBudget({ candidateId, mode: body.data.mode, sourceCvFileId: result.sourceCvFileId, notes: result.notes, files: result.files, now: new Date() }, startedAt)
    : 'off'
  return fileResponse(bundleCvExport(result.files), result.notes, saved)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const auth = await authorize(params)
  if ('denied' in auth) return auth.denied
  const { candidateId } = auth
  const query = ExportRequest.safeParse({ langs: req.nextUrl.searchParams.getAll('lang'), mode: req.nextUrl.searchParams.get('mode') })
  if (!query.success) return NextResponse.json({ error: 'Demande invalide : langues et anonymisation attendues.' }, { status: 400 })
  if (!isCvExportStorageConfigured()) return NextResponse.json({ error: 'Enregistrement des versions non configuré.' }, { status: 404 })

  try {
    const versions = storedFor(await listCvExports(candidateId), query.data.mode, query.data.langs)
    if (!versions) return NextResponse.json({ error: 'Aucune version enregistrée pour ce choix : générez-la.' }, { status: 404 })
    // Compte rendu de la première langue, comme à la génération (deux langues peuvent venir de générations différentes).
    return fileResponse(bundleCvExport(await readCvExportFiles(versions)), versions[0].notes)
  } catch (err) {
    return errorResponse(err, candidateId)
  }
}
