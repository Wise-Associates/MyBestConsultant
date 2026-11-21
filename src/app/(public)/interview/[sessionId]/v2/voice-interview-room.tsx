'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ID } from 'appwrite'
import { CheckCircle2, Loader2, Mic, Video, AlertTriangle } from 'lucide-react'
import {
  attachRecordingToInterview, reportRecordingFailure, saveInterviewProgress,
} from '../actions'
import { interviewCompleted, transcribeInterviewAnswer } from './actions'
import { getBrowserStorage } from '@/lib/appwrite/browser-client'
import { TURN_RULES, fallbackVoiceIndex, feedLevel, lineText, startTurn, type SpeechLine } from '@/lib/voice-turn'
import type { InterviewQuestion, TranscriptEntry } from '@/app/recruiter/interviews/actions'

// Entretien vocal sans clic (ADR 0035). Le candidat autorise caméra et micro, clique sur « Commencer », puis n'a plus
// rien à faire : Alex pose chaque question à voix haute (route /api/interview/<id>/speech, ADR 0052 : la voix d'une
// question est préparée pendant la précédente, et son texte s'affiche quand elle commence), le navigateur écoute la
// réponse et détecte sa fin par le silence (src/lib/voice-turn.ts), puis passe aussitôt à la question suivante : la
// réponse, gardée dans le navigateur, est transcrite en arrière-plan (transcribeInterviewAnswer) et la retranscription
// n'est enregistrée qu'à la fin (ADR 0053 : sans relance ni réponse de l'IA pendant l'entretien, plus aucune attente
// entre deux questions). Un enregistrement continu (micro + voix d'Alex + caméra) est envoyé à la fin, comme dans la
// salle actuelle. Seule exception au « sans clic » : si le micro n'enregistre pas, la réponse s'écrit.

const CAT_LABELS: Record<InterviewQuestion['category'], string> = {
  intro: 'Introduction', technical: 'Technique', behavioral: 'Comportemental', motivation: 'Motivation', closing: 'Clôture',
}
const NO_ANSWER = '(Pas de réponse)'
// Réponse dont la transcription a échoué deux fois : le recruteur l'écoute dans l'enregistrement de l'entretien.
const UNTRANSCRIBED = '(Réponse orale non transcrite : voir l’enregistrement de l’entretien)'
// Débits de l'enregistrement continu : le bucket des enregistrements refuse les fichiers trop lourds (voir la salle actuelle).
const RECORDING_AUDIO_BPS = 32_000
const RECORDING_VIDEO_BPS = 80_000
// Délais au-delà desquels l'entretien continue sans attendre (une action bloquée ne doit jamais le figer) : voix d'Alex
// (sinon voix du navigateur), transcriptions encore en cours à la fin, relance du contexte audio.
const SPEECH_TIMEOUT_MS = 20_000
// Nouvel essai d'une voix en échec ou trop lente, avant la voix du navigateur (dont le timbre diffère de celle d'Alex).
const SPEECH_RETRY_TIMEOUT_MS = 12_000
const TRANSCRIPTION_WAIT_MS = 90_000
const RESUME_TIMEOUT_MS = 1_500

/** `saving` : entretien fini, enregistrement en cours d'envoi puis écran de fin (selon `upload`). */
type Stage = 'setup' | 'ready' | 'running' | 'saving'
type Activity = 'speaking' | 'listening' | 'thinking' | 'typing'
/** Réponse du candidat : texte (écrite, ou absence de réponse), ou transcription encore en cours en arrière-plan. */
type Answer = { text: string } | { pending: Promise<string> }
/** Tour de la retranscription, gardé dans le navigateur jusqu'à la fin de l'entretien. */
type Turn = { role: TranscriptEntry['role']; timestamp: string; content: string | Promise<string> }
type Captured = { kind: 'audio'; blob: Blob } | { kind: 'silence' } | { kind: 'unavailable'; reason: string }
/** Voix d'une phrase : MP3 reçu, ou la cause de l'échec (le navigateur lit alors avec sa propre voix). */
type PreparedSpeech = { bytes: ArrayBuffer } | { error: string }

interface Props {
  sessionId: string
  candidateName: string
  jobTitle: string
  questions: InterviewQuestion[]
  mediaMode: 'audio' | 'video'
  recordingsBucketId: string
}

