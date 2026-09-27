import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function ensureAttr(
  databases: ReturnType<typeof createAdminClient>['databases'],
  collId: string,
  key: string,
  size: number,
) {
  try {
    await databases.createStringAttribute(DB_ID, collId, key, size, false, '')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('already') && !msg.includes('409')) throw e
  }
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try {
      const attrs = await databases.listAttributes(DB_ID, collId)
      const attr = attrs.attributes.find((a: { key: string; status: string }) => a.key === key)
      if (attr?.status === 'available') return true
    } catch { /* keep polling */ }
  }
  return false
}

export async function POST() {
  try {
    const { databases } = createAdminClient()
    const results: Record<string, boolean> = {}

    // coverLetter on APPLICATIONS (for candidate apply form)
    results.coverLetter = await ensureAttr(databases, COLLECTIONS.APPLICATIONS, 'coverLetter', 3000)
    // documentsJson on APPLICATIONS (JSON array of extra file IDs)
    results.documentsJson = await ensureAttr(databases, COLLECTIONS.APPLICATIONS, 'documentsJson', 2048)

    return NextResponse.json({ ok: true, results })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
