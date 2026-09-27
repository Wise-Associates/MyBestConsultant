import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { RecommendationForm } from './recommendation-form'
import { docToRecommendation } from '@/lib/appwrite/recommendations'
import { RELATIONSHIP_LABEL } from '@/lib/recommendation-boost'

export default async function RecommendationRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const { databases } = createAdminClient()

  let doc
  try {
    doc = await databases.getDocument(DB_ID, COLLECTIONS.RECOMMENDATIONS, requestId)
  } catch {
    notFound()
  }

  const rec = docToRecommendation(doc as unknown as Record<string, unknown>)
  const candidateName = doc.candidateName as string
  const recipientName = doc.recipientName as string
  const alreadySubmitted = doc.status === 'submitted'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{
        width: '100%', maxWidth: 480, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 24, padding: '40px 36px', boxShadow: '0 20px 50px -20px rgba(11,29,81,0.25)',
      }}>
        <p style={{
          fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300, fontSize: 22,
          color: 'var(--color-text)', margin: '0 0 4px',
        }}>
          My<span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Best</span>Consultant
        </p>

        {alreadySubmitted ? (
          <div style={{ textAlign: 'center', padding: '32px 0 8px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h1 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.25rem', margin: '0 0 8px' }}>
              Recommandation déjà envoyée
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Merci {recipientName}, votre recommandation pour {candidateName} a bien été enregistrée.
            </p>
          </div>
        ) : (
          <>
            <h1 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.3rem', margin: '20px 0 8px' }}>
              Bonjour {recipientName}
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 28px' }}>
              <strong>{candidateName}</strong>{' '}vous demande de laisser une courte recommandation sur son travail. Aucune création de compte n&apos;est nécessaire — cela prend une minute.
            </p>
            {(rec.experience || rec.period || rec.recipientRole || rec.relationship) && (
              <div style={{ background: 'rgba(232,163,61,0.08)', border: '1px solid rgba(232,163,61,0.3)', borderRadius: 14, padding: '14px 16px', margin: '0 0 24px', fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--color-text)' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a6a1f' }}>Collaboration concernée</p>
                {rec.experience && <p style={{ margin: 0 }}>{rec.experience}</p>}
                {rec.period && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Période : {rec.period}</p>}
                {(rec.relationship || rec.recipientRole || rec.recipientCompany) && (
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    {[rec.relationship ? RELATIONSHIP_LABEL[rec.relationship] : '', rec.recipientRole, rec.recipientCompany].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}
            <RecommendationForm requestId={requestId} expertises={rec.requestedExpertises ?? []} />
          </>
        )}
      </div>
    </div>
  )
}
