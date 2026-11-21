import { z } from 'zod'
import type { SpeechLine } from '@/lib/voice-turn'

// Corps d'une demande à la route de la voix de l'entretien vocal (/api/interview/<id>/speech, ADR 0052). Hors de
// voice-turn.ts, que la page importe : zod n'a pas à partir dans le navigateur. Testé dans interview-speech-request.test.ts.

const SpeechLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), index: z.number().int().min(0).max(99) }),
  z.object({ kind: z.literal('closing') }),
  z.object({ kind: z.literal('reprompt') }),
])

/** La phrase demandée, ou null si la demande n'a pas une des formes prévues. */
export function parseSpeechLine(body: unknown): SpeechLine | null {
  const parsed = SpeechLineSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}
