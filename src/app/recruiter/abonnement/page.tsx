import { redirect } from 'next/navigation'
import { Query } from 'node-appwrite'
import { ArrowRight, CreditCard, ShieldCheck } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { isAdminHold } from '@/lib/billing'
import { formatDateFr } from '@/lib/format-date'
import { offerPriceText, offerState, type PlanOffer } from '@/lib/plan-offers'
import { isPlanOffersConfigured, loadOffer } from '@/lib/plan-offers-store'
import { DAILY_QUOTAS, DAILY_QUOTA_LABEL, FEATURES, FEATURE_LABEL } from '@/lib/plans'
import { subscriptionView, type SubscriptionTone } from '@/lib/subscription-view'
import { canManageTeam, roleOf } from '@/lib/team-roles'
import { BillingPortalButton } from './billing-portal-button'
import { CustomOfferCard, type CustomOfferView } from './custom-offer-card'
import { PlanChoice } from './plan-choice'

export const metadata = { title: 'Abonnement' }

// Abonnement de l'organisation (ADR 0033, 0034) : formule, état, montant, depuis quand ; offre sur mesure ; choix et
// paiement d'une formule (section « Formules ») pour le propriétaire et les administrateurs ; factures, moyen de
// paiement et résiliation dans le portail Stripe pour le propriétaire seul. Les notes de l'admin (`subscriptionNotes`)
// ne sont pas montrées.

const TONE: Record<SubscriptionTone, { background: string; color: string }> = {
  ok: { background: 'rgba(16,185,129,0.1)', color: '#047857' },
  warn: { background: 'rgba(245,158,11,0.12)', color: '#b45309' },
  error: { background: 'rgba(239,68,68,0.08)', color: '#b91c1c' },
  muted: { background: 'var(--color-background)', color: 'var(--color-text-muted)' },
}

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const

/** Offre sur mesure à montrer (ADR 0034) ; null si aucune ou retirée. */
function offerView(offer: PlanOffer | null, tenantPlan: unknown, now: Date): CustomOfferView | null {
  if (!offer) return null
  const state = offerState(offer, now)
  if (state === 'withdrawn') return null
  const { terms } = offer
  return {
    name: offer.name,
    priceText: offerPriceText(offer),
    paymentMethod: offer.paymentMethod,
    paymentText: offer.paymentMethod === 'card' ? 'Carte bancaire' : `Facture Stripe, à régler sous ${offer.daysUntilDue} jours`,
    state: state === 'accepted' ? (tenantPlan === 'custom' ? 'active' : 'unpaid') : state,
    validUntil: formatDateFr(offer.validUntil),
    acceptedAt: offer.acceptedAt ? formatDateFr(offer.acceptedAt) : null,
    limits: [
      `${terms.maxUsers} utilisateurs`,
      terms.maxActiveJobs === null ? 'Offres actives sans limite' : `${terms.maxActiveJobs} ${terms.maxActiveJobs > 1 ? 'offres actives' : 'offre active'} à la fois`,
    ],
    features: FEATURES.map(f => ({ label: FEATURE_LABEL[f], included: terms.features[f] })),
    quotas: DAILY_QUOTAS.map(q => ({ label: DAILY_QUOTA_LABEL[q], value: terms.dailyQuotas[q] })),
  }
}

