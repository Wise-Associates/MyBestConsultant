import type { ReactNode } from 'react'
import { AoPublicationsProvider } from '@/components/ao/offer-publications'
import { previewRecruiterAoPublication, publishRecruiterAoOffer } from './actions'

// Section des appels d'offres de l'organisation (liste, pages des offres, statistiques, boîtes) : une préparation ou une
// publication lancée sur la page d'une offre continue quand on passe à une autre offre ou revient à la liste. Les actions
// vérifient le recruteur et son organisation elles-mêmes.
export default function RecruiterAoSectionLayout({ children }: { children: ReactNode }) {
  return (
    <AoPublicationsProvider actions={{ previewPublication: previewRecruiterAoPublication, publish: publishRecruiterAoOffer }}>
      {children}
    </AoPublicationsProvider>
  )
}
