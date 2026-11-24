import { AO_CHANNEL_LABEL } from '@/lib/ao/filters'
import { forwarderOf, senderOf } from '@/lib/ao/offer-index'
import { formatSender } from '@/lib/ao/origin'
import type { AoChannel, AoEmail } from '@/lib/ao/types'
import { formatDateFr } from '@/lib/format-date'
import { siteOfSource } from '@/lib/veille/monitoring'
import { SCRAPER_SITES } from '@/lib/veille/scraper-status'

// Origine d'une offre, affichée sur son détail dans l'espace recruteur (/recruiter/offres/<id>, demande du 2026-11-24 :
// retrouver d'où vient l'offre — tableau Excel joint, boîte ou expéditeur de l'e-mail…). Seule une offre publiée depuis un
// appel d'offres a une origine enregistrée : son e-mail AO (boîte, expéditeur, objet, pièces jointes). Une offre créée sur
// la plateforme (saisie, assistant IA, import de fichier) n'en a pas : `jobs` est à 16/16 attributs. Le scraper
// (Partenaire GC) et la veille n'écrivent qu'à la boîte de la plateforme (sync.ts), dont les offres publiées (organisation
// « admin ») ne s'ouvrent pas dans l'espace recruteur : le canal « scraping » n'est nommé ici que pour ne jamais être
// présenté comme un e-mail. Règles pures, testées dans job-origin.test.ts ; lecture : job-origin-store.ts.

/** Offre publiée depuis un appel d'offres de l'organisation, avec son e-mail d'origine. */
export interface AoJobOrigin {
  kind: 'ao'
  offerId: string
  channel: AoChannel
  /** Source du scraper ou de la veille (en-tête X-Wise-Veille-Source) ; '' si inconnue ou e-mail ordinaire. */
  veilleSource: string
  /** Libellé de la boîte AO de l'organisation qui a reçu l'e-mail. */
  mailbox: string
  email: Pick<AoEmail, 'origin' | 'fromName' | 'fromAddress' | 'subject' | 'receivedAt' | 'attachments'>
}

export type JobOrigin =
  | AoJobOrigin
  /** Publiée depuis un appel d'offres dont l'e-mail n'est plus lisible par l'organisation (purgé après 365 jours, ou offre déplacée). */
  | { kind: 'ao-unavailable' }
  /** Lecture en échec (journalisée). */
  | { kind: 'unreadable' }
  /** Créée sur la plateforme : saisie, assistant IA, import. */
  | { kind: 'platform' }
  /** Offre partagée par la plateforme : son origine (client, expéditeur) reste confidentielle. */
  | { kind: 'shared' }

export interface JobOriginView {
  /** D'où vient l'offre, en une ligne. */
  source: string
  facts: { label: string; value: string }[]
  /** Précision sous la source ; '' sans. */
  note: string
  /** Page de l'appel d'offres d'origine dans l'espace recruteur ; null sans. */
  aoHref: string | null
}

/** Fichiers joints affichés ; au-delà, leur nombre. */
const MAX_ATTACHMENTS = 5

/** Identifiant de l'offre AO d'une offre publiée depuis un appel d'offres (`ao<id>`, publishAoOfferOf) ; null sinon. */
export function aoOfferIdOfJob(jobId: string): string | null {
  return jobId.startsWith('ao') && jobId.length > 2 ? jobId.slice(2) : null
}

/** Page de l'appel d'offres d'origine dans l'espace recruteur. */
export function aoOfferHref(offerId: string): string {
  return `/recruiter/parametres/boites-ao/${offerId}`
}

/** Site du scraper ou de la veille ; un flux RSS des réglages de la veille (non lus ici) garde son identifiant. */
function siteLabel(veilleSource: string): string {
  if (!veilleSource) return 'site non enregistré'
  if (Object.hasOwn(SCRAPER_SITES, veilleSource)) return SCRAPER_SITES[veilleSource as keyof typeof SCRAPER_SITES]
  return siteOfSource(veilleSource, null).label
}

function attachmentsText(names: string[]): string {
  const shown = names.slice(0, MAX_ATTACHMENTS).join(', ')
  const more = names.length - MAX_ATTACHMENTS
  return more > 0 ? `${shown} et ${more} ${more > 1 ? 'autres' : 'autre'}` : shown
}

/** Ce que la carte « Origine de l'offre » affiche. */
export function jobOriginView(origin: JobOrigin): JobOriginView {
  switch (origin.kind) {
    case 'shared':
      return { source: 'Offre partagée par MyBestConsultant', facts: [], note: '', aoHref: null }
    case 'platform':
      return { source: 'Créée sur MyBestConsultant', facts: [], note: 'Saisie, assistant IA ou import : le mode de création n’est pas enregistré.', aoHref: null }
    case 'unreadable':
      return { source: 'Origine illisible : rechargez la page dans quelques instants.', facts: [], note: '', aoHref: null }
    case 'ao-unavailable':
      return { source: 'Appel d’offres', facts: [], note: 'L’e-mail d’origine de cet appel d’offres n’est plus disponible.', aoHref: null }
    case 'ao': {
      const { email } = origin
      const scraping = origin.channel === 'scraping'
      const sender = senderOf(email)
      const facts: { label: string; value: string }[] = []
      const add = (label: string, value: string) => { if (value) facts.push({ label, value }) }
      add('Boîte', origin.mailbox)
      // Scraper et veille envoient depuis une de nos adresses : cet expéditeur technique n'apprend rien.
      if (!scraping) {
        add('Expéditeur', sender.address ? formatSender(sender) : sender.name)
        add('Transféré par', forwarderOf(email))
      }
      add('Objet', email.subject && `« ${email.subject} »`)
      add('Fichiers joints', attachmentsText(email.attachments))
      add('Reçu le', email.receivedAt && !Number.isNaN(Date.parse(email.receivedAt)) ? formatDateFr(email.receivedAt) : '')
      return {
        source: scraping ? `${AO_CHANNEL_LABEL.scraping} · ${siteLabel(origin.veilleSource)}` : 'Appel d’offres reçu par e-mail',
        facts,
        note: '',
        aoHref: aoOfferHref(origin.offerId),
      }
    }
  }
}
