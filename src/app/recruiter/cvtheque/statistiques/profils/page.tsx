import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Mail, Phone, Users } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { takeDailySlot } from '@/lib/ao/state'
import { SENIORITY_LABELS, monthLabel } from '@/lib/search/cv-stats'
import {
  MAX_LISTED, STATS_PROFILES_DAILY_LIMITS, STATS_PROFILES_REFUSAL, pageFromParam, parseSelection, selectionTitle, statProfilesHref,
} from '@/lib/search/cv-stats-selection'
import { loadStatProfiles, type ProfilesScope, type StatProfile } from '@/lib/search/cv-stats-profiles'

// Profils derrière un nombre de « CV Thèque · Statistiques » (demande du 2026-11-19) : la sélection (?champ=&valeur=)
// relue et bornée par parseSelection, le périmètre tiré de la session comme sur la page des statistiques — base
// candidats, ou le vivier du recruteur connecté (?perimetre=vivier), jamais celui d'un collègue. Les plus récents
// d'abord, 50 par page, chaque CV revérifié dans Appwrite (cv-stats-profiles.ts) ; nom, coordonnées et fiche du profil.
// Adresse e-mail vérifiée et quota du jour par page (STATS_PROFILES_DAILY_LIMITS) : l'inscription d'un recruteur est libre.

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const text: CSSProperties = { color: 'var(--color-text)' }
const card: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const number = new Intl.NumberFormat('fr-FR')
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/** Raison de ne pas lister (adresse non vérifiée, quota du jour atteint, quota illisible) ; null : une place est prise. */
async function listDenial(user: { $id: string; tenantId?: string | null; emailVerification?: boolean }, now: Date): Promise<string | null> {
  if (!user.emailVerification) return STATS_PROFILES_REFUSAL.unverified
  try {
    const { perOrganisation, allOrganisations } = STATS_PROFILES_DAILY_LIMITS
    if (!(await takeDailySlot('statsProfilesOrg', user.tenantId || user.$id, now, perOrganisation))) return STATS_PROFILES_REFUSAL.organisation(perOrganisation)
    if (!(await takeDailySlot('statsProfilesAll', 'platform', now, allOrganisations))) return STATS_PROFILES_REFUSAL.platform
    return null
  } catch (err) {
    // Quota illisible : refus (les coordonnées ne sont pas listées sans plafond).
    console.error('[statistiques] quota des pages de profils illisible', err instanceof Error ? err.message : err)
    return 'Liste momentanément indisponible : rechargez la page dans quelques instants.'
  }
}

export default async function StatProfilesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')
  const sp = await searchParams
  const selection = parseSelection({ champ: one(sp.champ), valeur: one(sp.valeur) })
  if (!selection) notFound()
  // Vivier : celui du recruteur connecté (organisation et profil de la session), comme la page des statistiques.
  const vivier = one(sp.perimetre) === 'vivier' && !!user.tenantId
  const scope: ProfilesScope = vivier ? { kind: 'vivier', tenantId: user.tenantId!, ownerId: user.$id } : { kind: 'pool' }
  const page = pageFromParam(one(sp.page))
  const denial = await listDenial(user, new Date())
  const result = denial ? null : await loadStatProfiles(scope, selection, page)
  const perimetre = vivier ? 'vivier' : 'pool'
  // Page au-delà de la dernière (liste raccourcie depuis, adresse modifiée) : la première.
  if (result?.state === 'ok' && page > 1 && page > result.totalPages) redirect(statProfilesHref(perimetre, selection))
  const statsHref = vivier ? '/recruiter/cvtheque/statistiques?perimetre=vivier' : '/recruiter/cvtheque/statistiques'
  const title = selectionTitle(selection)

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-background)' }}>
      <header className="flex items-center gap-3 flex-wrap min-h-16 px-4 sm:px-6 py-3" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <Link href={statsHref} className="inline-flex items-center justify-center h-9 w-9 -ml-1.5 rounded-lg no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-(--color-text)"
          style={muted} aria-label="Retour aux statistiques" title="Retour aux statistiques">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <Users className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        <div className="min-w-0 flex-1">
          {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
          <h1 className="truncate" style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>{title}</h1>
          <p className="text-[12px]" style={muted}>{vivier ? 'Mon vivier' : 'Base candidats'} · CV Thèque · Statistiques</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        {denial && <Notice title="Liste non disponible" alert>{denial}</Notice>}
        {result?.state === 'off' && <Notice title="Liste pas encore disponible">Elle s’affichera dès que l’index de recherche des CV sera activé sur la plateforme.</Notice>}
        {result?.state === 'error' && <Notice title="Liste momentanément indisponible" alert>Rechargez la page dans quelques instants.</Notice>}
        {result?.state === 'ok' && result.total === 0 && (
          <Notice title="Aucun CV pour cette ligne">
            Les CV ont pu changer depuis l’affichage des statistiques. <Link href={statsHref} className="underline" style={text}>Revenir aux statistiques</Link>
          </Notice>
        )}
        {result?.state === 'ok' && result.total > 0 && (
          <>
            <p className="text-[13px]" style={muted}>
              <span className="font-semibold" style={text}>{number.format(result.total)} CV</span>, les plus récents d’abord
              {result.total >= MAX_LISTED && ` ; seuls les ${number.format(MAX_LISTED)} plus récents peuvent être listés`}.
              {result.hidden === 1 && ' 1 CV de cette page n’est pas affiché (supprimé, profil sans fichier de CV, ou en cours de mise à jour).'}
              {result.hidden > 1 && ` ${result.hidden} CV de cette page ne sont pas affichés (supprimés, profils sans fichier de CV, ou en cours de mise à jour).`}
            </p>
            <ul className="flex flex-col gap-3" aria-label={`${title} : profils`}>
              {result.profiles.map(p => <ProfileRow key={`${p.source}-${p.id}`} profile={p} />)}
            </ul>
            <Pagination page={result.page} totalPages={result.totalPages} href={n => statProfilesHref(perimetre, selection, n)} />
          </>
        )}
      </main>
    </div>
  )
}

