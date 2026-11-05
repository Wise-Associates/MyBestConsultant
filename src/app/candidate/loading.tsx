import { SectionPageSkeleton } from '@/components/recruiter/page-skeletons'

// Chargement d'une page de l'espace candidat (aide et support) : la page en gris, comme dans l'espace recruteur, plus la
// barre de progression du haut (navigation-progress.tsx). Le tableau de bord a sa propre forme (dashboard/loading.tsx).
export default function Loading() {
  return <SectionPageSkeleton />
}
