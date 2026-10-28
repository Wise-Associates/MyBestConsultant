import { sessionRecruiter, templateExampleResponse } from '@/lib/cv-export/http'

// Exemple pour préparer le modèle de son organisation (ADR 0010, 0014) : le modèle Wise Associates sans son bloc contact
// (valeurs fictives), en .docx. Recruteurs connectés seulement.
export async function GET() {
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  return templateExampleResponse()
}