function Notice({ title, alert, children }: { title: string; alert?: boolean; children: ReactNode }) {
  return (
    <div role={alert ? 'alert' : 'status'} className="rounded-2xl p-5" style={card}>
      <p className="text-sm font-semibold" style={text}>{title}</p>
      <p className="text-[13px] mt-0.5" style={muted}>{children}</p>
    </div>
  )
}

/** Un CV : nom (vers la fiche), métiers, séniorité et ville, compétences, coordonnées. */
function ProfileRow({ profile: p }: { profile: StatProfile }) {
  const profileHref = `/recruiter/candidate-preview/${p.source}/${encodeURIComponent(p.id)}`
  const seniority = SENIORITY_LABELS[p.seniority]?.replace(/ \(.*\)$/, '')
  const meta = [
    p.seniority !== 'non_precise' && seniority,
    p.yearsOfExperience !== null && `${p.yearsOfExperience} an${p.yearsOfExperience > 1 ? 's' : ''} d’expérience`,
    p.city,
    p.dailyRate !== null && `${number.format(p.dailyRate)} €/j`,
    p.cvDate !== null && `déposé en ${monthLabel.format(new Date(p.cvDate * 1000))}`,
  ].filter(Boolean).join(' · ')
  const skills = p.skills.slice(0, 8).join(', ') + (p.skills.length > 8 ? ` +${p.skills.length - 8}` : '')
  return (
    <li className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6" style={card}>
      <div className="min-w-0 flex-1">
        <Link href={profileHref} className="text-[15px] font-semibold no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text) rounded-sm" style={text}>
          {p.name}
        </Link>
        {p.roles.length > 0 && <p className="text-[13px] mt-0.5" style={text}>{p.roles.slice(0, 3).join(' · ')}</p>}
        {meta && <p className="text-[12px] mt-1" style={muted}>{meta}</p>}
        {skills && <p className="text-[12px] mt-1.5" style={muted}>{skills}</p>}
      </div>
      <div className="sm:w-64 shrink-0 flex flex-col gap-1.5 text-[13px] min-w-0">
        {/* Coordonnées en texte, comme sur la fiche : une adresse saisie à l'import n'est jamais un lien. */}
        {p.email && <span className="inline-flex items-center gap-1.5 min-w-0" style={text}><Mail className="h-3.5 w-3.5 shrink-0" style={muted} aria-hidden /><span className="truncate select-all" title={p.email}>{p.email}</span></span>}
        {p.phone && <span className="inline-flex items-center gap-1.5" style={text}><Phone className="h-3.5 w-3.5 shrink-0" style={muted} aria-hidden /><span className="select-all">{p.phone}</span></span>}
        {!p.email && !p.phone && <span style={muted}>Coordonnées non renseignées</span>}
        <Link href={profileHref}
          className="mt-1 inline-flex items-center justify-center h-10 sm:h-9 px-3 rounded-lg text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          Voir le profil
        </Link>
      </div>
    </li>
  )
}

function Pagination({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) {
  if (totalPages <= 1) return null
  const button = 'inline-flex items-center gap-1 h-10 px-3 rounded-lg text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'
  const style: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
  return (
    <nav aria-label="Pages de la liste" className="flex items-center justify-between gap-3 pt-1">
      {page > 1 ? <Link href={href(page - 1)} className={button} style={style}><ChevronLeft className="h-4 w-4" aria-hidden />Précédente</Link> : <span />}
      <span className="text-[13px] tabular-nums" style={muted}>Page {page} sur {totalPages}</span>
      {page < totalPages ? <Link href={href(page + 1)} className={button} style={style}>Suivante<ChevronRight className="h-4 w-4" aria-hidden /></Link> : <span />}
    </nav>
  )
}
