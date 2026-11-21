import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell, Plus } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { formatDateFr } from '@/lib/format-date'
import { ALERT_EMAIL_STATUS_LABEL, ALERT_SOURCE_LABEL } from '@/lib/recruiter-alerts'
import { ALERTS_SHOWN, isRecruiterAlertsConfigured, listRecruiterAlerts, loadAlertEmails, type AlertRow } from '@/lib/recruiter-alerts-store'
import { isSavedSearchesConfigured, listOwnSavedSearches, savedSearchStats } from '@/lib/saved-searches-store'
import { AlertEmailsToggle, AlertThresholdSelect } from './alert-emails-toggle'
import { SavedSearchesList, type SavedSearchRow } from './saved-searches-list'

export const metadata = { title: 'Alertes' }

// Alertes du recruteur : ses recherches enregistrées de la CV Thèque (ADR 0046 : un nouveau candidat qui répond à leurs
// filtres), le réglage des alertes sur ses offres (ADR 0045 et 0047 : candidature, candidat de la base ou nouveau candidat
// proposé par l'IA, noté au moins à son seuil, 70 par défaut), puis l'historique des deux.

/** Recherches du recruteur et leurs chiffres ; null : illisibles (journalisé). Chiffres seuls illisibles : « — ». */
async function loadSavedSearchRows(ownerId: string): Promise<SavedSearchRow[] | null> {
  let searches
  try {
    searches = await listOwnSavedSearches(ownerId)
  } catch (err) {
    console.error('[recherches] liste illisible', err instanceof Error ? err.message : err)
    return null
  }
  try {
    const stats = await savedSearchStats(ownerId, searches, new Date())
    return searches.map(search => ({ search, matching: stats.get(search.id)?.matching ?? 0, newMatches: stats.get(search.id)?.newMatches ?? 0 }))
  } catch (err) {
    console.error('[recherches] chiffres illisibles', err instanceof Error ? err.message : err)
    return searches.map(search => ({ search, matching: null, newMatches: null }))
  }
}

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
const muted = { color: 'var(--color-text-muted)' } as const

export default async function AlertesPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const configured = isRecruiterAlertsConfigured()
  const searchesConfigured = isSavedSearchesConfigured()
  const [emails, alerts, searchRows] = await Promise.all([
    loadAlertEmails(user.userId),
    configured
      ? listRecruiterAlerts(user).catch(err => {
        console.error('[alertes] liste illisible', err instanceof Error ? err.message : err)
        return null
      })
      : Promise.resolve([] as AlertRow[]),
    searchesConfigured ? loadSavedSearchRows(user.$id) : Promise.resolve([] as SavedSearchRow[]),
  ])

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Bell className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>Alertes</h1>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <section id="recherches" className="scroll-mt-24" aria-labelledby="saved-searches">
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <h2 id="saved-searches" className="flex-1" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>
              Recherches enregistrées{searchRows && searchRows.length > 0 ? ` (${searchRows.length})` : ''}
            </h2>
            {searchesConfigured && (
              <Link href="/recruiter/cvtheque" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold no-underline transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Nouvelle recherche
              </Link>
            )}
          </div>
          {!searchesConfigured
            ? <Notice text="Les recherches enregistrées ne sont pas encore activées sur la plateforme." />
            : searchRows === null
              ? <Notice text="Vos recherches n’ont pas pu être lues : rechargez la page dans quelques instants." />
              : <SavedSearchesList rows={searchRows} />}
        </section>

        <section className="rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4" style={surface} aria-labelledby="alert-settings">
          <div className="flex-1 min-w-0">
            <h2 id="alert-settings" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Candidats pour vos offres</h2>
            <p className="text-sm mt-1" style={muted}>
              Chaque candidature reçue sur une offre qui vous est affectée vous est signalée ici et par e-mail, quel que soit son score :
              rien à régler. Le score minimal et l’interrupteur des e-mails ne concernent que les autres alertes : un candidat de la base,
              ou un nouveau candidat que l’IA a proposé pour l’offre dès son inscription, noté au moins à votre score minimal (une seule
              fois par candidat et par offre).
            </p>
            {emails.unreadable && <p className="text-xs mt-2" style={{ color: '#b91c1c' }}>Vos réglages n’ont pas pu être lus : ils sont affichés par défaut.</p>}
          </div>
          <div className="flex flex-col items-start sm:items-end gap-3">
            <AlertThresholdSelect initialThreshold={emails.threshold} />
            <AlertEmailsToggle initialEnabled={emails.enabled} />
          </div>
        </section>

        <section aria-labelledby="alert-list">
          <h2 id="alert-list" className="mb-3" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>
            Dernières alertes{alerts && alerts.length > 0 ? ` (${alerts.length}${alerts.length === ALERTS_SHOWN ? ' les plus récentes' : ''})` : ''}
          </h2>
          {!configured
            ? <Notice text="Les alertes ne sont pas encore activées sur la plateforme." />
            : alerts === null
              ? <Notice text="Vos alertes n’ont pas pu être lues : rechargez la page dans quelques instants." />
              : alerts.length === 0
                ? <Notice text={`Aucune alerte pour le moment. Elles apparaîtront ici dès qu’un candidat postulera à une de vos offres, qu’un nouveau candidat répondra à une de vos recherches, ou sera noté ${emails.threshold}/100 ou plus pour une de vos offres.`} />
                : <AlertList alerts={alerts} />}
        </section>
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <p className="rounded-2xl p-5 text-sm" style={{ ...surface, ...muted }}>{text}</p>
}

