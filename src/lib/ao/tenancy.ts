import { createHash } from 'node:crypto'

// Organisations du module AO Offers (docs/adr/0005-ao-boites-par-organisation.md) : chaque organisation lit ses
// propres boîtes ; ses e-mails, offres, verrou de synchronisation et quotas d'IA lui sont propres.

/** Organisation « plateforme » : nos propres boîtes (aujourd'hui ao@wise-associates.fr), comme les offres publiées par l'admin. */
export const PLATFORM_TENANT_ID = 'admin'
export const PLATFORM_NAME = 'Wise Associates'

/** Statuts d'abonnement qui ouvrent la lecture des boîtes (décision du 2026-10-21 : tout abonnement actif, essai compris). */
const ENTITLED_STATUSES = new Set(['active', 'trialing'])

/** L'IA est à nos frais : seules les organisations abonnées (et la plateforme) ont leurs boîtes lues. */
export function canUseAoSourcing(tenantId: string, subscriptionStatus: string | null | undefined): boolean {
  return tenantId === PLATFORM_TENANT_ID || ENTITLED_STATUSES.has(subscriptionStatus ?? '')
}

// Identifiants de documents de ao_sync_state : 36 caractères au plus. Un identifiant d'organisation peut en avoir 36 :
// on en garde une empreinte courte.
const tenantKey = (tenantId: string) => createHash('sha1').update(tenantId).digest('hex').slice(0, 16)

/** Verrou de synchronisation d'une organisation : ses boîtes sont lues l'une après l'autre, ses compteurs sans concurrence. */
export function lockIdFor(tenantId: string): string {
  return `lock_${tenantKey(tenantId)}`
}

/**
 * Préfixe de chaque compteur quotidien (un caractère, distinct pour chacun). Tests de connexion des boîtes : par
 * organisation (c), par boîte visée toutes organisations confondues (m), pour toute la plateforme (g). Messages à
 * l'assistant IA (src/lib/assistant/host.ts) : par utilisateur (a), pour toute la plateforme (b).
 */
const COUNTER_PREFIX = { vision: 'v', tables: 't', mailboxTests: 'c', mailboxTarget: 'm', mailboxTestsAll: 'g', assistantUser: 'a', assistantAll: 'b' } as const
export type DailyCounter = keyof typeof COUNTER_PREFIX

/** Compteur quotidien (jour UTC) d'une organisation, ou d'une autre clé (boîte visée, « plateforme ») : 27 caractères. */
export function counterIdFor(counter: DailyCounter, key: string, now: Date): string {
  return `${COUNTER_PREFIX[counter]}_${tenantKey(key)}_${now.toISOString().slice(0, 10).replaceAll('-', '')}`
}

/**
 * Contexte authentifié avec le mot de passe chiffré d'une boîte (credentials.ts, scripts/ao-sources-migrate.mts) : il
 * n'est valable que pour cette boîte, ce serveur et cet identifiant. Changer le serveur ou l'identifiant d'une boîte
 * oblige à ressaisir le mot de passe : il ne peut pas être envoyé à un autre serveur sans être connu.
 */
export function mailboxSecretContext(source: { $id: string; host: string; username: string }): string {
  return `ao_source:${source.$id}|${source.host.trim().toLowerCase()}|${source.username.trim()}`
}
