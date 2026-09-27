import { CONTACT_ADDRESS, CONTACT_PHONE } from '@/lib/site-links'

export const metadata = { title: 'Mentions légales — MyBestConsultant' }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>{title}</h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--color-text-muted)' }}>{children}</div>
    </section>
  )
}

export default function LegalPage() {
  return (
    <div className="px-4 lg:px-8 py-16 lg:py-24" style={{ background: 'var(--color-background)' }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-light mb-12" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
          Mentions légales
        </h1>

        <Section title="Éditeur du site">
          <p>MyBestConsultant SAS, société par actions simplifiée au capital de 1 000 €.</p>
          <p>Siège social : {CONTACT_ADDRESS}, France.</p>
          <p>SIRET : 000 000 000 00000 — RCS Paris.</p>
          <p>Directeur de la publication : [Nom du responsable].</p>
          <p>Contact : contact@mybestconsultant.fr — {CONTACT_PHONE}</p>
        </Section>

        <Section title="Hébergement">
          <p>Le site est hébergé par un prestataire d&apos;hébergement web professionnel.</p>
          <p>Les données de la plateforme sont hébergées sur un serveur dédié à l&apos;application, distinct de l&apos;hébergement du site.</p>
        </Section>

        <Section title="Propriété intellectuelle">
          <p>L&apos;ensemble des contenus présents sur ce site (textes, images, logos, mise en page) est protégé par le droit d&apos;auteur. Toute reproduction, même partielle, est soumise à autorisation préalable.</p>
        </Section>

        <Section title="Données personnelles">
          <p>Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez d&apos;un droit d&apos;accès, de rectification et de suppression des données vous concernant. Pour exercer ce droit, contactez-nous à l&apos;adresse indiquée ci-dessus.</p>
        </Section>

        <Section title="Cookies">
          <p>Ce site peut utiliser des cookies nécessaires à son bon fonctionnement (authentification, préférences). Aucun cookie publicitaire tiers n&apos;est utilisé sans consentement préalable.</p>
        </Section>

        <p className="text-xs mt-16" style={{ color: 'var(--color-text-muted)' }}>
          Dernière mise à jour : {new Date().toLocaleDateString('fr-FR')}
        </p>
      </div>
    </div>
  )
}
