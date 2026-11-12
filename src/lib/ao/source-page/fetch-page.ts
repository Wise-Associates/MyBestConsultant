// Lecture d'une page d'annonce par le serveur (ADR 0031). Le lien vient d'un e-mail : n'importe qui peut écrire à une
// boîte AO et choisir l'adresse que NOTRE serveur ouvrira. Protections, dans l'ordre :
// - adresse : https, port standard, nom de domaine, site non exclu, pas de désinscription (checkPageUrl, rules.ts),
//   revérifiée à chaque redirection (3 au plus) ;
// - réseau : toutes les adresses DNS du nom doivent être publiques et la connexion se fait à l'une d'elles, sans second
//   DNS (publicOnlyLookup) : ni réseau interne, ni métadonnées du cloud, même par une redirection ou un DNS changeant ;
// - robots.txt du site respecté (RFC 9309), lu une fois par site et par passage ;
// - réponse : 200 seulement, page HTML ou texte, 3 Mo au plus (décompressée comprise), délai total borné ;
// - aucun cookie, aucun identifiant envoyés ; page de connexion ignorée.
// Le texte obtenu est une donnée non fiable : l'IA le lit sous une consigne qui le dit (prompt.ts), et seuls les champs
// vides de l'offre sont complétés (fillFromPage).

import { lookup as dnsLookup } from 'node:dns/promises'
import type { IncomingHttpHeaders } from 'node:http'
import { request } from 'node:https'
import type { LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { isPublicAddress } from '../imap-host'
import { charsetOf, decodePage, isLoginPage, MAX_PAGE_TEXT_CHARS, pageTextOf } from './page-text'
import { checkPageUrl, parseRobots, robotsAllows, ROBOTS_AGENT, type RobotsGroup } from './rules'

const USER_AGENT = `Mozilla/5.0 (compatible; ${ROBOTS_AGENT}/1.0)`
// Une page d'annonce moderne embarque souvent ses données en JSON (1 à 2 Mo) : 3 Mo au plus, décompressée.
const MAX_PAGE_BYTES = 3_000_000
const MAX_ROBOTS_BYTES = 200_000
const MAX_REDIRECTS = 3
/** En dessous, la page n'a pas d'annonce lisible (contenu chargé par JavaScript, page vide). */
const MIN_PAGE_TEXT_CHARS = 200
const PAGE_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i

/** robots.txt déjà lu, par site, le temps d'un passage : règles, ou « deny » (site injoignable : RFC 9309, tout interdit). */
export type RobotsCache = Map<string, RobotsGroup[] | 'deny'>

export type PageResult = { ok: true; text: string; finalUrl: string } | { ok: false; reason: string }

type Resolve = (host: string) => Promise<{ address: string; family: number }[]>
const systemResolve: Resolve = host => dnsLookup(host, { all: true, verbatim: true })

/** Erreur de lecture dont le message s'affiche tel quel sur l'offre (« Annonce d'origine non lue : … »). */
class PageError extends Error {}

/**
 * Résolution DNS de la connexion : refusée si une seule adresse du nom n'est pas publique ; sinon la connexion se fait
 * à ces adresses-là (le socket ne refait pas de requête DNS).
 */
export function publicOnlyLookup(resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      addresses => {
        if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
          callback(Object.assign(new Error(`${hostname} n'a pas que des adresses publiques`), { code: 'ENOTPUBLIC' }), '', 0)
        } else if (options.all) {
          callback(null, addresses)
        } else {
          callback(null, addresses[0].address, addresses[0].family)
        }
      },
      (err: NodeJS.ErrnoException) => callback(err, '', 0),
    )
  }
}

/** Contenu d'un flux, refusé au-delà de `maxBytes` (le flux est alors interrompu). */
export async function readBounded(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > maxBytes) {
      stream.destroy()
      throw new PageError(`page trop volumineuse (plus de ${Math.round(maxBytes / 1000)} ko)`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

interface Response {
  status: number
  headers: IncomingHttpHeaders
  /** Corps décompressé (vide pour une redirection ou une erreur). */
  body: Buffer
}

/** Un GET, sans suivre les redirections ; le corps n'est lu que pour une réponse 200. */
function get(url: URL, { signal, maxBytes, accept, lookup }: { signal: AbortSignal; maxBytes: number; accept: string; lookup: LookupFunction }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET',
      lookup,
      signal,
      // Pas d'agent partagé : aucune connexion réutilisée d'une lecture à l'autre.
      agent: false,
      timeout: 10_000,
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' },
    }, res => {
      const status = res.statusCode ?? 0
      if (status !== 200) {
        res.resume()
        resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
        return
      }
      if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
        res.destroy()
        reject(new PageError(`page trop volumineuse (plus de ${Math.round(maxBytes / 1000)} ko)`))
        return
      }
      const encoding = String(res.headers['content-encoding'] ?? 'identity').toLowerCase()
      const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? createGunzip()
        : encoding === 'deflate' ? createInflate()
          : encoding === 'br' ? createBrotliDecompress()
            : encoding === 'identity' ? null : undefined
      if (decoder === undefined) {
        res.destroy()
        reject(new PageError(`encodage de la page inconnu (${encoding})`))
        return
      }
      // Taille bornée après décompression : une petite réponse compressée peut se déplier en gigaoctets.
      const stream = decoder ? res.pipe(decoder) : res
      if (decoder) res.on('error', err => decoder.destroy(err))
      readBounded(stream, maxBytes).then(body => resolve({ status, headers: res.headers, body }), err => {
        res.destroy()
        reject(err)
      })
    })
    req.on('timeout', () => req.destroy(new PageError('le site ne répond pas')))
    req.on('error', reject)
    req.end()
  })
}

