import { Mail, Phone, MapPin } from 'lucide-react'
import { CONTACT_ADDRESS, CONTACT_PHONE, CONTACT_PHONE_HREF } from '@/lib/site-links'
import { ContactForm } from './contact-form'

export const metadata = { title: 'Contact — MyBestConsultant' }

export default function ContactPage() {
  return (
    <div className="px-4 lg:px-8 py-16 lg:py-24" style={{ background: 'var(--color-background)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-light" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
            Contactez-nous
          </h1>
          <p className="mt-3 text-base" style={{ color: 'var(--color-text-muted)' }}>
            Une question, un projet ? Notre équipe vous répond rapidement.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2 space-y-6">
            {[
              { icon: Mail, label: 'Email', value: 'contact@mybestconsultant.fr', href: 'mailto:contact@mybestconsultant.fr' },
              { icon: Phone, label: 'Téléphone', value: CONTACT_PHONE, href: CONTACT_PHONE_HREF },
              { icon: MapPin, label: 'Adresse', value: CONTACT_ADDRESS, href: undefined as string | undefined },
            ].map(({ icon: Icon, label, value, href }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(11,29,81,0.06)' }}>
                  <Icon className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text)' }}>{href ? <a href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{value}</a> : value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </div>
      </div>
    </div>
  )
}
