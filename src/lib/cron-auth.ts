import { timingSafeEqual } from 'crypto'

/**
 * `Authorization: Bearer <secret>`, comparé en temps constant. Refuse tout quand le secret manque ou est trop court,
 * pour qu'une variable non définie ne puisse jamais correspondre à « Bearer undefined ».
 */
export function hasBearerSecret(req: Request, secret: string | undefined, minLength: number): boolean {
  if (!secret || secret.length < minLength) return false
  const received = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
export function isAuthorizedCronRequest(req: Request): boolean {
  return hasBearerSecret(req, process.env.CRON_SECRET, 16)
}
