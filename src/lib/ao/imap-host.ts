import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

// Une organisation choisit le serveur IMAP auquel NOTRE serveur se connecte : sans contrôle, elle pourrait lui faire
// sonder le réseau interne (Appwrite, métadonnées du cloud…). Seul un nom d'hôte dont toutes les adresses sont
// publiques est admis, sur le port 993 (IMAP sur TLS, certificat vérifié). La connexion se fait à l'adresse vérifiée,
// le nom ne servant qu'au certificat (SNI) : un DNS qui répondrait autre chose au moment de se connecter n'y change rien.

export const IMAP_TLS_PORT = 993
const DNS_TIMEOUT_MS = 10_000

// Une liste par famille : une BlockList vérifie aussi une adresse IPv4 contre les règles IPv6 (forme ::ffff:…), et la
// règle ::ffff:0:0/96 les refuserait alors toutes.
const RESERVED_IPV4 = new BlockList()
const RESERVED_IPV6 = new BlockList()
const RESERVED_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
// Les plages qui embarquent une adresse IPv4 (::a.b.c.d, ::ffff:…, NAT64, 6to4) sont refusées en bloc : elles peuvent viser le
// réseau interne. ::/96 couvre aussi :: et ::1.
const RESERVED_V6: [string, number][] = [
  ['::', 96], ['::ffff:0:0', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]
for (const [net, prefix] of RESERVED_V4) RESERVED_IPV4.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of RESERVED_V6) RESERVED_IPV6.addSubnet(net, prefix, 'ipv6')

/** true si `ip` est une adresse IP publique (ni privée, ni locale, ni réservée). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (!family) return false
  return family === 4 ? !RESERVED_IPV4.check(ip, 'ipv4') : !RESERVED_IPV6.check(ip, 'ipv6')
}

/** Erreur affichable telle quelle à l'organisation (paramètres de sa boîte). */
export class ImapHostError extends Error {}

export interface ImapEndpoint {
  /** Adresse vérifiée, à laquelle se connecter. */
  address: string
  /** Nom d'hôte, pour le certificat TLS. */
  servername: string
}

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>
const systemLookup: Lookup = host => dnsLookup(host, { all: true, verbatim: true })

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Adresse à laquelle se connecter pour `host` ; ImapHostError si le nom est invalide, inconnu ou non public. */
export async function resolveImapHost(host: string, lookup: Lookup = systemLookup, timeoutMs = DNS_TIMEOUT_MS): Promise<ImapEndpoint> {
  const name = host.trim().toLowerCase().replace(/\.$/, '')
  if (!HOSTNAME.test(name)) throw new ImapHostError('Serveur IMAP invalide : indiquez un nom d\'hôte, par exemple imap.ionos.fr (sans port ni adresse IP).')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImapHostError(`Le serveur DNS ne répond pas pour ${name} : réessayez plus tard.`)), timeoutMs)
  })
  let addresses: { address: string }[]
  try {
    addresses = await Promise.race([lookup(name), timeout])
  } catch (err) {
    if (err instanceof ImapHostError) throw err
    throw new ImapHostError(`Serveur IMAP introuvable : ${name}.`, { cause: err })
  } finally {
    clearTimeout(timer)
  }
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
    throw new ImapHostError(`Le serveur ${name} n'a pas que des adresses publiques : il ne peut pas être utilisé.`)
  }
  return { address: addresses[0].address, servername: name }
}
