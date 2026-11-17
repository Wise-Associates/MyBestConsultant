import { redirect } from 'next/navigation'

// L'import IA / Excel vit sur la page « Publier un job » (onglet « Import IA / Excel »).
export default function ImportPage() {
  redirect('/recruiter/publier?tab=import')
}
