'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { callLLMForModule } from '@/lib/ai/llm-router'

// Tous les appels IA de ce fichier relèvent du module « Entretiens IA » (modèle réglable dans /admin/llm-config).
const callLLM = callLLMForModule('interview')
import { ID, Query } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import type { InterviewQuestion, TranscriptEntry } from '@/app/recruiter/interviews/actions'
import { EdgeTTS } from 'node-edge-tts'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

// A candidate's browser console is never checked by anyone, and console.error() alone only
// shows up in the hosting provider's own log viewer — not something checkable from here via
// the Appwrite API the rest of this debugging session has relied on. Persisting a small text
// file into the same recordings bucket (the INTERVIEWS collection itself has no room left
// for a new column — see the MariaDB row-size limit noted elsewhere in this codebase) means
// a failure can be found the same way everything else here has been verified: by listing
// files in Appwrite Storage.
export async function reportRecordingFailure(sessionId: string, reason: string): Promise<void> {
  console.error(`[interview ${sessionId}] Échec enregistrement côté candidat : ${reason}`)
  try {
    const { storage } = createAdminClient()
    const content = `${new Date().toISOString()} — ${reason}`
    const inputFile = InputFile.fromBuffer(Buffer.from(content, 'utf-8'), `interview-${sessionId}-ERROR.txt`)
    await storage.createFile(BUCKETS.RECORDINGS, ID.unique(), inputFile)
  } catch { /* best-effort — the console.error above is the fallback trail */ }
}

// For the closing slot ("avez-vous des questions pour nous ?") — a real question from the
// candidate deserves a real answer, but that answer must be the END of the exchange, not
// another prompt inviting a further reply (that's what produced the "why do you keep asking
// ME questions" loop when this went through the generic follow-up-if-incomplete check).
export async function answerClosingQuestion(
  jobTitle: string,
  candidateMessage: string,
): Promise<{ answer: string | null }> {
  try {
    const { content } = await callLLM([{
      role: 'user',
      content: `Message du candidat en réponse à "Avez-vous des questions ?" : "${candidateMessage}"`,
    }], `Tu es Alex, un recruteur IA bienveillant pour le poste de "${jobTitle}".
Si le message contient une vraie question du candidat, réponds-y brièvement et utilement (2-3 phrases maximum), sans poser de nouvelle question en retour.
Si le candidat n'a pas de question (ex: "non merci", "pas de question"), réponds exactement : null.
Réponds uniquement avec la réponse à donner au candidat (texte simple, sans guillemets), ou le mot "null".`)
    const text = content.trim()
    return { answer: text === 'null' || text === '' ? null : text }
  } catch {
    return { answer: null }
  }
}

export async function getCandidateAIFollowUp(
  currentQuestion: InterviewQuestion,
  candidateAnswer: string,
): Promise<{ followUp: string | null }> {
  try {
    const { content } = await callLLM([{
      role: 'user',
      content: `Question posée : "${currentQuestion.text}"\nRéponse du candidat : "${candidateAnswer}"`,
    }], `Tu es un interviewer IA expert et bienveillant. Analyse la réponse du candidat.
Si la réponse est incomplète ou mérite d'être approfondie, génère UNE courte question de relance.
Si la réponse est complète, réponds exactement : null
Réponds soit avec la question de relance (texte simple, sans guillemets), soit avec le mot "null".`)
    const text = content.trim()
    return { followUp: text === 'null' || text === '' ? null : text }
  } catch {
    return { followUp: null }
  }
}

export interface InterviewRecording {
  questionIdx: number
  fileId: string
  role: 'interviewer' | 'candidate'
  mediaType?: 'audio' | 'video'
}

