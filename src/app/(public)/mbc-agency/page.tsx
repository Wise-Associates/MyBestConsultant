import Link from 'next/link'
import {
  ArrowRight, Check, ClipboardList, Compass, Handshake, Search, UserCheck, Users,
  type LucideIcon,
} from 'lucide-react'

export const metadata = {
  title: 'MBC Agency — Conseil en recrutement | MyBestConsultant',
  description: 'MBC Agency accompagne les entreprises dans leurs recrutements : définition du besoin, recherche, évaluation et intégration des candidats.',
}

// Page de présentation de MBC Agency, cabinet de conseil en recrutement (demande du 2026-11-16). Contenu provisoire, à
// affiner : il ne cite ni chiffre ni référence client tant qu'ils ne sont pas fournis. Composant serveur, sans données.

const CONTACT_HREF = '/contact?sujet=agence'
const muted = { color: 'var(--color-text-muted)' } as const
/** Orange du thème assombri, pour du texte sur fond clair (l'orange pur y est peu lisible). */
const PRIMARY_INK = 'color-mix(in srgb, var(--color-primary) 62%, black)'
// Tailles écrites ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes.
const H2_STYLE: React.CSSProperties = { color: 'var(--color-text)', fontSize: 'clamp(1.5rem, 3vw, 1.875rem)', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25 }
const H3_STYLE: React.CSSProperties = { color: 'var(--color-text)', fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 }
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2'

const SERVICES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Compass, title: 'Conseil en stratégie de recrutement', text: 'Nous vous aidons à définir le poste, le profil recherché, la rémunération et le calendrier, en tenant compte de la réalité du marché.' },
  { icon: Search, title: 'Recherche et approche directe', text: 'Nous identifions et approchons les candidats, y compris ceux qui ne sont pas en recherche active, au-delà des annonces.' },
  { icon: UserCheck, title: 'Évaluation des candidats', text: 'Entretiens structurés, vérification des compétences et des références : vous ne rencontrez que des profils présélectionnés.' },
  { icon: Users, title: 'Consultants et missions', text: 'Pour un besoin ponctuel ou un projet, nous trouvons des consultants et des indépendants disponibles rapidement.' },
  { icon: ClipboardList, title: 'Organisation de vos recrutements', text: 'Processus, étapes de sélection, grilles d\'évaluation, marque employeur : nous structurons vos recrutements pour qu\'ils durent.' },
  { icon: Handshake, title: 'Accompagnement à l\'intégration', text: 'Nous restons présents après l\'embauche, pour que l\'arrivée du candidat se passe bien, pour lui comme pour vous.' },
]

const EXPERTISE = [
  'Systèmes d\'information, développement et data',
  'Finance et systèmes d\'information financiers',
  'Conseil, transformation et gestion de projet',
  'Fonctions support et métiers de l\'entreprise',
]

const STEPS: { title: string; text: string }[] = [
  { title: 'Cadrage du besoin', text: 'Un échange avec vous pour comprendre le poste, l\'équipe, le contexte et vos critères.' },
  { title: 'Recherche', text: 'Approche directe, réseau et outils de la plateforme MyBestConsultant (vivier de CV, matching par l\'IA).' },
  { title: 'Évaluation', text: 'Entretiens et vérifications ; une présélection courte, argumentée pour chaque candidat.' },
  { title: 'Décision et intégration', text: 'Nous accompagnons les entretiens, l\'offre et les premières semaines du candidat retenu.' },
]

const VALUE: { audience: string; points: string[] }[] = [
  {
    audience: 'Pour les entreprises',
    points: [
      'Un interlocuteur unique, du besoin à l\'intégration',
      'Des candidats présélectionnés et évalués, pas une pile de CV',
      'Du temps gagné pour vos équipes et vos managers',
      'Une démarche adaptée à votre taille et à votre urgence',
    ],
  },
  {
    audience: 'Pour les candidats',
    points: [
      'Des postes et des missions présentés avec transparence',
      'Un accompagnement à chaque étape, avec un retour après chaque entretien',
      'Des conseils pour préparer vos entretiens',
      'Une candidature traitée avec confidentialité',
    ],
  },
]