function AlertList({ alerts }: { alerts: AlertRow[] }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={surface}>
      <div className="hidden lg:grid grid-cols-[7rem_minmax(0,1.2fr)_minmax(0,1.5fr)_8rem_4.5rem_9rem_8rem] gap-4 px-5 py-2.5 text-xs font-medium" style={{ ...muted, borderBottom: '1px solid var(--color-border)' }}>
        <span>Date</span><span>Candidat</span><span>Offre ou recherche</span><span>Source</span><span>Score</span><span>E-mail</span><span className="sr-only">Actions</span>
      </div>
      <ul>
        {alerts.map((alert, i) => (
          <li
            key={alert.id}
            className="grid gap-1.5 lg:gap-4 px-5 py-3.5 text-sm lg:items-center lg:grid-cols-[7rem_minmax(0,1.2fr)_minmax(0,1.5fr)_8rem_4.5rem_9rem_8rem]"
            style={i > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
          >
            <span className="text-xs lg:text-sm" style={muted}>{formatDateFr(alert.createdAt)}</span>
            <span className="font-medium truncate" style={{ color: alert.candidateName ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
              {alert.candidateName ?? 'Profil supprimé'}
            </span>
            {alert.source === 'recherche' ? (
              <span className="truncate" style={{ color: alert.searchName ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {alert.searchName ?? 'Recherche supprimée'}
              </span>
            ) : (
              <span className="truncate" style={{ color: alert.jobTitle ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {alert.jobTitle ?? (alert.jobGone ? 'Offre supprimée' : 'Offre non accessible')}
              </span>
            )}
            <span className="text-xs lg:text-sm" style={muted}>{ALERT_SOURCE_LABEL[alert.source]}</span>
            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{alert.score === null ? '—' : `${alert.score}/100`}</span>
            <span className="text-xs lg:text-sm" style={muted}>{ALERT_EMAIL_STATUS_LABEL[alert.emailStatus]}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 lg:justify-end">
              {alert.profileHref && (
                <Link href={alert.profileHref} className="text-sm font-medium no-underline hover:underline" style={{ color: 'var(--color-brand-orange)' }}>
                  Voir le profil
                </Link>
              )}
              {alert.jobTitle && alert.source !== 'vivier' && alert.source !== 'recherche' && (
                <Link href={alert.matchingHref} className="text-sm no-underline hover:underline" style={muted}>Matching IA</Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
