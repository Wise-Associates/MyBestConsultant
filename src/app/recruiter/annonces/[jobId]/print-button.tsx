'use client'

import { Printer } from 'lucide-react'

// Même principe que l'export PDF de la fiche candidat : impression navigateur
// ("Enregistrer en PDF"), le CSS @media print de la page ne garde que le rapport.
export function PrintButton() {
  return (
    <button onClick={() => window.print()} type="button"
      className="no-print inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-90 shrink-0"
      style={{ background: 'var(--color-primary)', color: 'white' }}>
      <Printer className="h-3.5 w-3.5" /> Exporter en PDF
    </button>
  )
}
