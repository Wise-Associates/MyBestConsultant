'use client'

import { useEffect } from 'react'

// Ouvre la boîte d'impression ("Enregistrer en PDF") dès l'affichage de la page — utilisé par
// le lien « Rapport PDF » du suivi des annonces (?print=1). Le léger délai laisse le temps
// aux polices et à la photo de se charger avant la mise en page d'impression.
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 700)
    return () => clearTimeout(t)
  }, [])
  return null
}