function rms(samples: Float32Array<ArrayBuffer>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/**
 * Onde du micro (entretien audio, demande du 2026-11-21) : le signal tel qu'il arrive, en vert quand il y a de la voix.
 * Dessinée dans un canvas à chaque image, par la même boucle que la jauge (pas de setState).
 */
function drawWave(canvas: HTMLCanvasElement, samples: Float32Array<ArrayBuffer>, level: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.strokeStyle = level > 0.02 ? '#10b981' : 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  const step = samples.length / width
  for (let x = 0; x < width; x++) {
    // Voix courante entre 0,05 et 0,3 : amplifiée pour être visible, bornée au cadre.
    const v = Math.max(-1, Math.min(1, samples[Math.floor(x * step)] * 3))
    const y = height / 2 + v * height * 0.45
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function isRunning(ctx: AudioContext): boolean {
  return ctx.state === 'running'
}

/** `promise`, ou `fallback()` si elle n'a pas répondu dans `ms` (elle continue en arrière-plan, son résultat est ignoré). */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback()), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

function firstSupported(types: string[]): string {
  return types.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? ''
}

function deviceErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'L’accès au micro a été refusé. Autorisez-le pour ce site (icône à gauche ou à droite de la barre d’adresse), puis réessayez.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Aucun micro n’a été trouvé. Branchez un micro ou un casque, puis réessayez.'
  if (name === 'NotReadableError') return 'Votre micro est utilisé par une autre application. Fermez-la, puis réessayez.'
  return 'Le micro n’a pas pu être activé. Réessayez, ou utilisez Google Chrome, Microsoft Edge, Firefox ou Safari à jour.'
}

export function VoiceInterviewRoom({ sessionId, candidateName, jobTitle, questions, mediaMode, recordingsBucketId }: Props) {
  const [stage, setStage] = useState<Stage>('setup')
  const [activity, setActivity] = useState<Activity>('speaking')
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [qIndex, setQIndex] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [spokenLine, setSpokenLine] = useState('')
  const [candidateSpeaking, setCandidateSpeaking] = useState(false)
  const [typedReason, setTypedReason] = useState<string | null>(null)
  const [typedText, setTypedText] = useState('')
  const [upload, setUpload] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [finalized, setFinalized] = useState<'pending' | 'ok' | 'failed'>('pending')
  const [uploadPct, setUploadPct] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const levelAnalyserRef = useRef<AnalyserNode | null>(null)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])
  const turnsRef = useRef<Turn[]>([])
  const stoppedRef = useRef(false)
  const finishAnswerRef = useRef<(() => void) | null>(null)
  const typedResolveRef = useRef<((text: string) => void) | null>(null)
  const meterRef = useRef<HTMLDivElement | null>(null)
  const waveRef = useRef<HTMLCanvasElement | null>(null)
  const speakingRef = useRef(false)
  // Voix préparées à l'avance (ADR 0052), par phrase : MP3 reçu, ou la cause de l'échec.
  const speechRef = useRef(new Map<string, Promise<PreparedSpeech>>())
  const reportedRef = useRef(new Set<string>())
  // Bruit de fond le plus bas mesuré depuis l'écran de test du micro : donné à chaque écoute, pour qu'un candidat qui
  // répond dès la fin de la question ne fasse pas prendre sa voix pour du bruit de fond (voice-turn.ts).
  const noiseFloorRef = useRef<number | null>(null)

  // Page quittée : plus rien ne doit parler, écouter ni enregistrer. (Remis à false au montage : en mode strict, React
  // démonte puis remonte une fois le composant en développement.)
  useEffect(() => {
    stoppedRef.current = false
    return () => {
      stoppedRef.current = true
      finishAnswerRef.current?.()
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
      ctxRef.current?.close().catch(err => console.error('Fermeture du contexte audio impossible :', err))
    }
  }, [])

  // Prévient avant de fermer l'onglet pendant l'entretien ou l'enregistrement de sa fin, plus une fois tout terminé.
  const busy = stage === 'running'
    || (stage === 'saving' && (upload === 'idle' || upload === 'uploading' || finalized === 'pending'))
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  // Jauge du micro (vidéo) ou onde (audio) : mise à jour directe du DOM (60 fois par seconde, un setState serait trop coûteux).
  useEffect(() => {
    if (stage !== 'ready' && stage !== 'running') return
    const analyser = levelAnalyserRef.current
    if (!analyser) return
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      const level = rms(buf)
      // Un zéro exact est un micro pas encore prêt (premières images), pas un bruit de fond.
      if (level > 0) noiseFloorRef.current = noiseFloorRef.current === null ? level : Math.min(noiseFloorRef.current, level)
      if (meterRef.current) meterRef.current.style.width = `${Math.min(100, Math.round(level * 900))}%`
      if (waveRef.current) drawWave(waveRef.current, buf, level)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [stage])

  function reportOnce(reason: string) {
    const key = reason.slice(0, 80)
    if (reportedRef.current.has(key)) return
    reportedRef.current.add(key)
    reportRecordingFailure(sessionId, `entretien vocal : ${reason}`)
      .catch(err => console.error('Signalement de la panne impossible :', err))
  }

  // ── Appareils (clic : le contexte audio ne démarre que pendant un geste de l'utilisateur sur Safari) ──
  async function enableDevices() {
    setDeviceError(null)
    setEnabling(true)
    const Ctor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    const ctx = ctxRef.current ?? new Ctor()
    ctxRef.current = ctx
    const resuming = ctx.resume()
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: mediaMode === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false })
    } catch (err) {
      if (mediaMode === 'video') {
        // Caméra refusée ou absente : l'entretien se passe en audio plutôt que de bloquer, comme dans la salle actuelle.
        console.error('Caméra indisponible, entretien en audio seul :', err)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio })
        } catch (audioErr) {
          err = audioErr
        }
      }
      if (!stream) {
        console.error('Micro indisponible :', err)
        reportOnce(`micro refusé ou absent : ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`)
        setDeviceError(deviceErrorMessage(err))
        setEnabling(false)
        return
      }
    }
    await resuming.catch(err => console.error('Contexte audio non démarré :', err))
    streamRef.current = stream
    const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const dest = ctx.createMediaStreamDestination()
    source.connect(dest)
    levelAnalyserRef.current = analyser
    destRef.current = dest
    setHasVideo(stream.getVideoTracks().length > 0)
    setEnabling(false)
    setStage('ready')
    // Voix de la première question préparée pendant que le candidat vérifie son micro, avant « Commencer ».
    if (questions.length > 0) void prepareSpeech({ kind: 'question', index: 0 })
    // Chrome charge la liste de ses voix après la première demande : prête si la voix du navigateur doit servir.
    window.speechSynthesis?.getVoices()
  }

  function attachPreview(el: HTMLVideoElement | null) {
    if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current
  }

  // ── Voix d'Alex ──
  /**
   * Contexte audio en marche (lecture de la voix d'Alex, mesure du micro). Borné : hors d'un geste ou pendant une
   * interruption audio (appel, Siri), Safari peut laisser resume() en attente sans fin.
   */
  async function audioRunning(): Promise<boolean> {
    const ctx = ctxRef.current
    if (!ctx) return false
    if (isRunning(ctx)) return true
    const resumed = ctx.resume().then(() => true, err => { console.error('Contexte audio non relancé :', err); return false })
    // État relu après l'attente (une fonction : TypeScript garderait sinon l'état lu avant).
    return (await withTimeout(resumed, RESUME_TIMEOUT_MS, () => false)) && isRunning(ctx)
  }

  function playBuffer(ctx: AudioContext, buffer: AudioBuffer): Promise<void> {
    return new Promise(resolve => {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      if (destRef.current) src.connect(destRef.current)
      // Filet : un contexte resté suspendu ne finirait jamais la lecture, l'entretien resterait figé.
      const safety = setTimeout(() => resolve(), buffer.duration * 1000 + 3000)
      src.onended = () => { clearTimeout(safety); resolve() }
      src.start()
    })
  }

  function speakWithBrowser(text: string): Promise<void> {
    return new Promise(resolve => {
      const readingMs = Math.max(2500, text.length * 70)
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
      if (!synth) { setTimeout(resolve, readingMs); return }
      // Chrome oublie parfois la fin d'une longue phrase (onend jamais appelé) : le délai de lecture sert de filet.
      const safety = setTimeout(() => { synth.cancel(); resolve() }, readingMs + 4000)
      const utt = new SpeechSynthesisUtterance(text)
      utt.lang = 'fr-FR'
      // Voix française masculine si le navigateur en a une, comme celle d'Alex ; sinon sa voix française par défaut.
      const voices = synth.getVoices()
      const male = fallbackVoiceIndex(voices)
      if (male >= 0) utt.voice = voices[male]
      const done = () => { clearTimeout(safety); resolve() }
      utt.onend = done
      utt.onerror = done
      synth.cancel()
      synth.speak(utt)
    })
  }

  /**
   * Demande la voix de `line` sans l’attendre (une seule fois par phrase) : appelée pour la question suivante pendant
   * que le candidat répond, la voix est prête quand vient son tour. Par fetch et non par une Server Action, que le
   * navigateur exécuterait une par une (la transcription de la réponse attendrait derrière).
   */
  function prepareSpeech(line: SpeechLine): Promise<PreparedSpeech> {
    const cache = speechRef.current
    const key = JSON.stringify(line)
    let pending = cache.get(key)
    if (!pending) {
      // La phrase est désignée (question n, fin, relance) et construite par le serveur : aucun texte n'est envoyé.
      pending = fetch(`/api/interview/${encodeURIComponent(sessionId)}/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: key,
      }).then(
        async (res): Promise<PreparedSpeech> => (res.ok ? { bytes: await res.arrayBuffer() } : { error: `voix refusée (${res.status})` }),
        (err: unknown): PreparedSpeech => ({ error: `voix injoignable : ${err instanceof Error ? err.message : String(err)}` }),
      ).then(result => {
        // Échec non gardé : une voix préparée à l'avance qui a échoué est redemandée quand vient son tour.
        if ('error' in result && cache.get(key) === pending) cache.delete(key)
        return result
      })
      cache.set(key, pending)
    }
    return pending
  }

  /**
   * Alex dit `line`. Pendant l’attente de sa voix, « Alex réfléchit… » ; `onStart` (texte de la question, compteur)
   * s'applique quand elle commence, pour que le texte n'apparaisse pas avant la voix.
   */
  async function say(line: SpeechLine, onStart?: () => void): Promise<void> {
    setActivity('thinking')
    const text = textOf(line)
    const key = JSON.stringify(line)
    let prepared = await withTimeout(prepareSpeech(line), SPEECH_TIMEOUT_MS, () => ({ error: 'voix trop lente à générer' }))
    if ('error' in prepared && !stoppedRef.current) {
      // Un nouvel essai plutôt que la voix du navigateur tout de suite : elle n'a pas le timbre d'Alex (souvent féminine).
      console.warn('Voix d’Alex en échec, nouvel essai :', prepared.error)
      speechRef.current.delete(key)
      prepared = await withTimeout(prepareSpeech(line), SPEECH_RETRY_TIMEOUT_MS, () => ({ error: 'voix trop lente à générer (nouvel essai)' }))
    }
    // Phrase dite une fois : retirée pour libérer sa mémoire (une relance redemandée plus tard est générée de nouveau).
    speechRef.current.delete(key)
    if (stoppedRef.current) return
    const start = () => {
      onStart?.()
      setSpokenLine(text)
      setActivity('speaking')
    }
    const ctx = ctxRef.current
    let failure = 'error' in prepared ? prepared.error : 'lecture impossible'
    if ('bytes' in prepared && ctx) {
      try {
        // Copie : decodeAudioData vide le tampon qu'on lui donne.
        const buffer = await ctx.decodeAudioData(prepared.bytes.slice(0))
        if (await audioRunning()) {
          start()
          await playBuffer(ctx, buffer)
          return
        }
        failure = 'contexte audio suspendu'
      } catch (err) {
        // Page quittée pendant le décodage (contexte fermé) : rien à signaler ni à dire.
        if (stoppedRef.current) return
        console.error('Voix d’Alex illisible, voix du navigateur à la place :', err)
      }
    }
    console.error('Voix d’Alex indisponible, voix du navigateur à la place :', failure)
    reportOnce(`voix d'Alex indisponible : ${failure}`)
    start()
    await speakWithBrowser(text)
  }

  /** Tours déjà connus (les réponses encore en transcription n'y sont pas) : l'entretien est noté « en cours ». */
  function saveProgress() {
    const known = turnsRef.current.flatMap(t => (typeof t.content === 'string' ? [{ ...t, content: t.content }] : []))
    saveInterviewProgress(sessionId, known, 'in_progress')
      .catch(err => console.error('Progression de l’entretien non enregistrée :', err))
  }

  /** Texte de `line`, calculé comme par la route de la voix (lineText) : affiché, et lu par le navigateur en secours. */
  function textOf(line: SpeechLine): string {
    return lineText(line, { questions: questions.map(q => q.text), candidateName }) ?? ''
  }

  function addTurn(role: TranscriptEntry['role'], content: string | Promise<string>) {
    turnsRef.current = [...turnsRef.current, { role, content, timestamp: new Date().toISOString() }]
  }

  // ── Écoute d'une réponse ──
  function captureAnswer(): Promise<Captured> {
    return new Promise(resolve => {
      const stream = streamRef.current
      const analyser = levelAnalyserRef.current
      if (!stream || !analyser) { resolve({ kind: 'unavailable', reason: 'micro non initialisé' }); return }
      const chunks: Blob[] = []
      let rec: MediaRecorder
      try {
        const mimeType = firstSupported(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'])
        rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { audioBitsPerSecond: 32_000, ...(mimeType ? { mimeType } : {}) })
        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        // Dans le try : start() lève aussi (piste du micro arrêtée, Safari), et la réponse doit alors pouvoir s'écrire.
        rec.start()
      } catch (err) {
        resolve({ kind: 'unavailable', reason: `enregistrement de la réponse impossible : ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      let state = startTurn(performance.now(), noiseFloorRef.current)
      let settled = false
      const buf = new Float32Array(analyser.fftSize)
      const setSpeaking = (value: boolean) => {
        if (speakingRef.current === value) return
        speakingRef.current = value
        setCandidateSpeaking(value)
      }
      const finish = (kind: 'audio' | 'silence') => {
        if (settled) return
        settled = true
        clearInterval(timer)
        finishAnswerRef.current = null
        setSpeaking(false)
        rec.onstop = () => resolve(kind === 'audio' ? { kind, blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) } : { kind })
        if (rec.state === 'inactive') rec.onstop(new Event('stop'))
        else rec.stop()
      }
      rec.onerror = ev => {
        if (settled) return
        settled = true
        clearInterval(timer)
        finishAnswerRef.current = null
        setSpeaking(false)
        resolve({ kind: 'unavailable', reason: `enregistrement de la réponse interrompu : ${String((ev as Event & { error?: unknown }).error ?? 'erreur')}` })
      }
      // setInterval plutôt que requestAnimationFrame : il continue (ralenti) si l'onglet passe en arrière-plan.
      const timer = setInterval(() => {
        if (stoppedRef.current) { finish('silence'); return }
        analyser.getFloatTimeDomainData(buf)
        const step = feedLevel(state, rms(buf), performance.now())
        state = step.state
        setSpeaking(state.speaking)
        if (step.event === 'end-of-answer' || step.event === 'max-length') finish('audio')
        else if (step.event === 'no-answer') finish('silence')
      }, 50)
      finishAnswerRef.current = () => finish('audio')
      setActivity('listening')
    })
  }

  function askTypedAnswer(reason: string): Promise<string> {
    setTypedText('')
    setTypedReason(reason)
    setActivity('typing')
    return new Promise(resolve => {
      typedResolveRef.current = text => {
        typedResolveRef.current = null
        setTypedReason(null)
        resolve(text)
      }
    })
  }

  /**
   * Transcription d'une réponse en arrière-plan, pendant que l'entretien continue (ADR 0053) ; un second essai en cas
   * d'échec, puis UNTRANSCRIBED (la réponse reste dans l'enregistrement de l'entretien). Ne rejette jamais.
   */
  async function transcribeInBackground(blob: Blob, questionId: string): Promise<string> {
    let failure = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const form = new FormData()
      form.append('audio', blob)
      form.append('questionId', questionId)
      try {
        const res = await transcribeInterviewAnswer(sessionId, form)
        // Transcription vide : un bruit a été pris pour de la parole, traité comme une absence de réponse.
        if ('text' in res) return res.text || NO_ANSWER
        failure = res.error
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)
      }
      console.error('Transcription de la réponse impossible :', failure)
    }
    reportOnce(`transcription impossible : ${failure}`)
    return UNTRANSCRIBED
  }

  /**
   * Réponse du candidat à la question `questionId`, sans attendre sa transcription (lancée en arrière-plan) ; absence de
   * réponse après une relance orale : NO_ANSWER.
   */
  async function listenForAnswer(questionId: string): Promise<Answer> {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Contexte audio suspendu : la mesure du micro ne lirait que du silence et la réponse serait perdue.
      const captured: Captured = (await audioRunning())
        ? await captureAnswer()
        : { kind: 'unavailable', reason: 'contexte audio suspendu pendant l’écoute' }
      if (stoppedRef.current) return { text: NO_ANSWER }
      if (captured.kind === 'unavailable') {
        reportOnce(captured.reason)
        return { text: await askTypedAnswer('Votre réponse orale n’a pas pu être enregistrée. Écrivez-la ci-dessous pour continuer.') }
      }
      if (captured.kind === 'audio') return { pending: transcribeInBackground(captured.blob, questionId) }
      if (attempt === 0) await say({ kind: 'reprompt' })
    }
    return { text: NO_ANSWER }
  }

  // ── Déroulé de l'entretien ──
  async function runInterview() {
    for (let i = 0; i < questions.length; i++) {
      if (stoppedRef.current) return
      const q = questions[i]
      addTurn('interviewer', q.text)
      // Voix de la question suivante (ou du mot de la fin) préparée pendant celle-ci et la réponse du candidat.
      void prepareSpeech(i + 1 < questions.length ? { kind: 'question', index: i + 1 } : { kind: 'closing' })
      // Entretien noté « en cours » une seule fois, pendant la première question (le recruteur voit qu'il a commencé) ;
      // la retranscription n'est enregistrée qu'à la fin (completeInterview) : un enregistrement par question ralentissait
      // l'entretien (les actions passent une par une, essai du 2026-11-20).
      if (i === 0) saveProgress()
      await say({ kind: 'question', index: i }, () => {
        setQIndex(i)
        setPrompt(q.text)
      })
      if (stoppedRef.current) return

      // Question suivante tout de suite : la transcription de cette réponse continue en arrière-plan (ADR 0053).
      const answer = await listenForAnswer(q.id)
      addTurn('candidate', 'text' in answer ? answer.text : answer.pending)
    }
    if (stoppedRef.current) return
    await finishInterview()
  }

  async function finishInterview() {
    await say({ kind: 'closing' }, () => setPrompt(''))
    setStage('saving')
    stopAndUploadRecording()
    // Retranscription complète : les transcriptions encore en cours sont attendues (bornées), puis enregistrées une fois.
    const transcript = await settledTranscript()
    // Après la voix : l'analyse lancée par la fin de l'entretien est longue, et les actions passent une par une. La fin
    // passe avant le rattachement de l'enregistrement (comme la salle actuelle) : c'est elle qui déclenche l'analyse et
    // prévient le recruteur ; un enregistrement non rattaché se retrouve par son nom de fichier.
    setFinalized((await completeInterview(transcript)) ? 'ok' : 'failed')
  }

  /** Retranscription de l'entretien, une fois les transcriptions d'arrière-plan finies (ou abandonnées après 90 s). */
  async function settledTranscript(): Promise<TranscriptEntry[]> {
    return Promise.all(turnsRef.current.map(async turn => ({
      role: turn.role,
      timestamp: turn.timestamp,
      content: typeof turn.content === 'string'
        ? turn.content
        : await withTimeout(turn.content, TRANSCRIPTION_WAIT_MS, () => {
          reportOnce('transcription trop lente à la fin de l’entretien')
          return UNTRANSCRIBED
        }),
    })))
  }

  /** Enregistre la fin de l'entretien et vérifie qu'elle a été prise en compte ; un second essai si besoin. */
  async function completeInterview(transcript: TranscriptEntry[]): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await saveInterviewProgress(sessionId, transcript, 'completed')
      } catch (err) {
        console.error('Fin de l’entretien non enregistrée :', err)
      }
      try {
        const state = await interviewCompleted(sessionId)
        if ('completed' in state && state.completed) return true
        if ('error' in state) console.error('État de l’entretien illisible :', state.error)
      } catch (err) {
        console.error('État de l’entretien illisible :', err)
      }
    }
    reportOnce('fin de l’entretien refusée ou non enregistrée')
    return false
  }

  // ── Enregistrement continu (micro + voix d'Alex + caméra), envoyé à la fin comme dans la salle actuelle ──
  function startRecording() {
    const stream = streamRef.current
    const dest = destRef.current
    if (!stream || !dest) return
    try {
      const video = stream.getVideoTracks()
      const mimeType = firstSupported(video.length
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])
      const options: MediaRecorderOptions = { audioBitsPerSecond: RECORDING_AUDIO_BPS }
      if (mimeType) options.mimeType = mimeType
      if (video.length) options.videoBitsPerSecond = RECORDING_VIDEO_BPS
      const mr = new MediaRecorder(new MediaStream([...dest.stream.getAudioTracks(), ...video]), options)
      recorderChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) recorderChunksRef.current.push(e.data) }
      mr.start(2000)
      recorderRef.current = mr
    } catch (err) {
      console.error('Enregistrement de l’entretien impossible :', err)
      reportOnce(`MediaRecorder n'a pas pu démarrer : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function stopAndUploadRecording() {
    const mr = recorderRef.current
    recorderRef.current = null
    if (!mr || mr.state === 'inactive') { setUpload('error'); return }
    const isVideo = mr.mimeType.startsWith('video/')
    mr.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: mr.mimeType || (isVideo ? 'video/webm' : 'audio/webm') })
      recorderChunksRef.current = []
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (blob.size <= 500) {
        reportOnce(`enregistrement quasi vide (${blob.size} octets)`)
        setUpload('error')
        return
      }
      setUpload('uploading')
      setUploadPct(0)
      const file = new File([blob], `interview-${sessionId}-candidat-complet.webm`, { type: blob.type })
      getBrowserStorage().createFile(recordingsBucketId, ID.unique(), file, undefined, p => setUploadPct(Math.round(p.progress)))
        .then(async uploaded => {
          // Fichier envoyé : reste à le rattacher à l'entretien (appel léger, réessayé comme dans la salle actuelle).
          let lastError = ''
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const res = await attachRecordingToInterview(sessionId, uploaded.$id, isVideo ? 'video' : 'audio')
              if (!res.error) { setUpload('done'); return }
              lastError = res.error
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err)
            }
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
          }
          console.error('Rattachement de l’enregistrement impossible :', lastError)
          reportOnce(`rattachement rejeté après plusieurs tentatives : ${lastError}`)
          setUpload('error')
        })
        .catch(err => {
          console.error('Envoi de l’enregistrement impossible :', err)
          reportOnce(`envoi de l'enregistrement impossible : ${err instanceof Error ? err.message : String(err)}`)
          setUpload('error')
        })
    }
    mr.stop()
  }

  function begin() {
    const ctx = ctxRef.current
    // Dans le clic : relance le contexte audio s'il s'est suspendu entre-temps (navigateurs stricts sur la lecture).
    if (ctx && ctx.state !== 'running') ctx.resume().catch(err => console.error('Contexte audio non relancé :', err))
    startRecording()
    setStage('running')
    runInterview().catch(err => {
      console.error('Entretien vocal interrompu :', err)
      reportOnce(`entretien interrompu : ${err instanceof Error ? err.message : String(err)}`)
      setDeviceError('L’entretien a été interrompu par une erreur. Rechargez la page pour le reprendre depuis le début.')
    })
  }

  function submitTyped() {
    const text = typedText.trim()
    if (text) typedResolveRef.current?.(text)
  }

  // ── Écrans ──
  const page: React.CSSProperties = { minHeight: '100vh', background: '#050709', color: 'white' }

  if (stage === 'setup' || stage === 'ready') return (
    <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <AlexAvatar speaking={false} size={112} />
        <p style={{ marginTop: '1.75rem', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
          Entretien vocal · {jobTitle}
        </p>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.6rem 0 0.75rem' }}>Bonjour {candidateName}</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.75, fontSize: '0.92rem', marginBottom: '1.5rem' }}>
          Alex, votre recruteur IA, va vous poser <strong style={{ color: 'white' }}>{questions.length} questions</strong> à voix haute.
          Répondez simplement en parlant : dès que vous avez terminé, Alex passe à la suite. Aucun clic n’est nécessaire pendant l’entretien.
        </p>
        <ul style={{ textAlign: 'left', listStyle: 'none', padding: 0, margin: '0 0 1.75rem', display: 'grid', gap: '0.5rem' }}>
          {[
            'Installez-vous dans un endroit calme ; un casque ou des écouteurs évitent l’écho.',
            `Après ${TURN_RULES.endSilenceMs / 1000} secondes de silence, votre réponse est considérée comme terminée.`,
            'Comptez 15 à 20 minutes. Gardez cette page ouverte jusqu’à la fin.',
            'Vos réponses orales sont envoyées à notre sous-traitant OpenAI pour être transcrites, et la voix d’Alex est produite par un service de synthèse vocale (Google ou OpenAI) ; le texte et l’enregistrement de l’entretien sont transmis au recruteur.',
          ].map(tip => (
            <li key={tip} style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)', padding: '0.65rem 0.9rem', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {tip}
            </li>
          ))}
        </ul>

        {stage === 'ready' && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {hasVideo && (
              <video ref={attachPreview} autoPlay muted playsInline aria-label="Aperçu de votre caméra"
                style={{ display: 'block', width: '100%', maxWidth: 320, aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12, transform: 'scaleX(-1)', background: '#111', margin: '0 auto 0.9rem' }} />
            )}
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>
              {hasVideo ? 'Dites quelques mots : la jauge doit bouger.' : 'Dites quelques mots : l’onde doit bouger.'}
            </p>
            {hasVideo ? (
              <div style={{ height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div ref={meterRef} style={{ width: '0%', height: '100%', background: '#10b981', transition: 'width 80ms linear' }} />
              </div>
            ) : (
              <canvas ref={waveRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: 72, borderRadius: 12, background: 'rgba(255,255,255,0.04)' }} />
            )}
            {mediaMode === 'video' && !hasVideo && (
              <p style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.75rem' }}>
                Caméra indisponible : l’entretien se déroulera en audio seulement.
              </p>
            )}
          </div>
        )}

        {deviceError && (
          <div role="alert" style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', textAlign: 'left' }}>
            <p style={{ color: '#fbbf24', fontSize: '0.82rem', lineHeight: 1.6 }}>{deviceError}</p>
            <a href={`/interview/${sessionId}${mediaMode === 'audio' ? '?mode=audio' : '?mode=video'}`}
              style={{ display: 'inline-block', marginTop: '0.5rem', fontSize: '0.8rem', color: '#c4b5fd', textDecoration: 'underline' }}>
              Passer à l’entretien avec réponses écrites
            </a>
          </div>
        )}

        {stage === 'setup' ? (
          <button type="button" onClick={enableDevices} disabled={enabling}
            style={{ width: '100%', padding: '1rem 1.5rem', borderRadius: 16, background: 'linear-gradient(135deg,#6d28d9,#7c3aed)', color: 'white', fontWeight: 700, fontSize: '1rem', border: 'none', cursor: enabling ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', opacity: enabling ? 0.7 : 1 }}>
            {enabling ? <Loader2 style={{ width: 18, height: 18, animation: 'vr-spin 1s linear infinite' }} /> : mediaMode === 'video' ? <Video style={{ width: 18, height: 18 }} /> : <Mic style={{ width: 18, height: 18 }} />}
            {mediaMode === 'video' ? 'Activer la caméra et le micro' : 'Activer le micro'}
          </button>
        ) : (
          <button type="button" onClick={begin}
            style={{ width: '100%', padding: '1rem 1.5rem', borderRadius: 16, background: 'linear-gradient(135deg,#6d28d9,#7c3aed)', color: 'white', fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,58,237,0.4)' }}>
            Commencer l’entretien
          </button>
        )}
      </div>
      <style>{KEYFRAMES}</style>
    </div>
  )

  if (stage === 'saving') {
    // L'écran de fin n'annonce rien avant que la fin soit enregistrée et l'enregistrement envoyé (en succès ou non).
    const sending = upload === 'idle' || upload === 'uploading' || finalized === 'pending'
    return (
      <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: 460, width: '100%', textAlign: 'center' }} aria-live="polite">
          {sending ? (<>
            <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto 2rem' }}>
              <svg viewBox="0 0 36 36" style={{ width: 120, height: 120, transform: 'rotate(-90deg)' }} aria-hidden="true">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray={`${uploadPct} 100`} strokeLinecap="round" />
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#a78bfa' }}>{uploadPct}%</span>
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}>Envoi de votre entretien…</h1>
            <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.8, fontSize: '0.9rem' }}>
              Merci {candidateName}. Ne fermez pas cette page, la sauvegarde se termine.
            </p>
          </>) : (<>
            {finalized === 'ok' ? (
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
                <CheckCircle2 style={{ width: 36, height: 36, color: '#10b981' }} aria-hidden="true" />
              </div>
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(245,158,11,0.1)', border: '2px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
                <AlertTriangle style={{ width: 34, height: 34, color: '#fbbf24' }} aria-hidden="true" />
              </div>
            )}
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>Entretien terminé</h1>
            {finalized === 'ok' ? (
              <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.8, fontSize: '0.9rem' }}>
                Merci {candidateName} pour votre temps. Vos réponses ont été enregistrées ;
                le recruteur vous contactera prochainement.
              </p>
            ) : (
              <p role="alert" style={{ color: '#fbbf24', lineHeight: 1.7, fontSize: '0.88rem' }}>
                Merci {candidateName}. La fin de votre entretien n’a pas pu être enregistrée : prévenez le recruteur qui
                vous a invité, en lui indiquant que l’entretien est allé jusqu’au bout.
              </p>
            )}
            {upload === 'error' && (
              <p style={{ marginTop: '1.25rem', color: 'rgba(248,113,113,0.85)', fontSize: '0.8rem', lineHeight: 1.6 }}>
                L’enregistrement audio{hasVideo ? '/vidéo' : ''} n’a pas pu être sauvegardé{finalized === 'ok' ? ' — vos réponses restent enregistrées' : ''}.
              </p>
            )}
          </>)}
        </div>
      </div>
    )
  }

  // ── Entretien en cours ──
  const status = activity === 'speaking' ? 'Alex parle…'
    : activity === 'listening' ? (candidateSpeaking ? 'Je vous écoute…' : 'À vous — répondez à voix haute')
    : activity === 'thinking' ? 'Alex réfléchit…'
    : 'Écrivez votre réponse'
  const statusColor = activity === 'listening' ? '#10b981' : activity === 'speaking' ? '#a78bfa' : '#f59e0b'
  const current = questions[qIndex]

  return (
    <div style={{ ...page, display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0.75rem 1rem' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <p style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Alex · Recruteur IA · {jobTitle}
          </p>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Question {qIndex + 1} / {questions.length}
          </span>
          <div style={{ width: 72, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }} aria-hidden="true">
            <div style={{ width: `${Math.round((qIndex / questions.length) * 100)}%`, height: '100%', borderRadius: 3, background: '#a78bfa', transition: 'width 0.4s ease' }} />
          </div>
        </div>
      </div>

      <main style={{ flex: 1, width: '100%', maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem 3rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          <div style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 20, background: 'linear-gradient(160deg,#120f2a,#1e1b4b)', border: `2px solid ${activity === 'speaking' ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.3s' }}>
            <AlexAvatar speaking={activity === 'speaking'} size={128} />
            <span style={TILE_LABEL}>Alex · Recruteur IA</span>
          </div>
          <div style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 20, overflow: 'hidden', background: '#0d0f14', border: `2px solid ${candidateSpeaking ? 'rgba(16,185,129,0.7)' : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.2s' }}>
            {hasVideo ? (<>
              <video ref={attachPreview} autoPlay muted playsInline aria-label="Votre caméra"
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <div style={{ position: 'absolute', left: 12, right: 12, bottom: 10, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }} aria-hidden="true">
                <div ref={meterRef} style={{ width: '0%', height: '100%', background: '#10b981', transition: 'width 80ms linear' }} />
              </div>
            </>) : (
              // Entretien audio : l'onde de la voix, sans caméra.
              <canvas ref={waveRef} aria-hidden="true" style={{ display: 'block', width: '86%', height: '40%' }} />
            )}
            <span style={TILE_LABEL}>Vous</span>
          </div>
        </div>

        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <span data-vr-motion style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, animation: 'vr-pulse 1.2s infinite' }} aria-hidden="true" />
          <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>{status}</p>
          {activity === 'thinking' && (
            <Loader2 style={{ width: 14, height: 14, color: '#f59e0b', animation: 'vr-spin 1s linear infinite' }} aria-hidden="true" />
          )}
        </div>

        {prompt && current && (
          <section aria-label="Question en cours" style={{ borderRadius: 20, padding: '1.4rem 1.5rem', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.22)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '0.6rem' }}>
              {CAT_LABELS[current.category] ?? 'Question'}
            </p>
            <p style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.92)', lineHeight: 1.7 }}>{prompt}</p>
          </section>
        )}

        {activity === 'speaking' && spokenLine && spokenLine !== prompt && (
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>« {spokenLine} »</p>
        )}

        {activity === 'listening' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
              Alex passe à la suite après {TURN_RULES.endSilenceMs / 1000} secondes de silence.
            </p>
            {candidateSpeaking && (
              <button type="button" onClick={() => finishAnswerRef.current?.()}
                style={{ padding: '0.55rem 1.1rem', borderRadius: 12, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                J’ai terminé ma réponse
              </button>
            )}
          </div>
        )}

        {activity === 'typing' && typedReason && (
          <form onSubmit={e => { e.preventDefault(); submitTyped() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderRadius: 16, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <p role="alert" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', color: '#fbbf24', fontSize: '0.82rem', lineHeight: 1.55 }}>
              <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              {typedReason}
            </p>
            <label htmlFor="vr-typed" style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>Votre réponse</label>
            <textarea id="vr-typed" value={typedText} onChange={e => setTypedText(e.target.value)} rows={5} autoFocus maxLength={8000}
              style={{ width: '100%', padding: '0.9rem 1rem', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <button type="submit" disabled={!typedText.trim()}
              style={{ alignSelf: 'flex-end', padding: '0.7rem 1.4rem', borderRadius: 12, background: typedText.trim() ? 'linear-gradient(135deg,#6d28d9,#7c3aed)' : 'rgba(255,255,255,0.06)', color: typedText.trim() ? 'white' : 'rgba(255,255,255,0.3)', border: 'none', cursor: typedText.trim() ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '0.88rem' }}>
              Envoyer et continuer
            </button>
          </form>
        )}

        {deviceError && (
          <div role="alert" style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p style={{ color: '#fca5a5', fontSize: '0.82rem', lineHeight: 1.6 }}>{deviceError}</p>
          </div>
        )}
      </main>
      <style>{KEYFRAMES}</style>
    </div>
  )
}

const TILE_LABEL: React.CSSProperties = {
  position: 'absolute', top: 10, left: 12, fontSize: 11, fontWeight: 700, color: 'white',
  background: 'rgba(0,0,0,0.45)', padding: '3px 9px', borderRadius: 20,
}

const KEYFRAMES = `
  @keyframes vr-ring { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(1.45);opacity:0} }
  @keyframes vr-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes vr-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
  @media (prefers-reduced-motion: reduce) { [data-vr-motion] { animation: none !important } }
`

function AlexAvatar({ speaking, size }: { speaking: boolean; size: number }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      {speaking && (<>
        <div data-vr-motion style={{ position: 'absolute', inset: -14, borderRadius: '50%', border: '2px solid rgba(167,139,250,0.35)', animation: 'vr-ring 1.6s ease-out infinite' }} />
        <div data-vr-motion style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '2px solid rgba(167,139,250,0.5)', animation: 'vr-ring 1.6s ease-out infinite 0.3s' }} />
      </>)}
      <div style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'linear-gradient(135deg,#1e1b4b,#4c1d95)', border: '3px solid rgba(124,58,237,0.45)' }}>
        <Image src="/alex-recruiter.png" alt="Alex, recruteur IA" fill sizes={`${size}px`} style={{ objectFit: 'cover', objectPosition: 'center top' }} priority />
      </div>
    </div>
  )
}
