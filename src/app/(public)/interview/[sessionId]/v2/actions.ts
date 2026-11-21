'use server'

import type { InterviewQuestion } from '@/app/recruiter/interviews/actions'
import { ROOM_LIMITS } from '@/lib/interview-room'
import { liveRoomSession, roomSession, takeTranscriptionSlot } from '@/lib/interview-room-access'
import { transcribeSpeech } from '@/lib/speech-to-text'
import { MAX_ANSWER_AUDIO_BYTES, audioContainer, transcriptionPrompt } from '@/lib/speech-to-text-rules'

// Action propre à l'entretien vocal sans clic (/interview/<session>/v2, ADR 0035). Les autres (voix d'Alex, relance,
// question de clôture, progression, enregistrement) sont celles de la salle actuelle, importées de ../actions.
// Comme elles : pas de session candidat, l'identifiant de l'entretien sert de clé (src/lib/interview-room-access.ts).

/**
 * L'entretien est-il enregistré comme terminé ? saveInterviewProgress (salle actuelle) ne dit pas s'il a refusé
 * (plafond de la session atteint, retranscription invalide) : la page vérifie avant d'annoncer la fin au candidat.
 * Lecture seule ; seulement l'état, pour un entretien en cours ou terminé depuis moins de 2 h.
 */
export async function interviewCompleted(sessionId: string): Promise<{ completed: boolean } | { error: string }> {
  try {
    const session = await roomSession(sessionId, 'after')
    return { completed: session?.status === 'completed' || session?.status === 'analysed' }
  } catch (err) {
    console.error('[interview v2] état de l\'entretien illisible', err instanceof Error ? err.message : String(err))
    return { error: 'État de l’entretien illisible' }
  }
}

export async function transcribeInterviewAnswer(
  sessionId: string,
  form: FormData,
): Promise<{ text: string } | { error: string }> {
  try {
    const session = await liveRoomSession(sessionId, 'live')
    if (!session) return { error: 'Entretien introuvable ou terminé' }

    const audio = form.get('audio')
    if (!(audio instanceof Blob) || audio.size === 0) return { error: 'Réponse audio absente' }
    if (audio.size > MAX_ANSWER_AUDIO_BYTES) return { error: 'Réponse audio trop longue' }
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const container = audioContainer(bytes)
    if (!container) return { error: 'Format audio non reconnu' }

    // Contexte lu sur l'entretien (poste, question désignée par son identifiant), jamais un texte du navigateur.
    const questionId = form.get('questionId')
    let questions: InterviewQuestion[] = []
    try { questions = JSON.parse(String(session.questions ?? '[]')) } catch { questions = [] }
    const question = Array.isArray(questions) ? questions.find(q => q?.id === questionId) : undefined
    if (!question) return { error: 'Question inconnue' }

    if (!(await takeTranscriptionSlot(session))) return { error: 'Trop de demandes pour cet entretien' }
    const result = await transcribeSpeech(bytes, container, transcriptionPrompt(String(session.jobTitle ?? ''), String(question.text ?? '')))
    if (!result.ok) {
      // La cause (crédits, clé, modèle) reste dans le journal : rien de la configuration n'est renvoyé au navigateur.
      console.error(`[interview v2 ${session.$id}] transcription impossible : ${result.reason}`)
      return { error: 'Transcription impossible' }
    }
    return { text: result.text.slice(0, ROOM_LIMITS.answer) }
  } catch (err) {
    console.error('[interview v2] transcription impossible', err instanceof Error ? err.message : String(err))
    return { error: 'Transcription impossible' }
  }
}