export default function MbcAgencyPage() {
  return (
    <div style={{ background: 'var(--color-background)' }}>
      {/* ── Bandeau ── */}
      <section style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-12 lg:pt-20 lg:pb-16">
          <p className="text-xs font-bold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--color-primary)' }}>MBC Agency</p>
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: 'clamp(1.9rem, 4vw, 2.75rem)', letterSpacing: '-0.02em', lineHeight: 1.1, maxWidth: 820 }}>
            Le conseil en recrutement, de la définition du besoin à l&apos;intégration
          </h1>
          <p className="mt-4" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1.02rem', maxWidth: 680 }}>
            MBC Agency accompagne les entreprises dans leurs recrutements : nous trouvons, évaluons et vous présentons les
            candidats qui correspondent vraiment à votre besoin.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={CONTACT_HREF}
              className={`h-11 px-5 rounded-xl inline-flex items-center gap-2 text-sm font-semibold no-underline transition-opacity hover:opacity-90 ${focusRing} focus-visible:outline-white`}
              style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}>
              Parler de votre recrutement <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="/jobs"
              className={`h-11 px-5 rounded-xl inline-flex items-center text-sm font-semibold no-underline transition-colors hover:bg-white/10 ${focusRing} focus-visible:outline-white`}
              style={{ color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}>
              Voir les offres
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Services ── */}
        <section aria-labelledby="services-title" className="py-14 lg:py-20">
          <h2 id="services-title" style={H2_STYLE}>Nos services</h2>
          <p className="mt-2 text-[15px] max-w-2xl" style={muted}>
            Un accompagnement complet ou une aide sur une étape précise : vous choisissez ce dont vous avez besoin.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-[20px] p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' }}>
                  <Icon className="h-5 w-5" aria-hidden style={{ color: PRIMARY_INK }} />
                </span>
                <h3 className="mt-4" style={H3_STYLE}>{title}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={muted}>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Expertise ── */}
        <section aria-labelledby="expertise-title" className="py-14 lg:py-20 grid gap-10 lg:grid-cols-2 lg:gap-16" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div>
            <h2 id="expertise-title" style={H2_STYLE}>Notre expertise</h2>
            <p className="mt-4 text-[15px] leading-relaxed" style={muted}>
              MBC Agency est spécialisée dans le recrutement de profils qualifiés, en CDI comme en mission. Nous connaissons
              les métiers que nous recrutons : nous savons lire un parcours, poser les bonnes questions et repérer ce qui fera
              la différence dans votre contexte.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed" style={muted}>
              Nous nous appuyons sur la plateforme MyBestConsultant et ses outils (vivier de CV, matching par
              l&apos;IA, entretiens), et sur une évaluation humaine à chaque étape.
            </p>
          </div>
          <div>
            <h3 style={H3_STYLE}>Nos domaines de recrutement</h3>
            <ul className="mt-4">
              {EXPERTISE.map(item => (
                <li key={item} className="flex items-start gap-3 py-3 text-[15px]" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>
                  <Check className="h-4 w-4 mt-1 shrink-0" aria-hidden style={{ color: PRIMARY_INK }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Démarche ── */}
        <section aria-labelledby="steps-title" className="py-14 lg:py-20" style={{ borderTop: '1px solid var(--color-border)' }}>
          <h2 id="steps-title" style={H2_STYLE}>Notre démarche</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="pt-5" style={{ borderTop: '2px solid var(--color-primary)' }}>
                <span className="text-xs font-bold tracking-[0.18em]" style={{ color: PRIMARY_INK }}>ÉTAPE {i + 1}</span>
                <h3 className="mt-2" style={H3_STYLE}>{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={muted}>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Valeur ajoutée ── */}
        <section aria-labelledby="value-title" className="py-14 lg:py-20" style={{ borderTop: '1px solid var(--color-border)' }}>
          <h2 id="value-title" style={H2_STYLE}>Ce que nous vous apportons</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {VALUE.map(({ audience, points }) => (
              <div key={audience} className="rounded-[20px] p-6 sm:p-8" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <h3 style={H3_STYLE}>{audience}</h3>
                <ul className="mt-4 space-y-3">
                  {points.map(point => (
                    <li key={point} className="flex items-start gap-3 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                      <Check className="h-4 w-4 mt-0.5 shrink-0" aria-hidden style={{ color: PRIMARY_INK }} />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Appel à l'action ── */}
      <section aria-labelledby="cta-title" style={{ background: 'var(--hero-bg)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 lg:py-16 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 id="cta-title" style={{ ...H2_STYLE, color: 'white' }}>Un recrutement à lancer ?</h2>
            <p className="mt-2 text-[15px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Décrivez-nous votre besoin : nous revenons vers vous rapidement.
            </p>
          </div>
          <Link href={CONTACT_HREF}
            className={`h-11 px-5 rounded-xl inline-flex items-center gap-2 self-start md:self-auto text-sm font-semibold no-underline transition-opacity hover:opacity-90 ${focusRing} focus-visible:outline-white`}
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}>
            Nous contacter <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  )
}
