import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Query } from 'node-appwrite'
import { ArrowRight, Building2, ExternalLink } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { formatDateFr } from '@/lib/format-date'
import { subscriptionView } from '@/lib/subscription-view'
import { MAX_TEAM_SIZE } from '@/lib/team'
import { TEAM_ROLE_LABEL, canManageTeam, roleOf } from '@/lib/team-roles'
import { OrganisationForm } from './organisation-form'

export const metadata = { title: 'Organisation' }

// Organisation du recruteur (ADR 0033) : identité, propriétaire, utilisateurs, formule ; nom et logo modifiables par
// le propriétaire et les administrateurs. Le slug ne change pas (page publique /entreprises/<slug>).

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const

export default async function OrganisationPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>
  const ownerId = typeof tenant.recruiterId === 'string' ? tenant.recruiterId : ''
  // Propriétaire et nombre d'utilisateurs : facultatifs, la page s'affiche sans.
  const [owner, team] = await Promise.all([
    ownerId
      ? databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', ownerId), Query.limit(1)]).then(r => r.documents[0])
        .catch(err => { console.error('[organisation] propriétaire illisible', err instanceof Error ? err.message : String(err)); return undefined })
      : undefined,
    databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('tenantId', user.tenantId), Query.equal('role', 'recruiter'), Query.limit(1)]).then(r => r.total)
      .catch(err => { console.error('[organisation] équipe illisible', err instanceof Error ? err.message : String(err)); return null }),
  ])

  const name = typeof tenant.name === 'string' ? tenant.name : ''
  const logoUrl = typeof tenant.logoUrl === 'string' ? tenant.logoUrl : ''
  const slug = typeof tenant.slug === 'string' ? tenant.slug : ''
  const role = roleOf(user.userId, tenant)
  const sub = subscriptionView(tenant)
  const ownerName = owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || (owner.email as string) : '—'
  const createdAt = typeof tenant.$createdAt === 'string' ? formatDateFr(tenant.$createdAt) : '—'

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Building2 className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>Organisation</h1>
      </header>

      {/* Deux cartes côte à côte dès 1024 px, centrées : la page ne laisse plus la moitié droite vide. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid gap-5 lg:grid-cols-2 items-start">
        <section className="rounded-2xl p-5 sm:p-6" style={surface} aria-labelledby="org-identity">
          <div className="flex items-center gap-4 mb-5">
            <span className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={surface}>
              {logoUrl
                // Logo du bucket de la plateforme : <img> simple, sans l'optimiseur de Next.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoUrl} alt="" className="w-full h-full object-contain" />
                : <span className="text-xl font-bold" style={{ color: 'var(--color-text-muted)' }}>{name.charAt(0).toUpperCase() || '?'}</span>}
            </span>
            <div className="min-w-0">
              <h2 id="org-identity" className="truncate" style={{ color: 'var(--color-text)', fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 }}>{name || 'Organisation sans nom'}</h2>
              {slug && (
                tenant.brandPublished === true
                  ? <Link href={`/entreprises/${slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: 'var(--color-brand-orange)' }}>
                      Page publique /entreprises/{slug} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  : <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Page publique non publiée (<Link href="/recruiter/marque-employeur" className="underline">marque employeur</Link>)</p>
              )}
            </div>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{TEAM_ROLE_LABEL.owner}</dt>
              <dd style={{ color: 'var(--color-text)' }}>{ownerName}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Créée le</dt>
              <dd style={{ color: 'var(--color-text)' }}>{createdAt}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Utilisateurs</dt>
              <dd><Link href="/recruiter/utilisateurs" className="inline-flex items-center gap-1 no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                {team === null ? 'Voir les utilisateurs' : `${team} / ${MAX_TEAM_SIZE}`} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Formule</dt>
              <dd><Link href="/recruiter/abonnement" className="inline-flex items-center gap-1 no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                {sub.planLabel} · {sub.statusLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Votre rôle</dt>
              <dd style={{ color: 'var(--color-text)' }}>{TEAM_ROLE_LABEL[role]}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl p-5 sm:p-6" style={surface} aria-labelledby="org-edit">
          <h2 id="org-edit" className="mb-1" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Nom et logo</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
            Affichés sur vos offres et votre page marque employeur. L’adresse de la page publique ne change pas.
          </p>
          {canManageTeam(role)
            ? <OrganisationForm initialName={name} initialLogoUrl={logoUrl} />
            : <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Seuls le propriétaire et les administrateurs de l’organisation peuvent modifier le nom et le logo.</p>}
        </section>
      </div>
    </div>
  )
}
