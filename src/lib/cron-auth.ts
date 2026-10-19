import { timingSafeEqual } from 'crypto'

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Refuse everything when the secret
// is missing or too short, so an unset variable can never match "Bearer undefined".
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return false
  const received = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}