export default async function SubscriptionPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>
  const ownerId = typeof tenant.recruiterId === 'string' ? tenant.recruiterId : ''
  // Nom du propriétaire : facultatif, la page s'affiche sans.
  const owner = ownerId
    ? await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', ownerId), Query.limit(1)])
      .then(r => r.documents[0])
      .catch(err => { console.error('[abonnement] propriétaire illisible', err instanceof Error ? err.message : String(err)); return undefined })
    : undefined
  const ownerName = owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() : ''
  // Offre sur mesure : illisible, la page s'affiche avec un message.
  let offer: PlanOffer | null = null
  let offerError = ''
  if (isPlanOffersConfigured()) {
    try {
      offer = await loadOffer(user.tenantId)
    } catch (err) {
      console.error('[abonnement] offre sur mesure illisible', err instanceof Error ? err.message : String(err))
      offerError = 'Votre offre sur mesure est momentanément illisible : rechargez la page dans quelques instants.'
    }
  }
  const customOffer = offerView(offer, tenant.plan, new Date())
  const currentPlan = typeof tenant.plan === 'string' && tenant.plan ? tenant.plan : null
  // Changement de formule refusé d'avance (le serveur le revérifie) : organisation suspendue par l'admin, ou contrat sur
  // mesure en cours (ses conditions et son mode de paiement se changent avec l'équipe).
  const planBlocked = isAdminHold(tenant.subscriptionStatus)
    ? 'L’abonnement de votre organisation est suspendu : contactez-nous pour le rétablir.'
    : currentPlan === 'custom' ? 'Votre offre sur mesure est en cours : contactez-nous pour changer de formule.' : null

  const role = roleOf(user.userId, tenant)
  const view = subscriptionView(tenant)
  const startedAt = typeof tenant.subscriptionStartedAt === 'string' && tenant.subscriptionStartedAt ? formatDateFr(tenant.subscriptionStartedAt) : null

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <CreditCard className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>Abonnement</h1>
      </header>

      {/* Deux cartes côte à côte dès 1024 px, centrées : la page ne laisse plus la moitié droite vide. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid gap-5 lg:grid-cols-2 items-start">
        {offerError && <p role="alert" className="text-sm lg:col-span-2" style={{ color: '#b91c1c' }}>{offerError}</p>}
        {customOffer && <CustomOfferCard offer={customOffer} canAccept={canManageTeam(role)} />}
        <section className="rounded-2xl p-5 sm:p-6 space-y-5" style={surface} aria-labelledby="sub-plan">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Formule</p>
              <h2 id="sub-plan" style={{ color: 'var(--color-text)', fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3 }}>{view.planLabel}</h2>
              {view.amountText && <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>{view.amountText}</p>}
            </div>
            <span className="inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full" style={TONE[view.tone]}>{view.statusLabel}</span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Depuis le</dt>
              <dd style={{ color: 'var(--color-text)' }}>{startedAt ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Paiement</dt>
              <dd style={{ color: 'var(--color-text)' }}>
                {!view.billedByStripe ? 'Réglé avec l’équipe MyBestConsultant'
                  : tenant.plan === 'custom' && offer?.paymentMethod === 'invoice' ? 'Facture Stripe (virement)' : 'Carte bancaire (Stripe)'}
              </dd>
            </div>
          </dl>
          <p className="flex items-start gap-2 text-sm rounded-xl p-3" style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}>
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            {view.entitled
              ? 'Les fonctions réservées aux abonnés sont ouvertes : MBC Search, lecture des boîtes d’appels d’offres, recherche de candidats et rédaction par l’IA, export des CV au format cabinet.'
              : 'Les fonctions réservées aux abonnés sont fermées (MBC Search, lecture des boîtes d’appels d’offres, recherche de candidats et rédaction par l’IA, export des CV au format cabinet) : choisissez une formule pour les rouvrir.'}
          </p>
        </section>

        <section className="rounded-2xl p-5 sm:p-6 space-y-4" style={surface} aria-labelledby="sub-manage">
          <h2 id="sub-manage" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Gérer l’abonnement</h2>
          {canManageTeam(role) ? (
            <a href="#formules" className="inline-flex items-center gap-1.5 text-sm font-semibold no-underline hover:underline" style={{ color: 'var(--color-brand-orange)' }}>
              Changer de formule <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Le propriétaire et les administrateurs de l’organisation peuvent changer de formule.</p>
          )}
          {role === 'owner' ? (
            view.billedByStripe
              ? <BillingPortalButton />
              : <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun paiement par carte enregistré : votre abonnement est géré par l’équipe MyBestConsultant. Contactez le support pour vos factures ou pour le modifier.</p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Factures, moyen de paiement et résiliation : réservés au propriétaire de l’organisation{ownerName ? ` (${ownerName})` : ''}.
            </p>
          )}
        </section>

        <PlanChoice currentPlan={currentPlan} canChoose={canManageTeam(role)} blockedReason={planBlocked} hasCustomOffer={!!customOffer} />
      </div>
    </div>
  )
}
