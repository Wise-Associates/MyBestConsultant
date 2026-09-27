import { redirect } from 'next/navigation'

// L'import IA / Excel vit maintenant dans la fenêtre « Publier une offre » (onglet « Import IA / Excel »).
export default function ImportPage() {
  redirect('/recruiter/dashboard?openCreateJob=1&tab=import')
}
