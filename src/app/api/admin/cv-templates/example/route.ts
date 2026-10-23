import { adminDenial, templateExampleResponse } from '@/lib/cv-export/http'

// Exemple pour préparer un modèle (ADR 0010) : le modèle Wise Associates sans son bloc contact, et son template_map.json (.zip).
export async function GET() {
  const denied = await adminDenial()
  if (denied) return denied
  return templateExampleResponse()
}
