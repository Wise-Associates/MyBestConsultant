import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { FilePlus2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { CreateJobForm } from './create-job-form'

// « Publier un job » (menu de l'espace recruteur, demande du 2026-11-17) : création d'une offre (saisie, assistant IA,
// import IA / Excel), à la place de la fenêtre « Nouvelle offre » du tableau de bord.
// Les Server Actions de cette page (création, import) envoient la publication sur les réseaux en arrière-plan : photo de
// l'affiche par OpenAI (jusqu'à 2 min) puis envoi à Make.
export const maxDuration = 300

export default async function PublishJobPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <header style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--hero-fg-muted)' }}>
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden />Recrutement
          </p>
          <h1 style={{ color: 'var(--hero-fg)', fontWeight: 300, fontSize: '1.5rem', lineHeight: 1.3 }}>Publier un job</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--hero-fg-muted)' }}>
            Rédigez l’offre vous-même ou avec l’assistant IA, ou importez-en plusieurs depuis un fichier. Elle reste en ligne un mois.
          </p>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Onglet d'arrivée lu dans l'adresse (?tab=import) : useSearchParams demande une limite Suspense. */}
        <Suspense fallback={null}>
          <CreateJobForm companyName={`${user.firstName} ${user.lastName}`} />
        </Suspense>
      </div>
    </div>
  )
}
