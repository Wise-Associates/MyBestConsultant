import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'

// Qui se cache derrière une candidature ? `application.candidateId` désigne un document « users » :
//  • un candidat classique (compte réel) ;
//  • un profil du vivier d'un chasseur de têtes (role = 'hunter_profile', sans compte : le chasseur reste
//    l'intermédiaire — c'est lui qu'on contacte).
// Ce résolveur unique évite de dupliquer cette logique dans chaque écran recruteur.

export interface HunterContact {
  userId: string      // id d'authentification du chasseur (destinataire des notifications)
  name: string
  email: string
  whatsapp?: string
  phone?: string
}

export interface CandidateIdentity {
  id: string
  name: string
  /** Email d'affichage : celui du candidat, ou celui du chasseur pour un profil de vivier. */
  email: string
  photoUrl?: string
  /** WhatsApp joignable : celui du candidat (s'il l'a renseigné = consentement), ou celui du chasseur. */
  whatsapp?: string
  /** Téléphone (candidat, ou chasseur pour un profil de vivier) — repli pour un contact WhatsApp non confirmé. */
  phone?: string
  hunter?: HunterContact
}

export const HUNTER_PROFILE_ROLE = 'hunter_profile'

export async function resolveCandidateIdentities(candidateDocIds: string[]): Promise<Map<string, CandidateIdentity>> {
  const out = new Map<string, CandidateIdentity>()
  const ids = [...new Set(candidateDocIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const { databases } = createAdminClient()
    const docs = (await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
      databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('$id', ids.slice(i * 100, i * 100 + 100)), Query.limit(100)]).then(r => r.documents),
    ))).flat()

    const hunterIds = [...new Set(docs.filter(d => d.role === HUNTER_PROFILE_ROLE && d.hunterUserId).map(d => d.hunterUserId as string))]
    const hunters = new Map<string, HunterContact>()
    if (hunterIds.length > 0) {
      const hd = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', hunterIds.slice(0, 100)), Query.limit(100)])
      for (const h of hd.documents) {
        hunters.set(h.userId as string, {
          userId: h.userId as string, name: `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim(),
          email: (h.email as string) ?? '', whatsapp: (h.whatsapp as string) || undefined, phone: (h.phone as string) || undefined,
        })
      }
    }

    for (const d of docs) {
      const name = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim()
      if (d.role === HUNTER_PROFILE_ROLE) {
        const hunter = hunters.get(d.hunterUserId as string)
        out.set(d.$id, { id: d.$id, name, email: hunter?.email ?? '', whatsapp: hunter?.whatsapp, phone: hunter?.phone, hunter })
      } else {
        out.set(d.$id, { id: d.$id, name, email: (d.email as string) ?? '', photoUrl: (d.photoUrl as string) || undefined, whatsapp: (d.whatsapp as string) || undefined, phone: (d.phone as string) || undefined })
      }
    }
  } catch { /* les écrans retombent sur un libellé générique */ }
  return out
}

/** Email à AFFICHER pour un document « users » (vide pour un profil de chasseur : son adresse est purement technique). */
export function displayEmail(userDoc: object): string {
  const d = userDoc as { role?: unknown; email?: unknown }
  return d.role === HUNTER_PROFILE_ROLE ? '' : (typeof d.email === 'string' ? d.email : '')
}

/** Destinataire des notifications pour un document « users » : le chasseur pour un profil de vivier, sinon le compte lui-même. */
export function notificationUserId(userDoc: { userId?: unknown; role?: unknown; hunterUserId?: unknown }): string | null {
  const id = userDoc.role === HUNTER_PROFILE_ROLE ? userDoc.hunterUserId : userDoc.userId
  return typeof id === 'string' && id ? id : null
}
