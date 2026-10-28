import { adminDenial, templateExampleResponse } from '@/lib/cv-export/http'

// Exemple pour préparer un modèle (ADR 0010, 0014) : le modèle Wise Associates sans son bloc contact (.docx).
export async function GET() {
  const denied = await adminDenial()
  if (denied) return denied
  return templateExampleResponse()
}
