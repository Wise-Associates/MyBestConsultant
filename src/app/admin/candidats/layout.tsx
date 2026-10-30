import type { ReactNode } from 'react'
import { AoPublicationsProvider } from '@/components/ao/offer-publications'
import { previewAoPublication, publishAoOffer } from './actions'

// Section AO de l'admin (liste, pages des offres, statistiques, boîtes) : une préparation ou une publication lancée sur la
// page d'une offre continue quand on passe à une autre offre ou revient à la liste. Les actions vérifient l'admin elles-mêmes.
export default function AdminAoSectionLayout({ children }: { children: ReactNode }) {
  return <AoPublicationsProvider actions={{ previewPublication: previewAoPublication, publish: publishAoOffer }}>{children}</AoPublicationsProvider>
}
