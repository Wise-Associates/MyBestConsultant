'use client'

import { Download } from 'lucide-react'

// Export PDF via l'impression du navigateur ("Enregistrer en PDF") plutôt qu'une librairie
// de génération dédiée — le CSS @media print de la page masque déjà la nav/les boutons et
// force l'affichage des couleurs, donc l'aperçu imprimé est directement le rapport propre
// à transmettre à la hiérarchie.
export function ExportPdfButton() {
  return (
    <button onClick={() => window.print()} type="button"
      className="no-print inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-90 shrink-0"
      style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', color: 'white' }}>
      <Download className="h-3.5 w-3.5" /> Exporter en PDF
    </button>
  )
}
