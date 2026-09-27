'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Send, CheckCircle2, Loader2, ChevronRight, Volume2, VolumeX, MessageSquare, RotateCcw } from 'lucide-react'
import Image from 'next/image'
import { ID } from 'appwrite'
import { getCandidateAIFollowUp, answerClosingQuestion, saveInterviewProgress, attachRecordingToInterview, generateInterviewSpeech, reportRecordingFailure } from './actions'
import { getBrowserStorage } from '@/lib/appwrite/browser-client'
import type { InterviewQuestion, TranscriptEntry } from '@/app/recruiter/interviews/actions'

const CAT_LABELS: Record<string, string> = {
  intro: 'Introduction', technical: 'Technique', behavioral: 'Comportemental',
  motivation: 'Motivation', closing: 'Clôture',
}
const CAT_COLORS: Record<string, string> = {
  intro: '#60a5fa', technical: '#a78bfa', behavioral: '#34d399',
  motivation: '#f59e0b', closing: '#f87171',
}

interface Props {
  sessionId: string
  candidateName: string
  jobTitle: string
  questions: InterviewQuestion[]
  mediaMode?: 'audio' | 'video'
  recordingsBucketId: string
}

// ── Photo / Avatar du recruteur ───────────────────────────────────
function RecruiterPhoto({ speaking, thinking }: { speaking: boolean; thinking: boolean }) {
  const [imgError, setImgError] = useState(false)

  return (
    <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto' }}>
      {/* Rings quand il parle */}
      {speaking && (<>
        <div style={{ position: 'absolute', inset: -18, borderRadius: '50%', border: '2px solid rgba(124,58,237,0.2)', animation: 'ring1 1.8s ease-out infinite' }} />
        <div style={{ position: 'absolute', inset: -9, borderRadius: '50%', border: '2px solid rgba(124,58,237,0.4)', animation: 'ring1 1.8s ease-out infinite 0.35s' }} />
      </>)}

      {/* Cercle fond */}
      <div style={{
        width: 140, height: 140, borderRadius: '50%', overflow: 'hidden',
        background: 'linear-gradient(135deg,#1e1b4b,#4c1d95)',
        border: `3px solid ${speaking ? 'rgba(124,58,237,0.7)' : 'rgba(124,58,237,0.3)'}`,
        boxShadow: speaking
          ? '0 0 40px rgba(124,58,237,0.55), 0 0 80px rgba(124,58,237,0.2)'
          : '0 8px 32px rgba(124,58,237,0.25)',
        transition: 'box-shadow 0.35s, border-color 0.35s',
        position: 'relative', zIndex: 1,
      }}>
        {!imgError ? (
          <Image
            src="/alex-recruiter.png"
            alt="Alex — Recruteur IA"
            fill
            style={{ objectFit: 'cover', objectPosition: 'center top' }}
            onError={() => setImgError(true)}
            priority
          />
        ) : (
          /* Fallback SVG si pas de photo */
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="32" r="18" fill="rgba(255,255,255,0.15)" />
              <circle cx="32" cy="30" r="3" fill="white" opacity=".9" />
              <circle cx="48" cy="30" r="3" fill="white" opacity=".9" />
              <circle cx="33" cy="31" r="1.5" fill="#1e1b4b" />
              <circle cx="49" cy="31" r="1.5" fill="#1e1b4b" />
              <path d="M34 38 Q40 43 46 38" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M15 72 Q22 56 32 53 L40 59 L48 53 Q58 56 65 72Z" fill="rgba(255,255,255,0.1)" />
              <path d="M40 53 L37 68 L40 73 L43 68Z" fill="rgba(255,255,255,0.2)" />
            </svg>
          </div>
        )}
      </div>

      {/* Indicateur "live" */}
      {speaking && (
        <div style={{ position: 'absolute', bottom: 6, right: 6, zIndex: 2, width: 18, height: 18, borderRadius: '50%', background: '#7c3aed', border: '3px solid #050709', animation: 'livepulse 1s infinite' }} />
      )}

      {/* Pensées */}
      {thinking && (
        <div style={{ position: 'absolute', bottom: -28, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5, background: 'rgba(124,58,237,0.15)', padding: '5px 12px', borderRadius: 20 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#a78bfa', animation: `dot 1s ease-in-out ${i * 0.22}s infinite` }} />
          ))}
        </div>
      )}

      <style>{`
        @keyframes ring1 { 0%{transform:scale(1);opacity:.65} 100%{transform:scale(1.5);opacity:0} }
        @keyframes dot { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }
        @keyframes livepulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(0.85)} }
        @keyframes micpulse { 0%{box-shadow:0 0 0 0 rgba(16,185,129,.55),0 10px 28px rgba(16,185,129,.25)} 70%{box-shadow:0 0 0 24px rgba(16,185,129,0),0 10px 28px rgba(16,185,129,.25)} 100%{box-shadow:0 0 0 0 rgba(16,185,129,0),0 10px 28px rgba(16,185,129,.25)} }
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}

// ── Sound bars ────────────────────────────────────────────────────
function SoundBars({ active }: { active: boolean }) {
  const h = [6, 14, 10, 20, 8, 18, 10, 14, 6]
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 28 }}>
      {h.map((hi, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 3,
          background: active ? `hsl(${152 + i * 3},70%,${48 + i * 2}%)` : 'rgba(255,255,255,0.1)',
          height: active ? `${hi}px` : '4px',
          transition: 'height 0.12s ease, background 0.3s',
          animation: active ? `bar ${0.4 + i * 0.06}s ease-in-out infinite alternate` : 'none',
          animationDelay: `${i * 0.04}s`,
        }} />
      ))}
      <style>{`@keyframes bar { from{height:3px} to{height:22px} }`}</style>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────
export function InterviewRoomCandidate({ sessionId, candidateName, jobTitle, questions, mediaMode = 'audio', recordingsBucketId }: Props) {
  const [phase, setPhase] = useState<'intro' | 'interview' | 'done'>('intro')
  const [qIndex, setQIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [followUp, setFollowUp] = useState<string | null>(null)
  // Displayed (and spoken) in place of the closing question's own text while Alex answers
  // whatever the candidate just asked — separate from `followUp`, which also gates
  // submitAnswer()'s "this is a reply to a follow-up" branch; the closing turn always
  // auto-advances on its own (see submitAnswer), so it must not touch that mechanism.
  const [closingAnswer, setClosingAnswer] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isPending, startTransition] = useTransition()
  // Visible progress for uploading the recording — there was previously no indication at
  // all that anything was being saved after the interview ended.
  const [recordingUpload, setRecordingUpload] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [recordingUploadPct, setRecordingUploadPct] = useState(0)

  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [speechSupported, setSpeechSupported] = useState(false)
  const [micError, setMicError] = useState(false)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null)
  // Un seul MediaRecorder tourne en continu pour toute la durée de l'entretien (démarré à
  // "Commencer l'entretien", arrêté et uploadé une fois à la fin) — au lieu d'un fragment
  // audio par question, on obtient un enregistrement candidat continu.
  const fullRecorderRef = useRef<MediaRecorder | null>(null)
  const fullChunksRef = useRef<Blob[]>([])
  // Mixe le micro du candidat ET la voix TTS d'Alex dans un seul flux — sans ça, seule la
  // voix du candidat serait enregistrée en continu, et les questions d'Alex resteraient
  // des fichiers séparés (ce qui redonnait l'impression d'un entretien encore fragmenté).
  const audioContextRef = useRef<AudioContext | null>(null)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  // Tap on Alex's TTS audio (same graph as the mic mix above) purely for visualization —
  // drives the avatar's real-time speaking animation, not connected onward to anything.
  const analyserRef = useRef<AnalyserNode | null>(null)
  const avatarStageRef = useRef<HTMLDivElement | null>(null)
  const avatarBarRefs = useRef<(HTMLDivElement | null)[]>([])

  const currentQ = questions[qIndex]
  const progress = Math.round(((qIndex + (phase === 'done' ? 1 : 0)) / questions.length) * 100)
  const fullAnswer = answer + liveTranscript

  // Interdit soumettre pendant enregistrement actif
  const canSubmit = fullAnswer.trim().length > 0 && !isListening && !isThinking && !isPending && !isSpeaking

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis
      const SR = window.SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
      setSpeechSupported(!!SR)
    }
  }, [])

  // Fallback : voix native du navigateur (utilisée seulement si la génération de voix
  // IA échoue, ex. clé OpenAI non configurée — mieux vaut un son robotique que le silence)
  const speakBrowserFallback = useCallback((text: string, onEnd?: () => void) => {
    if (!synthRef.current) { onEnd?.(); return }
    synthRef.current.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang = 'fr-FR'
    utt.rate = 1.05
    utt.pitch = 0.75
    utt.volume = 1
    const voices = synthRef.current.getVoices()
    const frVoices = voices.filter(v => v.lang.startsWith('fr'))
    const maleKeywords = ['male', 'homme', 'paul', 'thomas', 'remy', 'rémy', 'nicolas', 'pierre', 'jean', 'henri']
    const maleVoice = frVoices.find(v => maleKeywords.some(k => v.name.toLowerCase().includes(k)))
      ?? frVoices.find(v => !['female', 'femme', 'amelie', 'amélie', 'marie', 'sophie', 'alice'].some(k => v.name.toLowerCase().includes(k)))
      ?? frVoices[0]
      ?? voices[0]
    if (maleVoice) utt.voice = maleVoice
    utt.onstart = () => setIsSpeaking(true)
    utt.onend = () => { setIsSpeaking(false); onEnd?.() }
    utt.onerror = () => { setIsSpeaking(false); onEnd?.() }
    synthRef.current.speak(utt)
  }, [])

  // Voix IA réelle (OpenAI TTS) — remplace la voix robotique du navigateur. Elle est
  // routée dans le même AudioContext que le micro (ci-dessous) pour finir mixée dans
  // l'unique enregistrement complet, plutôt que sauvegardée séparément par question.
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!voiceEnabled) { onEnd?.(); return }
    setIsThinking(true)
    generateInterviewSpeech(text).then(res => {
      setIsThinking(false)
      if (res.error || !res.audioBase64) {
        speakBrowserFallback(text, onEnd)
        return
      }
      const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`)
      ttsAudioRef.current = audio
      // Route la voix d'Alex dans le même flux que le micro, pour qu'elle finisse dans
      // l'enregistrement continu (sinon captée nulle part). Best-effort : si ça échoue,
      // la voix se joue quand même normalement, juste sans être enregistrée.
      if (audioContextRef.current && destRef.current) {
        try {
          const ctx = audioContextRef.current
          const src = ctx.createMediaElementSource(audio)
          src.connect(destRef.current)
          src.connect(ctx.destination)
          if (analyserRef.current) src.connect(analyserRef.current)
        } catch { /* le play() direct ci-dessous reste le chemin audible principal */ }
      }
      audio.onplay = () => setIsSpeaking(true)
      audio.onended = () => { setIsSpeaking(false); onEnd?.() }
      audio.onerror = () => { setIsSpeaking(false); onEnd?.() }
      audio.play().catch(() => { setIsSpeaking(false); onEnd?.() })
    }).catch(() => {
      setIsThinking(false)
      speakBrowserFallback(text, onEnd)
    })
  }, [voiceEnabled, speakBrowserFallback])

  const stopSpeaking = useCallback(() => {
    ttsAudioRef.current?.pause()
    synthRef.current?.cancel()
    setIsSpeaking(false)
  }, [])

  // Anime l'avatar (léger effet d'échelle + barres) au rythme réel de la voix d'Alex —
  // lu directement depuis l'analyser tapé sur son flux audio. Mutation DOM directe via refs
  // plutôt que du state React : ça tourne à 60fps, un setState par frame serait beaucoup
  // trop coûteux. N'a aucun effet pendant le repli speechSynthesis du navigateur (pas de
  // nœud audio accessible pour cette voix-là) — l'avatar garde alors juste son pulse fixe.
  useEffect(() => {
    if (!isSpeaking) {
      if (avatarStageRef.current) avatarStageRef.current.style.transform = 'scale(1)'
      avatarBarRefs.current.forEach(el => { if (el) el.style.height = '4px' })
      return
    }
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length / 255
      if (avatarStageRef.current) avatarStageRef.current.style.transform = `scale(${1 + avg * 0.08})`
      avatarBarRefs.current.forEach((el, i) => {
        if (!el) return
        const v = data[Math.min(data.length - 1, i * 3 + 2)] / 255
        el.style.height = `${4 + v * 22}px`
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [isSpeaking])

  // Obtenir le stream micro (+ caméra si entretien vidéo) — une seule fois
  const getMicStream = useCallback(async (): Promise<MediaStream | null> => {
    if (mediaStreamRef.current) return mediaStreamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mediaMode === 'video' })
      mediaStreamRef.current = stream
      setMicError(false)
      return stream
    } catch (e) {
      if (mediaMode === 'video') {
        // Caméra refusée/indisponible : on retombe en audio seul plutôt que de bloquer l'entretien.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          mediaStreamRef.current = stream
          setMicError(false)
          return stream
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2)
          reportRecordingFailure(sessionId, `getUserMedia (audio seul, repli vidéo) refusé : ${msg}`).catch(() => {})
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        reportRecordingFailure(sessionId, `getUserMedia refusé : ${msg}`).catch(() => {})
      }
      // No mic access: speech-to-text may still work off the browser's own recognition
      // engine, but the audio recording itself won't exist — tell the candidate rather
      // than silently skipping it.
      setMicError(true)
      return null
    }
  }, [mediaMode, sessionId])

  // Démarre l'enregistrement continu de l'entretien (audio, + vidéo si mode vidéo — une
  // seule fois, à "Commencer l'entretien") — remplace l'ancien enregistrement fragmenté
  // par question. Le micro du candidat ET la voix TTS d'Alex (routée dans speak()) sont
  // mixés dans un seul flux via Web Audio, pour obtenir un vrai fichier continu couvrant
  // toute la conversation — pas juste le micro seul.
  const startFullRecording = useCallback(async () => {
    const stream = await getMicStream()
    if (!stream || fullRecorderRef.current) return
    fullChunksRef.current = []
    const hasVideo = mediaMode === 'video' && stream.getVideoTracks().length > 0

    // Le mixage Web Audio (micro + voix TTS d'Alex dans un seul flux) peut échouer sur
    // certains appareils/navigateurs — ex. pas de piste audio exploitable dans le flux
    // getUserMedia à ce moment précis. Avant ce garde-fou, une erreur ici empêchait
    // silencieusement TOUT enregistrement (l'appel n'était jamais dans un try/catch, donc
    // fullRecorderRef.current ne se posait jamais et stopAndUploadFullRecording() n'avait
    // plus rien à faire en fin d'entretien) — un enregistrement du micro seul, sans la voix
    // d'Alex mixée, vaut largement mieux qu'aucun enregistrement du tout.
    let recordStream: MediaStream = stream
    try {
      const AudioContextCtor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioContextCtor()
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      const dest = ctx.createMediaStreamDestination()
      const micAudioOnly = new MediaStream(stream.getAudioTracks())
      if (micAudioOnly.getAudioTracks().length === 0) throw new Error('Aucune piste audio dans le flux micro')
      ctx.createMediaStreamSource(micAudioOnly).connect(dest)
      audioContextRef.current = ctx
      destRef.current = dest
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyserRef.current = analyser
      recordStream = new MediaStream([
        ...dest.stream.getAudioTracks(),
        ...(hasVideo ? stream.getVideoTracks() : []),
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("Mixage micro + voix d'Alex indisponible, enregistrement du micro seul :", e)
      reportRecordingFailure(sessionId, `mixage audio échoué (repli micro seul) : ${msg}`).catch(() => {})
    }

    try {
      const candidates = hasVideo
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['audio/webm;codecs=opus', 'audio/webm']
      const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      // Débit plafonné : le bucket Appwrite est limité à ~28,6 Mo (_APP_STORAGE_LIMIT côté
      // serveur), donc un enregistrement à débit par défaut du navigateur (plusieurs Mbps en
      // vidéo) dépasse cette limite en quelques minutes et l'upload échoue en cours de route.
      const options: MediaRecorderOptions = { audioBitsPerSecond: 32_000 }
      if (mimeType) options.mimeType = mimeType
      if (hasVideo) options.videoBitsPerSecond = 80_000
      const mr = new MediaRecorder(recordStream, options)
      mr.ondataavailable = e => { if (e.data.size > 0) fullChunksRef.current.push(e.data) }
      mr.start(2000)
      fullRecorderRef.current = mr
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('Impossible de démarrer MediaRecorder — aucun enregistrement pour cet entretien :', e)
      reportRecordingFailure(sessionId, `MediaRecorder n'a pas pu démarrer : ${msg}`).catch(() => {})
    }
  }, [getMicStream, mediaMode, sessionId])

  // Arrête l'enregistrement et upload le fichier unique — appelé une fois, à la fin de
  // l'entretien. Envoyé directement du navigateur vers Appwrite Storage (pas via une Server
  // Action) : Vercel plafonne le corps d'une fonction serverless à environ 4,5 Mo quoi que
  // dise la config Next.js, et un enregistrement dépasse ça très vite — c'est ce qui faisait
  // échouer silencieusement (puis bruyamment, une fois les diagnostics ajoutés) tous les
  // envois jusqu'ici.
  const stopAndUploadFullRecording = useCallback(() => {
    const mr = fullRecorderRef.current
    if (!mr) { setRecordingUpload('error'); return }
    const isVideo = mr.mimeType.startsWith('video/')
    mr.onstop = () => {
      const blob = new Blob(fullChunksRef.current, { type: mr.mimeType || (isVideo ? 'video/webm' : 'audio/webm') })
      fullChunksRef.current = []
      if (blob.size > 500) {
        setRecordingUpload('uploading')
        setRecordingUploadPct(0)
        const mediaType = isVideo ? 'video' : 'audio'
        const file = new File([blob], `interview-${sessionId}-candidat-complet.webm`, { type: blob.type })
        getBrowserStorage().createFile(
          recordingsBucketId,
          ID.unique(),
          file,
          undefined,
          p => setRecordingUploadPct(Math.round(p.progress)),
        ).then(async uploaded => {
          // Le fichier lourd est déjà bien envoyé à ce stade — il ne reste qu'à
          // enregistrer sa référence en base, un appel léger. Un "Server Error" isolé
          // ici est presque toujours une contention passagère côté serveur Appwrite
          // (l'analyse IA + les emails de fin d'entretien tapent le même serveur au
          // même instant) : quelques tentatives suffisent, inutile de perdre l'upload.
          let lastError = ''
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const res = await attachRecordingToInterview(sessionId, uploaded.$id, mediaType)
              if (!res.error) return res
              lastError = res.error
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e)
            }
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
          }
          return { error: lastError }
        }).then(res => {
          if (res.error) {
            console.error("Échec du rattachement de l'enregistrement :", res.error)
            reportRecordingFailure(sessionId, `rattachement rejeté après plusieurs tentatives : ${res.error}`).catch(() => {})
            setRecordingUpload('error')
          } else {
            setRecordingUpload('done')
          }
        }).catch(e => {
          const msg = e instanceof Error ? e.message : String(e)
          console.error("Échec de l'upload de l'enregistrement :", e)
          reportRecordingFailure(sessionId, `upload direct a levé une exception : ${msg}`).catch(() => {})
          setRecordingUpload('error')
        })
      } else {
        console.error(`Enregistrement quasi vide (${blob.size} octets), rien à uploader.`)
        reportRecordingFailure(sessionId, `blob quasi vide (${blob.size} octets) — rien capturé`).catch(() => {})
        setRecordingUpload('error')
      }
      audioContextRef.current?.close().catch(() => {})
      audioContextRef.current = null
      destRef.current = null
      analyserRef.current = null
    }
    mr.stop()
    fullRecorderRef.current = null
  }, [sessionId, recordingsBucketId])

  // STT — démarrer l'écoute
  const startListening = useCallback(async () => {
    if (!speechSupported) return
    const SR = window.SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
    if (!SR) return
    stopSpeaking()
    await getMicStream()

    const rec = new SR()
    rec.lang = 'fr-FR'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t + ' '
        else interim += t
      }
      if (final) setAnswer(prev => prev + final)
      setLiveTranscript(interim)
    }
    rec.onerror = () => { setIsListening(false); setLiveTranscript('') }
    rec.onend = () => {
      setIsListening(false)
      setLiveTranscript('')
    }
    recognitionRef.current = rec
    rec.start()
    setIsListening(true)
  }, [speechSupported, stopSpeaking, getMicStream])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
    setLiveTranscript('')
  }, [])

  const toggleMic = useCallback(() => {
    if (isListening) stopListening()
    else startListening()
  }, [isListening, startListening, stopListening])

  // Parler la question quand elle change (qIndex) ou qu'une relance IA est posée (followUp).
  // `phase` est volontairement exclu des deps : le passage intro -> interview déclenche déjà
  // son propre speak() (message de bienvenue) au clic sur "Commencer l'entretien", donc ne pas
  // re-déclencher ici évite que la voix se dédouble sur la première question.
  useEffect(() => {
    if (phase !== 'interview' || !voiceEnabled) return
    const text = followUp ?? currentQ?.text
    if (text) setTimeout(() => speak(text), 400)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, followUp, voiceEnabled])

  async function submitAnswer() {
    const full = fullAnswer.trim()
    if (!full || isListening) return  // garde : ne soumet jamais pendant l'écoute
    stopListening()
    stopSpeaking()
    setAnswer('')
    setLiveTranscript('')

    const entry: TranscriptEntry = { role: 'candidate', content: full, timestamp: new Date().toISOString() }
    const newT = [...transcript, entry]
    setTranscript(newT)
    await saveInterviewProgress(sessionId, newT, 'in_progress')

    if (followUp) {
      setFollowUp(null)
      advance(newT)
      return
    }

    // The "closing" slot is "des questions pour nous / prochaines étapes" (see question
    // generation prompt) — whatever the candidate says here (a question, or "non merci")
    // is by definition a complete response, never something to probe further. Running it
    // through the generic is-this-answer-complete follow-up check produced a confusing
    // loop: the candidate asking a real question got treated as an incomplete answer and
    // re-prompted with "avez-vous des questions plus spécifiques ?" instead of the
    // interview just moving on. Here, a real question still gets answered once — just
    // without inviting yet another reply.
    if (currentQ.category === 'closing') {
      setIsThinking(true)
      startTransition(async () => {
        const { answer } = await answerClosingQuestion(jobTitle, full)
        setIsThinking(false)
        if (answer) {
          const wi = [...newT, { role: 'interviewer' as const, content: answer, timestamp: new Date().toISOString() }]
          setTranscript(wi)
          setClosingAnswer(answer)
          if (voiceEnabled) speak(answer, () => advance(wi))
          else advance(wi)
        } else {
          advance(newT)
        }
      })
      return
    }

    setIsThinking(true)
    startTransition(async () => {
      const { followUp: fu } = await getCandidateAIFollowUp(currentQ, full)
      setIsThinking(false)
      if (fu) {
        setFollowUp(fu)
        const wi = [...newT, { role: 'interviewer' as const, content: fu, timestamp: new Date().toISOString() }]
        setTranscript(wi)
        // speak() is handled by the useEffect watching `followUp` — don't call it here too,
        // or the relance plays twice.
      } else {
        advance(newT)
      }
    })
  }

  function advance(cur: TranscriptEntry[]) {
    if (qIndex + 1 >= questions.length) {
      setPhase('done')
      stopAndUploadFullRecording()
      saveInterviewProgress(sessionId, cur, 'completed')
      if (voiceEnabled) setTimeout(() => speak(`Merci ${candidateName}, l'entretien est terminé. Excellent travail. Vos réponses ont été enregistrées et le recruteur vous contactera prochainement. Bonne chance !`), 400)
    } else {
      const next = questions[qIndex + 1]
      setQIndex(i => i + 1)
      setFollowUp(null)
      setClosingAnswer(null)
      setTranscript([...cur, { role: 'interviewer', content: next.text, timestamp: new Date().toISOString() }])
    }
  }

  // ── Intro ────────────────────────────────────────────────────
  if (phase === 'intro') return (
    <div style={{ minHeight: '100vh', background: '#050709', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'white' }}>
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <RecruiterPhoto speaking={false} thinking={false} />
        <div style={{ marginTop: '2.5rem' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Entretien IA · {jobTitle}
          </p>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 700, color: 'white', marginBottom: '0.75rem', lineHeight: 1.2 }}>
            Bonjour {candidateName} 👋
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', lineHeight: 1.85, marginBottom: '2rem', fontSize: '0.9rem' }}>
            Je suis <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Alex</strong>, votre recruteur IA pour le poste de{' '}
            <strong style={{ color: '#a78bfa' }}>{jobTitle}</strong>.<br />
            Je vais vous poser <strong style={{ color: 'rgba(255,255,255,0.85)' }}>{questions.length} questions</strong> sur votre profil.<br />
            Vous pouvez répondre <strong style={{ color: '#34d399' }}>à la voix</strong> ou <strong style={{ color: '#60a5fa' }}>par écrit</strong>.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1.75rem' }}>
            {[
              { icon: '🎯', val: `${questions.length} questions` },
              { icon: '⏱️', val: '15–20 min' },
              { icon: '🎙️', val: 'Voix + texte' },
            ].map(x => (
              <div key={x.val} style={{ padding: '1rem', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ fontSize: 22, marginBottom: '0.4rem' }}>{x.icon}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{x.val}</div>
              </div>
            ))}
          </div>

          {mediaMode === 'video' && (
            <p style={{ fontSize: 12, color: '#a78bfa', marginBottom: '1.25rem', padding: '0.6rem 1rem', borderRadius: 10, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}>
              📹 Entretien vidéo — pensez à activer votre caméra quand l&apos;entretien commence.
            </p>
          )}

          {/* Voix toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '1.75rem', padding: '0.75rem 1.25rem', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Voix d&apos;Alex :</span>
            <button onClick={() => setVoiceEnabled(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderRadius: 10, background: voiceEnabled ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.06)', color: voiceEnabled ? '#a78bfa' : 'rgba(255,255,255,0.3)', border: `1px solid ${voiceEnabled ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.1)'}`, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {voiceEnabled ? <Volume2 style={{ width: 13, height: 13 }} /> : <VolumeX style={{ width: 13, height: 13 }} />}
              {voiceEnabled ? 'Activée' : 'Désactivée'}
            </button>
          </div>

          <button
            onClick={() => {
              setPhase('interview')
              startFullRecording().catch(e => console.error('startFullRecording a levé une exception :', e))
              setTranscript([{ role: 'interviewer', content: questions[0].text, timestamp: new Date().toISOString() }])
              if (voiceEnabled) setTimeout(() => speak(`Bonjour ${candidateName}. Je suis Alex, votre recruteur. Commençons directement. ${questions[0].text}`), 600)
            }}
            style={{ width: '100%', padding: '1rem 2rem', borderRadius: 16, background: 'linear-gradient(135deg,#6d28d9,#7c3aed)', color: 'white', fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,58,237,0.4)' }}>
            Commencer l&apos;entretien →
          </button>
        </div>
      </div>
    </div>
  )

  // ── Done ─────────────────────────────────────────────────────
  // L'écran final se joue en deux temps : d'abord un loader pendant que
  // l'enregistrement s'envoie vers Appwrite, puis (seulement une fois l'upload
  // réellement terminé, en succès ou en échec) le message de remerciement — pour
  // ne jamais dire "c'est enregistré" avant que ce soit vrai.
  if (phase === 'done' && (recordingUpload === 'idle' || recordingUpload === 'uploading')) return (
    <div style={{ minHeight: '100vh', background: '#050709', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'white' }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto 2.25rem' }}>
          <svg viewBox="0 0 36 36" style={{ width: 128, height: 128, transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#a78bfa" strokeWidth="2"
              strokeDasharray={`${recordingUploadPct} 100`} strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.3s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: '#a78bfa', marginBottom: 6 }} />
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a78bfa' }}>{recordingUploadPct}%</span>
          </div>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}>Envoi de votre entretien…</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', lineHeight: 1.85, fontSize: '0.9rem' }}>
          Merci {candidateName}, on finalise la sauvegarde.<br />
          Ne fermez pas cette page, ça ne prendra qu&apos;un instant.
        </p>
      </div>
    </div>
  )

  if (phase === 'done') return (
    <div style={{ minHeight: '100vh', background: '#050709', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'white' }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
          <CheckCircle2 style={{ width: 36, height: 36, color: '#10b981' }} />
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>Entretien terminé !</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', lineHeight: 1.85, fontSize: '0.9rem' }}>
          Merci {candidateName} pour votre temps.<br />
          Vos réponses ont été enregistrées.<br />
          Vous serez contacté prochainement par le recruteur.
        </p>
        <div style={{ marginTop: '2rem', padding: '1.25rem', borderRadius: 14, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
          <p style={{ color: '#34d399', fontSize: '0.85rem', fontWeight: 600 }}>
            {questions.length} questions répondues · Bonne chance ! 🍀
          </p>
        </div>

        {recordingUpload === 'error' && (
          <p style={{ marginTop: '1.25rem', color: 'rgba(248,113,113,0.75)', fontSize: '0.75rem', lineHeight: 1.6 }}>
            L&apos;enregistrement audio{mediaMode === 'video' ? '/vidéo' : ''} n&apos;a pas pu être sauvegardé — vos réponses écrites restent enregistrées.
          </p>
        )}
      </div>
    </div>
  )

  // ── Interview ─────────────────────────────────────────────────
  const questionText = closingAnswer ?? followUp ?? currentQ.text
  const catColor = CAT_COLORS[currentQ.category] ?? '#a78bfa'

  return (
    <div style={{ minHeight: '100vh', background: '#050709', color: 'white', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(5,7,9,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0.75rem 1.5rem' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>
              Alex · Recruteur IA · {jobTitle}
            </p>
          </div>
          <button onClick={() => { setVoiceEnabled(v => !v); if (isSpeaking) stopSpeaking() }}
            style={{ padding: '5px 10px', borderRadius: 8, background: voiceEnabled ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)', color: voiceEnabled ? '#a78bfa' : 'rgba(255,255,255,0.25)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600 }}>
            {voiceEnabled ? <Volume2 style={{ width: 12, height: 12 }} /> : <VolumeX style={{ width: 12, height: 12 }} />}
            {voiceEnabled ? 'Son on' : 'Son off'}
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 600 }}>{qIndex + 1}/{questions.length}</span>
          <div style={{ width: 72, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ width: `${progress}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#6d28d9,#a78bfa)', transition: 'width 0.4s ease' }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 680, margin: '0 auto', width: '100%', padding: '2rem 1.5rem 3rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

        {/* Alex parle → avatar (avec animation réactive à sa voix) · au tour du candidat → sa webcam */}
        <div style={{ textAlign: 'center', paddingTop: '0.25rem' }}>
          {mediaMode === 'video' && !(isSpeaking || isThinking || isPending) ? (
            <div style={{ position: 'relative', width: 220, height: 165, margin: '0 auto', borderRadius: 18, overflow: 'hidden', border: '2px solid rgba(16,185,129,0.4)', boxShadow: '0 8px 32px rgba(16,185,129,0.15)', background: '#111' }}>
              <video
                ref={el => {
                  videoPreviewRef.current = el
                  if (el && mediaStreamRef.current) el.srcObject = mediaStreamRef.current
                }}
                autoPlay muted playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <span style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 10, fontWeight: 700, color: 'white', background: 'rgba(16,185,129,0.85)', padding: '3px 8px', borderRadius: 20 }}>
                Vous
              </span>
            </div>
          ) : (
            <div ref={avatarStageRef}>
              <RecruiterPhoto speaking={isSpeaking} thinking={isThinking || isPending} />
              {isSpeaking && (
                <div style={{ display: 'flex', gap: 3, height: 22, alignItems: 'flex-end', justifyContent: 'center', marginTop: 10 }}>
                  {[0, 1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} ref={el => { avatarBarRefs.current[i] = el }}
                      style={{ width: 3, borderRadius: 3, background: '#a78bfa', height: 4 }} />
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: isThinking ? '2rem' : '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isThinking || isPending ? '#f59e0b' : isSpeaking ? '#7c3aed' : isListening ? '#10b981' : 'rgba(255,255,255,0.15)',
              transition: 'background 0.3s',
              animation: (isSpeaking || isListening || isThinking || isPending) ? 'livepulse 1.2s infinite' : 'none',
            }} />
            <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>
              {isThinking || isPending ? 'Alex réfléchit à votre réponse…'
                : isSpeaking ? 'Alex parle…'
                : isListening ? '🎙️ Enregistrement en cours — parlez librement'
                : 'Alex attend votre réponse'}
            </p>
          </div>
        </div>

        {/* Bulle question */}
        <div style={{ position: 'relative', borderRadius: 20, padding: '1.75rem', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', boxShadow: '0 4px 32px rgba(124,58,237,0.06)' }}>
          <div style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '9px solid transparent', borderRight: '9px solid transparent', borderBottom: '9px solid rgba(124,58,237,0.2)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: followUp ? '#f59e0b' : catColor, background: followUp ? 'rgba(245,158,11,0.12)' : `${catColor}18`, padding: '3px 10px', borderRadius: 20 }}>
              {followUp ? '💬 Question de précision' : CAT_LABELS[currentQ.category]}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Q{qIndex + 1}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {isSpeaking ? (
                <button onClick={stopSpeaking}
                  style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                  ▌▌ Stop
                </button>
              ) : voiceEnabled ? (
                <button onClick={() => speak(questionText)}
                  style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RotateCcw style={{ width: 10, height: 10 }} /> Réécouter
                </button>
              ) : null}
            </div>
          </div>
          <p style={{ fontSize: '1.08rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1.72 }}>{questionText}</p>
        </div>

        {/* Toggle mode */}
        <div style={{ display: 'flex', gap: '0.375rem', background: 'rgba(255,255,255,0.03)', padding: '0.25rem', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
          {(['voice', 'text'] as const).map(mode => (
            <button key={mode}
              onClick={() => { setInputMode(mode); if (mode === 'text' && isListening) stopListening() }}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 9, background: inputMode === mode ? 'rgba(255,255,255,0.08)' : 'transparent', color: inputMode === mode ? 'white' : 'rgba(255,255,255,0.3)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', transition: 'all 0.2s' }}>
              {mode === 'voice' ? <><Mic style={{ width: 13, height: 13 }} />Voix</> : <><MessageSquare style={{ width: 13, height: 13 }} />Texte</>}
            </button>
          ))}
        </div>

        {/* ── MODE VOIX ── */}
        {inputMode === 'voice' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
            {speechSupported ? (<>

              {micError && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', width: '100%', textAlign: 'center' }}>
                  <p style={{ color: '#fbbf24', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    Micro non accessible — vérifiez les autorisations de votre navigateur.<br />
                    <span style={{ color: 'rgba(255,255,255,0.35)' }}>Votre réponse texte sera quand même envoyée, mais sans enregistrement audio.</span>
                  </p>
                </div>
              )}

              {/* Instructions claires */}
              {!isListening && !answer && (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
                  Appuyez sur le micro → parlez → appuyez à nouveau pour arrêter → envoyez
                </p>
              )}

              {/* Bouton mic */}
              <button onClick={toggleMic}
                disabled={isThinking || isPending || isSpeaking}
                style={{
                  width: 96, height: 96, borderRadius: '50%', border: 'none',
                  cursor: isThinking || isPending || isSpeaking ? 'not-allowed' : 'pointer',
                  background: isListening
                    ? 'linear-gradient(135deg,#065f46,#10b981)'
                    : 'linear-gradient(135deg,#4c1d95,#7c3aed)',
                  animation: isListening ? 'micpulse 1.5s ease-out infinite' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.3s, opacity 0.2s',
                  opacity: isThinking || isPending || isSpeaking ? 0.4 : 1,
                  boxShadow: isListening ? '0 10px 28px rgba(16,185,129,0.3)' : '0 10px 28px rgba(124,58,237,0.35)',
                }}>
                {isListening
                  ? <MicOff style={{ width: 36, height: 36, color: 'white' }} />
                  : <Mic style={{ width: 36, height: 36, color: 'white' }} />
                }
              </button>

              <SoundBars active={isListening} />

              <p style={{ fontSize: 12, fontWeight: 700, color: isListening ? '#34d399' : 'rgba(255,255,255,0.2)' }}>
                {isListening ? '● Enregistrement actif — cliquez à nouveau pour arrêter' : answer ? '✓ Réponse prête — cliquez Envoyer' : 'Prêt à enregistrer'}
              </p>

              {/* Transcript affiché + bouton effacer */}
              {(answer || liveTranscript) && (
                <div style={{ width: '100%', padding: '1rem 1.25rem', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'left', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Votre réponse
                    </p>
                    <button onClick={() => { setAnswer(''); setLiveTranscript('') }}
                      style={{ fontSize: 10, color: 'rgba(239,68,68,0.5)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                      ✕ Effacer
                    </button>
                  </div>
                  <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.7 }}>
                    {answer}
                    {liveTranscript && <span style={{ color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>{liveTranscript}</span>}
                  </p>
                </div>
              )}

            </>) : (
              <div style={{ padding: '1.5rem', borderRadius: 14, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', width: '100%', textAlign: 'center' }}>
                <p style={{ color: '#f87171', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  Reconnaissance vocale non disponible sur ce navigateur.<br />
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>Utilisez Chrome ou Edge, ou passez en mode texte.</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── MODE TEXTE ── */}
        {inputMode === 'text' && (
          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAnswer() }}
            placeholder="Rédigez votre réponse… (Ctrl+Entrée pour envoyer)"
            rows={5}
            disabled={isThinking || isPending}
            autoFocus
            style={{ width: '100%', padding: '1.25rem', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        )}

        {/* Bouton Envoyer — SÉPARÉ et clairement distinct du mic */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Message d'aide si micro actif */}
          {isListening && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                ⚠️ Arrêtez l&apos;enregistrement avant d&apos;envoyer (cliquez sur le micro)
              </p>
            </div>
          )}

          <button
            onClick={submitAnswer}
            disabled={!canSubmit}
            style={{
              width: '100%', padding: '1rem', borderRadius: 16,
              background: canSubmit ? 'linear-gradient(135deg,#6d28d9,#7c3aed)' : 'rgba(255,255,255,0.05)',
              color: canSubmit ? 'white' : 'rgba(255,255,255,0.2)',
              border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontWeight: 700, fontSize: '0.95rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.625rem',
              transition: 'all 0.2s',
              boxShadow: canSubmit ? '0 4px 20px rgba(124,58,237,0.35)' : 'none',
            }}>
            {isThinking || isPending
              ? <><Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />Alex analyse…</>
              : isListening
              ? <><MicOff style={{ width: 17, height: 17 }} />Arrêtez le micro d&apos;abord</>
              : <><Send style={{ width: 17, height: 17 }} />Envoyer ma réponse <ChevronRight style={{ width: 16, height: 16 }} /></>
            }
          </button>
        </div>
      </div>

      <style>{`
        @keyframes micpulse { 0%{box-shadow:0 0 0 0 rgba(16,185,129,.55),0 10px 28px rgba(16,185,129,.25)} 70%{box-shadow:0 0 0 26px rgba(16,185,129,0),0 10px 28px rgba(16,185,129,.25)} 100%{box-shadow:0 0 0 0 rgba(16,185,129,0),0 10px 28px rgba(16,185,129,.25)} }
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:.35} }
      `}</style>
    </div>
  )
}