// Un seul enregistrement micro continu pour toute la durée de l'entretien (au lieu d'un
// fragment par question) — bien plus simple à écouter pour le recruteur. questionIdx: -1
// identifie la piste "entretien complet" dans le tableau `recordings`.
//
// Le fichier lui-même n'arrive plus ici : il est envoyé directement du navigateur vers
// Appwrite Storage (voir interview-room-candidate.tsx), pas via cette Server Action. Les
// Server Actions Next.js plafonnent le corps de requête à 1 Mo par défaut, et même
// relevé dans next.config.ts, Vercel impose sa propre limite (~4,5 Mo) sur toute fonction
// serverless — un enregistrement audio dépasse ça en quelques minutes, une vidéo presque
// immédiatement. L'upload direct navigateur → Appwrite (bucket `recordings` autorisé en
// écriture publique pour Role.any(), les candidats n'ayant pas de session) contourne
// entièrement cette limite. Cette fonction ne fait plus que rattacher le fileId déjà
// uploadé au document de l'entretien — un payload minuscule, jamais concerné par la limite.
export async function attachRecordingToInterview(
  sessionId: string,
  fileId: string,
  mediaType: 'audio' | 'video',
): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    let recordings: InterviewRecording[] = []
    try { recordings = JSON.parse((doc.recordings as string) ?? '[]') } catch { /* */ }
    // Retire d'éventuels anciens fragments candidat (retest, reprise) avant d'ajouter la piste complète.
    recordings = recordings.filter(r => r.role !== 'candidate')
    recordings.push({ questionIdx: -1, fileId, role: 'candidate', mediaType })
    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId, { recordings: JSON.stringify(recordings) })
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur rattachement enregistrement' }
  }
}

// Free neural voice (Microsoft Edge's "Read Aloud" service — no API key needed) used as the
// primary interviewer voice: always French, natural-sounding, and faster than the robotic
// browser speechSynthesis fallback.
async function synthesizeFreeVoice(text: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mbc-tts-'))
  const filePath = path.join(dir, 'speech.mp3')
  try {
    const tts = new EdgeTTS({
      voice: 'fr-FR-HenriNeural',
      lang: 'fr-FR',
      rate: '+15%',
      pitch: 'default',
      volume: 'default',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 15000,
    })
    await tts.ttsPromise(text, filePath)
    return await readFile(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Generates the AI interviewer's spoken audio via a real TTS voice instead of the browser's
// built-in speechSynthesis, whose voice quality/speed depends entirely on whatever voice
// packs happen to be installed on the visitor's device. Alex's voice is mixed into the
// candidate's single continuous recording client-side (see interview-room-candidate.tsx's
// AudioContext graph), so it isn't saved separately here — that used to happen and produced
// one extra recording file per question, fragmenting playback for no benefit.
// Tries the free Edge neural voice first (always French, no cost), then falls back to
// OpenAI TTS if a real API key is configured, then to the browser voice client-side.
export async function generateInterviewSpeech(
  text: string,
): Promise<{ audioBase64?: string; error?: string }> {
  try {
    const input = text.slice(0, 4000)
    let buffer: Buffer | null = null
    let lastError = ''

    try {
      buffer = await synthesizeFreeVoice(input)
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Erreur voix gratuite'
    }

    if (!buffer) {
      const { getLLMConfig } = await import('@/app/admin/llm-config/actions')
      const cfg = await getLLMConfig()
      const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY
      if (apiKey) {
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input, response_format: 'mp3', speed: 1.1 }),
        })
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer())
        } else {
          const errText = await res.text().catch(() => '')
          lastError = `Erreur génération voix : ${errText.slice(0, 200) || res.statusText}`
        }
      }
    }

    if (!buffer) return { error: lastError || 'Erreur génération voix' }

    return { audioBase64: buffer.toString('base64') }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur génération voix' }
  }
}

