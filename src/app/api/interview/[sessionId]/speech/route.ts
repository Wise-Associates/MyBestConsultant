import { NextResponse, type NextRequest } from 'next/server'
import { readBoundedBody } from '@/lib/http/read-bounded-body'
import { ROOM_LIMITS, questionTexts } from '@/lib/interview-room'
import { liveRoomSession, takeSpeechSlot } from '@/lib/interview-room-access'
import { parseSpeechLine } from '@/lib/interview-speech-request'
import { synthesizeInterviewVoice } from '@/lib/interview-voice'
import { lineText } from '@/lib/voice-turn'

// Voix d'Alex dans l'entretien vocal (/interview/<id>/v2, ADR 0052) : le MP3 d'une phrase. Une route et non une Server
// Action : le navigateur exécute les Server Actions une par une, et la voix de la question suivante est préparée pendant
// que le candidat répond (sa transcription, une action, attendrait derrière elle). Pas de compte : le lien de l'entretien
// donne accès, comme aux actions de la salle.
// Revue de sécurité du 2026-11-20 : la voix est payante au caractère et la route publique, donc elle ne lit aucun texte
// envoyé (questions, mot de la fin et relance construits ici à partir de l'entretien, ADR 0053), seulement pendant
// l'entretien, et sur ses propres quotas (session, organisation, plateforme).

const MAX_BODY_BYTES = 4_000

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  // Seulement depuis la page de l'entretien (un navigateur envoie toujours Sec-Fetch-Site).
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { sessionId } = await params
  // Identifiant de l'adresse : journalisé seulement une fois la session trouvée.
  let checkedId: string | null = null
  try {
    const raw = await readBoundedBody(req, MAX_BODY_BYTES)
    if (raw === null) return NextResponse.json({ error: 'Demande trop longue' }, { status: 413 })
    let json: unknown = null
    try {
      json = JSON.parse(raw)
    } catch {
      // Corps illisible : traité comme une demande invalide ci-dessous.
    }
    const line = parseSpeechLine(json)
    if (!line) return NextResponse.json({ error: 'Demande invalide' }, { status: 400 })

    // 'live' : toutes les phrases de /v2, mot de la fin compris, sont dites avant que l'entretien soit marqué terminé.
    // Session gardée en mémoire 60 s : une phrase par question au moins, inutile de la relire à chaque fois.
    const session = await liveRoomSession(sessionId, 'live')
    if (!session) return NextResponse.json({ error: 'Entretien introuvable' }, { status: 404 })
    checkedId = session.$id
    const text = lineText(line, { questions: questionTexts(session.questions), candidateName: String(session.candidateName ?? '') })
    if (!text) return NextResponse.json({ error: 'Question introuvable' }, { status: 400 })
    if (!(await takeSpeechSlot(session))) return NextResponse.json({ error: 'Trop de demandes pour cet entretien' }, { status: 429 })

    const voice = await synthesizeInterviewVoice(text.slice(0, ROOM_LIMITS.speech))
    if ('error' in voice) {
      console.error('[entretien] voix d\'Alex indisponible', checkedId, voice.error)
      return NextResponse.json({ error: 'Voix indisponible' }, { status: 502 })
    }
    return new NextResponse(new Uint8Array(voice.audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // Service qui a lu la phrase (outils du navigateur) : vérifier que la voix de Google est bien utilisée.
        'X-Voice-Provider': voice.provider,
      },
    })
  } catch (err) {
    console.error('[entretien] voix d\'Alex en échec', checkedId ?? 'session non vérifiée', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Voix indisponible' }, { status: 500 })
  }
}
