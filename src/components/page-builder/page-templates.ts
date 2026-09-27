import type { PageSection } from '@/app/admin/pages/types'

export interface PageTemplate {
  id: string
  name: string
  desc: string
  style: string
  accent: string
  dark: boolean
  sections: PageSection[]
}

export const PAGE_TEMPLATES: PageTemplate[] = [

  // ── 1. SAAS MODERN ────────────────────────────────────────────────
  {
    id: 'saas-modern',
    name: 'SaaS Modern',
    desc: 'Aurora animé · Stats · Cards · CTA',
    style: '#030014',
    accent: '#6366f1',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'aurora',
        title: 'La plateforme qui transforme votre recrutement',
        subtitle: "Connectez les meilleurs talents aux entreprises qui les méritent grâce à l'intelligence artificielle.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Démarrer gratuitement', ctaHref: '/register',
        ctaSecondaryLabel: 'Voir la démo →', ctaSecondaryHref: '#demo',
        align: 'center', bgColor: '', sectionHeight: '620px',
      },
      {
        type: 'stats', title: 'Ils nous font confiance', style: 'dark',
        items: [
          { value: '12 000+', label: 'Consultants', description: 'Inscrits sur la plateforme' },
          { value: '850+', label: 'Entreprises', description: 'Clientes actives' },
          { value: '98%', label: 'Satisfaction', description: 'Score NPS moyen' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cards', title: 'Tout ce dont vous avez besoin',
        subtitle: 'Une suite complète pour les équipes RH modernes.',
        columns: 3,
        cards: [
          { icon: '🤖', title: 'Matching IA', body: 'Algorithme qui analyse 200+ critères pour un matching parfait entre candidat et poste.', href: '#' },
          { icon: '⚡', title: 'Recrutement rapide', body: 'Réduisez votre time-to-hire de 60% grâce à nos workflows automatisés.', href: '#' },
          { icon: '📊', title: 'Analytics avancés', body: 'Tableaux de bord temps réel pour piloter votre performance RH.', href: '#' },
          { icon: '🔒', title: 'Sécurité maximale', body: 'Données chiffrées, conformité RGPD et ISO 27001 garantie.', href: '#' },
          { icon: '🌍', title: 'Multi-pays', body: 'Recrutez partout en Europe avec une seule plateforme unifiée.', href: '#' },
          { icon: '🤝', title: 'Support dédié', body: 'Un expert RH à vos côtés pour vous accompagner à chaque étape.', href: '#' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'image_text',
        title: 'Une IA qui comprend vos besoins métier',
        content: "Notre moteur d'intelligence artificielle analyse en profondeur chaque profil pour vous proposer uniquement les candidats qui correspondent réellement à vos exigences techniques et culturelles.",
        imageUrl: '', imageAlt: 'IA matching', imageObjectFit: 'cover', imageObjectPosition: 'center',
        imagePosition: 'right', ctaLabel: 'En savoir plus', ctaHref: '#',
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cta',
        title: 'Prêt à recruter autrement ?',
        subtitle: 'Rejoignez 850 entreprises qui font confiance à MyBestConsultant.',
        buttonLabel: 'Créer un compte gratuit', buttonHref: '/register',
        buttonSecondaryLabel: 'Contacter un expert', buttonSecondaryHref: '/contact',
        style: 'primary', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 2. CONSULTING PREMIUM ─────────────────────────────────────────
  {
    id: 'consulting-premium',
    name: 'Consulting Premium',
    desc: 'Minimal élégant · Navy & Gold · Prestige',
    style: '#FAFBFF',
    accent: '#E8A33D',
    dark: false,
    sections: [
      {
        type: 'hero', variant: 'minimal',
        title: 'Excellence & Expertise au service de votre croissance',
        subtitle: "Cabinet de conseil en recrutement spécialisé dans les profils d'exception. Discrétion, performance, résultats.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Nos services', ctaHref: '#services',
        ctaSecondaryLabel: 'Prendre rendez-vous', ctaSecondaryHref: '/contact',
        align: 'left', bgColor: '', sectionHeight: '560px',
      },
      {
        type: 'text', title: 'Notre approche',
        content: "Nous croyons que le recrutement de cadres dirigeants et d'experts nécessite une approche sur-mesure. Notre équipe de consultants seniors s'engage personnellement dans chaque mission, avec un niveau d'exigence qui correspond à celui de nos clients.",
        align: 'center', maxWidth: 'narrow', bgColor: '', sectionHeight: '',
      },
      {
        type: 'stats', title: '20 ans d\'expertise', style: 'light',
        items: [
          { value: '500+', label: 'Missions réussies', description: 'En France et à l\'international' },
          { value: '95%', label: 'Rétention à 2 ans', description: 'De nos placements cadres' },
          { value: '48h', label: 'Premier contact', description: 'Avec des profils qualifiés' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'image_text', title: 'Des experts qui vous ressemblent',
        content: "Nos consultants viennent tous du monde de l'entreprise. Ils connaissent vos enjeux, parlent votre langage et comprennent les spécificités de votre secteur. Cette proximité est notre force.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        imagePosition: 'left', ctaLabel: 'Notre équipe', ctaHref: '#equipe',
        bgColor: 'var(--color-secondary)', sectionHeight: '',
      },
      {
        type: 'cta', title: 'Parlons de votre prochain recrutement',
        subtitle: 'Un échange confidentiel de 30 minutes pour explorer ensemble vos besoins.',
        buttonLabel: 'Prendre rendez-vous', buttonHref: '/contact',
        buttonSecondaryLabel: '', buttonSecondaryHref: '',
        style: 'dark', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 3. AGENCY BOLD ────────────────────────────────────────────────
  {
    id: 'agency-bold',
    name: 'Agency Bold',
    desc: 'Retro Grid · Cards 4col · Galerie · Impact',
    style: '#020209',
    accent: '#E8A33D',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'retro-grid',
        title: 'Nous recrutons les bâtisseurs de demain',
        subtitle: 'Agence de recrutement tech & digital. Profils rares, délais courts, exigence maximale.',
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Voir nos missions', ctaHref: '/jobs',
        ctaSecondaryLabel: 'Déposer un brief', ctaSecondaryHref: '/contact',
        align: 'center', bgColor: '', sectionHeight: '700px',
      },
      {
        type: 'cards', title: 'Nos domaines d\'expertise',
        subtitle: 'Nous recrutons dans les secteurs les plus exigeants.',
        columns: 4,
        cards: [
          { icon: '💻', title: 'Tech & Dev', body: 'Ingénieurs, architectes, CTOs.', href: '#' },
          { icon: '🎨', title: 'Design & UX', body: 'Product designers, UX leads.', href: '#' },
          { icon: '📈', title: 'Data & IA', body: 'Scientists, ML engineers.', href: '#' },
          { icon: '🚀', title: 'Product', body: 'CPOs, PMs, Product Owners.', href: '#' },
        ],
        bgColor: '#1C1C1E', sectionHeight: '',
      },
      {
        type: 'image_gallery', title: 'Nos dernières missions',
        subtitle: 'Une sélection de placements dont nous sommes fiers.',
        layout: 'grid', columns: 3,
        items: [
          { url: '', alt: 'Mission 1', caption: 'CTO · Scale-up Paris', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Mission 2', caption: 'Lead Designer · Fintech', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Mission 3', caption: 'Head of Data · Licorne', href: '#', objectPosition: 'center' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cta', title: 'Un profil rare à trouver ?',
        subtitle: "Notre réseau de 12 000 experts est activé en moins de 48h.",
        buttonLabel: 'Soumettre un brief', buttonHref: '/contact',
        buttonSecondaryLabel: 'Voir les profils dispo', buttonSecondaryHref: '/candidates',
        style: 'dark', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 4. STARTUP DARK ───────────────────────────────────────────────
  {
    id: 'startup-dark',
    name: 'Startup Dark',
    desc: 'Beams animés · Sombre · Énergie startup',
    style: '#030712',
    accent: '#6366f1',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'beams',
        title: 'Recrutez plus vite. Recrutez mieux.',
        subtitle: "La plateforme d'hiring conçue pour les startups en hypercroissance. Scalable, rapide, efficace.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Essai gratuit 14 jours', ctaHref: '/register',
        ctaSecondaryLabel: 'Comment ça marche ?', ctaSecondaryHref: '#how',
        align: 'center', bgColor: '', sectionHeight: '580px',
      },
      {
        type: 'stats', title: "L'impact en chiffres", style: 'dark',
        items: [
          { value: '3x', label: 'Plus rapide', description: 'Que le recrutement traditionnel' },
          { value: '-60%', label: 'Coût par hire', description: 'Vs. cabinet de recrutement' },
          { value: '4.9/5', label: 'Satisfaction', description: 'Note des équipes RH' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cards', title: 'Tout ce qui compte pour une startup',
        subtitle: '', columns: 3,
        cards: [
          { icon: '🎯', title: 'Job boards intégrés', body: 'Publiez sur 50+ plateformes en un clic depuis votre dashboard.', href: '#' },
          { icon: '🤖', title: 'Screening automatique', body: "L'IA pré-qualifie les CVs et vous envoie uniquement les top profils.", href: '#' },
          { icon: '📅', title: 'Agenda synchronisé', body: 'Planifiez vos entretiens sans friction, directement dans la plateforme.', href: '#' },
        ],
        bgColor: '#080A10', sectionHeight: '',
      },
      {
        type: 'cta', title: 'Lancez-vous en 5 minutes',
        subtitle: "Pas de CB requise. Annulez à tout moment.",
        buttonLabel: 'Démarrer gratuitement', buttonHref: '/register',
        buttonSecondaryLabel: '', buttonSecondaryHref: '',
        style: 'primary', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 5. CORPORATE CLASSIC ──────────────────────────────────────────
  {
    id: 'corporate-classic',
    name: 'Corporate Classic',
    desc: 'Navy classique · Rassurant · Institutionnel',
    style: '#2C2C2E',
    accent: '#E8A33D',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'default',
        title: 'Votre partenaire recrutement de confiance depuis 2005',
        subtitle: "Un cabinet humain, rigoureux et engagé. Nous vous accompagnons à chaque étape de vos recrutements stratégiques.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Nos offres', ctaHref: '/jobs',
        ctaSecondaryLabel: 'Nous contacter', ctaSecondaryHref: '/contact',
        align: 'left', bgColor: '', sectionHeight: '520px',
      },
      {
        type: 'text', title: 'Une méthode éprouvée',
        content: "Depuis 20 ans, nous accompagnons les directions des ressources humaines dans leurs recrutements les plus stratégiques. Notre approche rigoureuse combine expertise sectorielle et technologies modernes pour des résultats durables.",
        align: 'center', maxWidth: 'normal', bgColor: 'var(--color-secondary)', sectionHeight: '',
      },
      {
        type: 'cards', title: 'Nos services', subtitle: '', columns: 2,
        cards: [
          { icon: '👔', title: 'Recrutement cadres', body: "Identifiction et approche directe de profils confirmés pour vos postes de direction.", href: '#' },
          { icon: '🎓', title: 'Recrutement jeunes talents', body: "Programmes de détection et d'intégration des meilleurs profils juniors.", href: '#' },
          { icon: '🌐', title: 'Recrutement international', body: "Missions transfrontalières avec une expertise locale dans 15 pays.", href: '#' },
          { icon: '📋', title: 'Conseil RH', body: "Audit, structuration et optimisation de vos processus de recrutement.", href: '#' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'stats', title: 'Notre bilan', style: 'light',
        items: [
          { value: '2 000+', label: 'Missions', description: 'Réalisées avec succès' },
          { value: '400+', label: 'Clients', description: 'Fidèles depuis + de 5 ans' },
          { value: '15', label: 'Pays', description: "Couverts par notre réseau" },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cta', title: 'Construisons ensemble votre équipe idéale',
        subtitle: 'Un premier échange pour comprendre vos enjeux — sans engagement.',
        buttonLabel: 'Prendre contact', buttonHref: '/contact',
        buttonSecondaryLabel: 'Voir nos références', buttonSecondaryHref: '#references',
        style: 'light', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 6. PORTFOLIO CREATIVE ─────────────────────────────────────────
  {
    id: 'portfolio-creative',
    name: 'Portfolio Créatif',
    desc: 'Glassmorphism · Galerie masonry · Artistique',
    style: '#08021A',
    accent: '#6366f1',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'glass',
        title: 'Nous créons des équipes extraordinaires',
        subtitle: "Chaque recrutement est une œuvre. Nous mettons notre créativité au service de votre performance.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Découvrir nos travaux', ctaHref: '#galerie',
        ctaSecondaryLabel: 'Travailler avec nous', ctaSecondaryHref: '/contact',
        align: 'center', bgColor: '', sectionHeight: '640px',
      },
      {
        type: 'image_gallery', title: 'Nos réalisations',
        subtitle: 'Des placements qui ont marqué des entreprises.',
        layout: 'masonry', columns: 3,
        items: [
          { url: '', alt: 'Réalisation 1', caption: 'Direction Artistique · Agence', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Réalisation 2', caption: 'UX Director · Tech', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Réalisation 3', caption: 'Brand Manager · Retail', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Réalisation 4', caption: 'Creative Director · Mode', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Réalisation 5', caption: 'CDO · Média', href: '#', objectPosition: 'center' },
          { url: '', alt: 'Réalisation 6', caption: 'Head of Design · Startup', href: '#', objectPosition: 'center' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'text', title: 'Notre philosophie',
        content: "Le recrutement créatif ne s'improvise pas. Il demande une compréhension profonde des cultures d'entreprise, des sensibilités artistiques et des ambitions individuelles. C'est ce savoir-faire unique que nous apportons à chaque mission.",
        align: 'center', maxWidth: 'narrow', bgColor: '#08021A', sectionHeight: '',
      },
      {
        type: 'cta', title: "Commençons votre prochain grand projet",
        subtitle: '',
        buttonLabel: 'Échangeons', buttonHref: '/contact',
        buttonSecondaryLabel: '', buttonSecondaryHref: '',
        style: 'dark', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 7. PRODUCT LAUNCH ─────────────────────────────────────────────
  {
    id: 'product-launch',
    name: 'Product Launch',
    desc: 'Spotlight · Split content · Lancement produit',
    style: '#050A14',
    accent: '#6366f1',
    dark: true,
    sections: [
      {
        type: 'hero', variant: 'spotlight',
        title: 'Introducing MyBestConsultant 2.0',
        subtitle: "Le recrutement réinventé par l'IA. Disponible maintenant pour les équipes RH ambitieuses.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Accès anticipé', ctaHref: '/register',
        ctaSecondaryLabel: 'Lire les nouveautés', ctaSecondaryHref: '#features',
        align: 'center', bgColor: '', sectionHeight: '620px',
      },
      {
        type: 'stats', title: "La nouvelle version en chiffres", style: 'dark',
        items: [
          { value: '200+', label: 'Nouvelles fonctions', description: 'Disponibles au lancement' },
          { value: '10x', label: 'Plus rapide', description: "Que la version précédente" },
          { value: '0€', label: "Migration", description: 'Pour les clients existants' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'image_text', title: 'IA de matching nouvelle génération',
        content: "Notre moteur IA analyse en temps réel chaque offre et profil pour un matching d'une précision inégalée. Fini les CVs qui ne correspondent pas.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        imagePosition: 'right', ctaLabel: 'Voir la démo', ctaHref: '#demo',
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'image_text', title: 'Dashboard repensé de A à Z',
        content: "Interface épurée, navigation intuitive, tableaux de bord personnalisables. Tout a été repensé pour que vous puissiez vous concentrer sur l'essentiel : recruter.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        imagePosition: 'left', ctaLabel: "Explorer l'interface", ctaHref: '#ui',
        bgColor: 'var(--color-secondary)', sectionHeight: '',
      },
      {
        type: 'cta', title: "Soyez parmi les premiers",
        subtitle: 'Accès anticipé limité à 500 entreprises. Inscrivez-vous maintenant.',
        buttonLabel: "Rejoindre la liste d'attente", buttonHref: '/register',
        buttonSecondaryLabel: 'En savoir plus', buttonSecondaryHref: '#',
        style: 'primary', bgColor: '', sectionHeight: '',
      },
    ],
  },

  // ── 8. MINIMAL PRO ────────────────────────────────────────────────
  {
    id: 'minimal-pro',
    name: 'Minimal Pro',
    desc: 'Blanc pur · Typographie · Consulting grade',
    style: '#FAFBFF',
    accent: '#E8A33D',
    dark: false,
    sections: [
      {
        type: 'hero', variant: 'minimal',
        title: 'Le recrutement, simplement.',
        subtitle: "Pas de superflu. Juste des résultats. Candidats exceptionnels, délais respectés, clients satisfaits.",
        imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
        ctaLabel: 'Voir les offres', ctaHref: '/jobs',
        ctaSecondaryLabel: 'Contact', ctaSecondaryHref: '/contact',
        align: 'center', bgColor: '', sectionHeight: '500px',
      },
      {
        type: 'text', title: 'Ce que nous faisons',
        content: "Nous mettons en relation les entreprises exigeantes avec des candidats d'exception. Rien de plus, rien de moins. Notre réputation repose sur des résultats mesurables et une relation de confiance durable.",
        align: 'center', maxWidth: 'narrow', bgColor: '', sectionHeight: '',
      },
      {
        type: 'stats', title: '', style: 'light',
        items: [
          { value: '15 ans', label: "D'expérience", description: '' },
          { value: '97%', label: 'Clients satisfaits', description: '' },
          { value: '30 jours', label: 'Délai moyen', description: '' },
          { value: '0', label: 'Compromis', description: 'Sur la qualité' },
        ],
        bgColor: 'var(--color-secondary)', sectionHeight: '',
      },
      {
        type: 'cards', title: 'Nos engagements', subtitle: '', columns: 3,
        cards: [
          { icon: '✓', title: 'Transparence totale', body: "Vous savez toujours où en est votre mission. Rapports hebdomadaires inclus.", href: '#' },
          { icon: '✓', title: 'Garantie 6 mois', body: "Si le candidat part dans les 6 mois, nous refaisons la mission sans frais.", href: '#' },
          { icon: '✓', title: 'Exclusivité métier', body: "Un seul cabinet par mission pour une concentration maximale.", href: '#' },
        ],
        bgColor: '', sectionHeight: '',
      },
      {
        type: 'cta', title: 'Parlons.',
        subtitle: '',
        buttonLabel: 'Prendre contact', buttonHref: '/contact',
        buttonSecondaryLabel: '', buttonSecondaryHref: '',
        style: 'light', bgColor: '', sectionHeight: '',
      },
    ],
  },
]