export async function saveInterviewProgress(
  sessionId: string,
  transcript: TranscriptEntry[],
  status: 'in_progress' | 'completed',
): Promise<void> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId, {
      transcript: JSON.stringify(transcript),
      status,
      ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
    })
  } catch { /* ignore */ }

  // Analyse automatiquement dès la fin de l'entretien, plutôt que d'attendre qu'un admin
  // clique sur "Analyser" — le recruteur n'a de toute façon aucun moyen de le déclencher
  // lui-même aujourd'hui. Best-effort : l'entretien reste "completed" et reste analysable
  // manuellement depuis l'admin si ça échoue (clé API absente, réponse LLM invalide, etc.).
  if (status === 'completed') {
    try {
      const { performInterviewAnalysis } = await import('@/app/admin/interviews/actions')
      const res = await performInterviewAnalysis(sessionId)
      if (res.error) console.error(`Auto-analyse échouée pour l'entretien ${sessionId}:`, res.error)
    } catch (e) { console.error(`Auto-analyse a levé une exception pour l'entretien ${sessionId}:`, e) }

    await notifyRecruiterOfCompletion(sessionId)
    await notifyCandidateOfCompletion(sessionId)
  }
}

// Prévient le recruteur par email dès qu'un candidat termine son entretien IA — jusqu'ici
// rien ne le signalait, il fallait penser à revenir vérifier la liste manuellement.
async function notifyRecruiterOfCompletion(sessionId: string): Promise<void> {
  try {
    const { databases, messaging } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    const tenantId = doc.tenantId as string | undefined
    if (!tenantId) return
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    const recruiterId = tenant.recruiterId as string | undefined
    if (!recruiterId) return

    const { wrapEmailHtml } = await import('@/lib/email-template')
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const link = `${origin}/recruiter/interviews/${sessionId}`
    const body = `
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Bonjour,<br><br>
        <strong>${doc.candidateName as string}</strong> vient de terminer son entretien IA pour le poste de <strong>${doc.jobTitle as string}</strong>.<br><br>
        L'analyse IA (score, recommandation, points clés) est disponible dès maintenant sur sa fiche entretien.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${link}" target="_blank" style="display:inline-block; padding:14px 32px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Voir les résultats</a>
        </td></tr>
      </table>
    `
    await messaging.createEmail(
      ID.unique(),
      `Entretien terminé — ${doc.candidateName as string}`,
      wrapEmailHtml('Un entretien vient de se terminer', body),
      [], [recruiterId], [], [], [], [], false, true,
    )
  } catch (e) { console.error(`Notification de fin d'entretien échouée pour ${sessionId}:`, e) }
}

// Remercie le candidat par email dès la fin de son entretien — jusqu'ici, le seul "merci"
// était le message vocal + l'écran de fin, qui disparaissent dès que l'onglet est fermé.
async function notifyCandidateOfCompletion(sessionId: string): Promise<void> {
  try {
    const { databases, users, messaging } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    const candidateEmail = doc.candidateEmail as string | undefined
    if (!candidateEmail) return

    const found = await users.list([Query.equal('email', [candidateEmail])])
    const candidateAuthId = found.users[0]?.$id
    if (!candidateAuthId) return

    const { wrapEmailHtml } = await import('@/lib/email-template')
    const body = `
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Bonjour ${doc.candidateName as string},<br><br>
        Merci d'avoir passé votre entretien IA pour le poste de <strong>${doc.jobTitle as string}</strong>. Vos réponses ont bien été enregistrées et transmises au recruteur.<br><br>
        Nous avons apprécié le temps que vous y avez consacré — le recruteur revient vers vous très prochainement pour la suite du processus.
      </p>
      <p style="margin:0; font-size:14px; line-height:1.7; color:#45454A;">
        Bonne continuation et à bientôt !
      </p>
    `
    await messaging.createEmail(
      ID.unique(),
      `Merci pour votre entretien — ${doc.jobTitle as string}`,
      wrapEmailHtml('Entretien bien reçu, merci !', body),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
  } catch (e) { console.error(`Remerciement candidat échoué pour ${sessionId}:`, e) }
}
