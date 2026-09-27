'use client'

// Client-side Appwrite SDK (the `appwrite` package, distinct from `node-appwrite` used
// server-side) — for uploads that must go straight from the browser to Appwrite Storage
// instead of through a Next.js Server Action, whose request body Vercel caps at ~4.5MB
// regardless of Next.js's own configurable limit. Only NEXT_PUBLIC_-prefixed env vars are
// available here; no admin secret is ever exposed to the browser.
import { Client, Storage } from 'appwrite'

export function getBrowserStorage(): Storage {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  return new Storage(client)
}
