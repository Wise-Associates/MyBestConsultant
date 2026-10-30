import { SectionPageSkeleton } from '@/components/recruiter/page-skeletons'

// Chargement d'une page de l'espace recruteur : la page en gris (en-tête sombre, liste), plus la barre de progression
// du haut (navigation-progress.tsx). Les rubriques de mise en page différente ont leur propre loading.tsx.
export default function Loading() {
  return <SectionPageSkeleton />
}
