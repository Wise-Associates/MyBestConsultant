// Public pages that live in code (not created through the /admin/pages CMS).
// Shown alongside CMS pages in the nav menu picker so the admin can add them
// to the top navigation without knowing the route by heart.
export const KNOWN_PAGES: { href: string; label: string }[] = [
  { href: '/jobs', label: 'Offres' },
  { href: '/abonnement', label: 'Abonnements' },
  { href: '/contact', label: 'Contact' },
  { href: '/legal', label: 'Mentions légales' },
]
