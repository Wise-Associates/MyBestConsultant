'use client'

import { useState, useTransition } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Loader2, Check, AlertCircle, Image as ImageIcon, X } from 'lucide-react'
import { updateSiteContent } from '../design/actions'
import type { SiteConfig } from '@/lib/site-config'
import { ImageUpload } from '@/components/page-builder/image-upload'

interface Props { config: SiteConfig }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.07]">
        <h3 className="text-sm font-semibold text-white/70">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-white/50 uppercase tracking-wider">{label}</Label>
      {children}
      {hint && <p className="text-xs text-white/25">{hint}</p>}
    </div>
  )
}

const inputCls = "bg-white/[0.05] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg"

export function ContentEditor({ config }: Props) {
  const [form, setForm] = useState({
    siteName: config.siteName,
    siteTagline: config.siteTagline,
    logoUrl: config.logoUrl,
    heroTitle: config.heroTitle,
    heroSubtitle: config.heroSubtitle,
    heroCtaRecruiter: config.heroCtaRecruiter,
    heroCtaCandidate: config.heroCtaCandidate,
    heroImageUrl: config.heroImageUrl,
    heroImageAlt: config.heroImageAlt,
    statsJobs: config.statsJobs,
    statsCompanies: config.statsCompanies,
    statsCandidates: config.statsCandidates,
    footerText: config.footerText,
    contactEmail: config.contactEmail,
    seoTitle: config.seoTitle,
    seoDescription: config.seoDescription,
    seoKeywords: config.seoKeywords,
  })
  const [trustedLogos, setTrustedLogos] = useState<string[]>(config.trustedLogos)
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function save() {
    setSaveStatus('idle')
    startTransition(async () => {
      const result = await updateSiteContent({ ...form, trustedLogosJson: JSON.stringify(trustedLogos) })
      if ('error' in result) {
        setSaveStatus('error')
        setErrorMsg(result.error)
      } else {
        setSaveStatus('ok')
        setTimeout(() => setSaveStatus('idle'), 4000)
      }
    })
  }

  return (
    <div className="min-h-full bg-[#0A0C10] text-white">

      {/* Header */}
      <div className="border-b border-white/[0.07] px-8 py-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Contenu du site</h1>
          <p className="text-sm text-white/40 mt-1">
            Textes, images et informations affichés sur la page d&apos;accueil publique.
          </p>
        </div>
        <Button onClick={save} disabled={isPending}
          className={`shrink-0 gap-2 font-semibold ${
            saveStatus === 'ok' ? 'bg-emerald-500 hover:bg-emerald-400 text-white' :
            saveStatus === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            'bg-white text-black hover:bg-white/90'
          }`}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
           saveStatus === 'ok' ? <Check className="h-4 w-4" /> :
           saveStatus === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
          {isPending ? 'Sauvegarde...' : saveStatus === 'ok' ? 'Sauvegardé !' : saveStatus === 'error' ? 'Erreur' : 'Enregistrer'}
        </Button>
      </div>

      {saveStatus === 'error' && (
        <div className="mx-8 mt-4 flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="px-8 py-8 space-y-6 max-w-4xl">

        <Section title="Identité du site">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nom du site">
              <Input value={form.siteName} onChange={e => set('siteName', e.target.value)} className={inputCls} placeholder="MyBestConsultant" />
            </Field>
            <Field label="Tagline (badge hero)" hint="Texte affiché au-dessus du titre principal">
              <Input value={form.siteTagline} onChange={e => set('siteTagline', e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="border-t border-white/[0.07] pt-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ImageIcon className="h-4 w-4 text-white/40" />
              <p className="text-sm font-medium text-white/60">Logo du site</p>
            </div>
            <ImageUpload label="Logo (SVG, PNG, ou WebP recommandé)" value={form.logoUrl} onChange={v => set('logoUrl', v)} />
            {form.logoUrl && (
              <div className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.logoUrl} alt="Aperçu logo" className="h-10 w-auto object-contain" onError={e => (e.currentTarget.style.opacity = '0.3')} />
                <div>
                  <p className="text-xs text-white/50">Aperçu navbar</p>
                  <p className="text-[10px] text-white/25 mt-0.5">Hauteur fixe 36px — largeur automatique</p>
                </div>
                <button onClick={() => set('logoUrl', '')} className="ml-auto p-1.5 rounded-lg hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <p className="text-[11px] text-white/25">Si aucun logo n&apos;est uploadé, l&apos;initiale &quot;M&quot; + le nom du site s&apos;affichent.</p>
          </div>
          <div className="border-t border-white/[0.07] pt-4">
            <Field label="Email de contact" hint="Utilisé pour le lien « Nous contacter » sur la page d'accueil (ouvre le client mail du visiteur)">
              <Input type="email" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} className={inputCls} placeholder="contact@mybestconsultant.fr" />
            </Field>
          </div>
        </Section>

        <Section title="Statistiques clés">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Offres actives">
              <Input value={form.statsJobs} onChange={e => set('statsJobs', e.target.value)} className={inputCls} placeholder="2 400+" />
            </Field>
            <Field label="Entreprises">
              <Input value={form.statsCompanies} onChange={e => set('statsCompanies', e.target.value)} className={inputCls} placeholder="380+" />
            </Field>
            <Field label="Consultants">
              <Input value={form.statsCandidates} onChange={e => set('statsCandidates', e.target.value)} className={inputCls} placeholder="15 000+" />
            </Field>
          </div>
        </Section>

        <Section title="Référencement (SEO)">
          <p className="text-xs text-white/40">
            Contrôle ce que Google et les moteurs de recherche affichent pour la page d&apos;accueil. Laissez vide pour garder les valeurs par défaut.
          </p>
          <Field label="Titre SEO" hint="Affiché dans l'onglet du navigateur et les résultats de recherche (60 caractères max recommandé)">
            <Input value={form.seoTitle} onChange={e => set('seoTitle', e.target.value)} className={inputCls} placeholder="MyBestConsultant.fr — Recrutement AI" />
          </Field>
          <Field label="Description SEO" hint="Affichée sous le titre dans les résultats de recherche (155 caractères max recommandé)">
            <Textarea value={form.seoDescription} onChange={e => set('seoDescription', e.target.value)} className={inputCls} rows={3}
              placeholder="Plateforme SaaS de recrutement propulsée par l'IA — screening CV automatique, interview virtuel, backoffice multi-tenant." />
          </Field>
          <Field label="Mots-clés SEO" hint="Séparés par des virgules — ex : recrutement IA, consultant IT, freelance, portage salarial">
            <Input value={form.seoKeywords} onChange={e => set('seoKeywords', e.target.value)} className={inputCls} placeholder="recrutement IA, consultant IT, freelance, mission" />
          </Field>
        </Section>

        <Section title="Pied de page">
          <Field label="Texte footer">
            <Input value={form.footerText} onChange={e => set('footerText', e.target.value)} className={inputCls} />
          </Field>
        </Section>

        <Section title="Logos partenaires (« Ils nous ont fait confiance »)">
          <p className="text-xs text-white/40">
            Ajoutez les logos des entreprises partenaires — ils défilent automatiquement sur la page d&apos;accueil, taille harmonisée.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trustedLogos.map((url, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                <ImageUpload
                  label={`Logo ${i + 1}`}
                  value={url}
                  onChange={v => setTrustedLogos(prev => prev.map((u, j) => j === i ? v : u))}
                />
                <button
                  onClick={() => setTrustedLogos(prev => prev.filter((_, j) => j !== i))}
                  className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/30 hover:text-red-400 transition-colors shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setTrustedLogos(prev => [...prev, ''])}
            className="border-white/[0.1] text-white/60 hover:bg-white/[0.05] hover:text-white/80"
          >
            + Ajouter un logo
          </Button>
        </Section>

      </div>
    </div>
  )
}