/** Lecture interrompue par le délai de CET e-mail : rien n'en est déduit sur le site. */
function isAbort(err: unknown): boolean {
  const name = (err as Error)?.name ?? ''
  return name === 'AbortError' || name === 'TimeoutError' || (err as NodeJS.ErrnoException)?.code === 'ABORT_ERR'
}

/** Message d'une erreur réseau, sans détail technique ni donnée de la page. */
function networkReason(err: unknown): string {
  if (err instanceof PageError) return err.message
  const code = (err as NodeJS.ErrnoException)?.code ?? ''
  if (isAbort(err)) return 'délai dépassé'
  if (code === 'ERR_INVALID_URL') return 'redirection vers une adresse illisible'
  if (code.startsWith('Z_') || code.includes('BROTLI') || code.startsWith('ERR__ERROR')) return 'page compressée illisible'
  if (code === 'ENOTPUBLIC') return 'le site pointe vers une adresse non publique'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'site introuvable'
  if (code.startsWith('ERR_TLS') || code.includes('CERT')) return 'certificat du site invalide'
  return 'connexion au site impossible'
}

const statusReason = (status: number) =>
  status === 401 || status === 403 ? `accès refusé par le site (${status})`
    : status === 404 || status === 410 ? 'annonce introuvable (retirée ?)'
      : status === 429 ? 'le site limite les lectures (429)'
        : `réponse ${status} du site`

/** robots.txt du site de `url` : lu une fois par passage ; 4xx = aucune règle, injoignable ou 5xx = tout interdit (RFC 9309). */
async function robotsFor(url: URL, cache: RobotsCache, signal: AbortSignal, lookup: LookupFunction): Promise<RobotsGroup[] | 'deny'> {
  const known = cache.get(url.host)
  if (known) return known
  let verdict: RobotsGroup[] | 'deny' = 'deny'
  try {
    let target = new URL('/robots.txt', url)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await get(target, { signal, maxBytes: MAX_ROBOTS_BYTES, accept: 'text/plain', lookup })
      const location = res.headers.location
      if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
        const next = checkPageUrl(new URL(location, target).href)
        if (!next.ok) break
        target = next.url
        continue
      }
      if (res.status === 200) verdict = parseRobots(res.body.toString('utf8'))
      else if (res.status >= 400 && res.status < 500) verdict = []
      break
    }
  } catch (err) {
    // Site injoignable : la RFC 9309 le traite comme « tout interdit » (gardé pour le passage). Pas un délai écoulé :
    // il est celui de cet e-mail, et l'e-mail suivant doit pouvoir relire robots.txt. La raison affichée est celle de
    // l'erreur réseau (adresse non publique, site introuvable…), plus parlante.
    if (!isAbort(err)) cache.set(url.host, 'deny')
    throw err
  }
  cache.set(url.host, verdict)
  return verdict
}

/**
 * Texte de l'annonce publiée à `rawUrl`, ou la raison pour laquelle elle n'est pas lue. Ne lève pas : un échec n'arrête
 * jamais le traitement de l'e-mail. `timeoutMs` borne toute la lecture (robots.txt, redirections et page).
 */
export async function fetchSourcePage(rawUrl: string, { robots, timeoutMs, resolve = systemResolve }: { robots: RobotsCache; timeoutMs: number; resolve?: Resolve }): Promise<PageResult> {
  const signal = AbortSignal.timeout(Math.max(timeoutMs, 1000))
  const lookup = publicOnlyLookup(resolve)
  let current = rawUrl
  try {
    for (let hop = 0; ; hop++) {
      const check = checkPageUrl(current)
      if (!check.ok) return { ok: false, reason: check.reason }
      const rules = await robotsFor(check.url, robots, signal, lookup)
      if (rules === 'deny') return { ok: false, reason: 'robots.txt du site illisible : lecture non autorisée' }
      if (!robotsAllows(rules, ROBOTS_AGENT, `${check.url.pathname}${check.url.search}`)) return { ok: false, reason: 'le site refuse cette lecture (robots.txt)' }
      const res = await get(check.url, { signal, maxBytes: MAX_PAGE_BYTES, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', lookup })
      const location = res.headers.location
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) return { ok: false, reason: 'trop de redirections' }
        current = new URL(location, check.url).href
        continue
      }
      if (res.status !== 200) return { ok: false, reason: statusReason(res.status) }
      const contentType = String(res.headers['content-type'] ?? '')
      if (!PAGE_TYPES.test(contentType)) return { ok: false, reason: `pas une page web (${contentType.split(';')[0] || 'type inconnu'})` }
      const page = decodePage(res.body, charsetOf(contentType, res.body.subarray(0, 4096).toString('latin1')))
      const plain = /^text\/plain/i.test(contentType)
      const text = plain ? page.slice(0, MAX_PAGE_TEXT_CHARS) : pageTextOf(page)
      if (!plain && isLoginPage({ html: page, path: check.url.pathname, textLength: text.length })) return { ok: false, reason: 'page de connexion : annonce réservée aux comptes' }
      if (text.trim().length < MIN_PAGE_TEXT_CHARS) return { ok: false, reason: 'page sans texte lisible (chargée par JavaScript ?)' }
      return { ok: true, text, finalUrl: check.url.href }
    }
  } catch (err) {
    return { ok: false, reason: networkReason(err) }
  }
}
