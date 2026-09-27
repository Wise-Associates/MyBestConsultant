'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Building2, Check, ExternalLink, Globe, ImagePlus, Loader2, MapPin, Plus, Trash2, Upload, Users, X,
  Sparkles, Video, AlertCircle, Eye,
} from 'lucide-react'
import { BENEFIT_ICONS, BENEFIT_SUGGESTIONS, BenefitIcon, VALUE_SUGGESTIONS } from '@/lib/brand-icons'
import {
  BRAND_SIZES, LIMITS, SIZE_LABEL, brandCompleteness, canPublish, videoEmbedUrl, type BrandProfile,
} from '@/lib/brand'
import type { EmployerBrand } from '@/lib/appwrite/brand'
import { saveBrandAction, uploadBrandImageAction } from './actions'

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(232,163,61,0.25)]'
const inputStyle = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

// Redimensionne/compresse côté navigateur avant envoi : le bucket plafonne à 2 Mo et une photo
// d'appareil en fait souvent 5+. Le logo reste en PNG pour garder sa transparence.
async function prepareImage(file: File, maxSide: number, keepAlpha: boolean): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const type = keepAlpha ? 'image/png' : 'image/jpeg'
  for (const q of [0.86, 0.72, 0.58]) {
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, type, q))
    if (blob && blob.size <= 1.9 * 1024 * 1024) return new File([blob], `image.${keepAlpha ? 'png' : 'jpg'}`, { type })
  }
  throw new Error('Image trop lourde, même après compression')
}

function Card({ title, hint, icon, children }: { title: string; hint?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.14)', color: 'var(--color-primary)' }}>{icon}</span>
        <div>
          <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>{title}</h2>
          {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, count, children }: { label: string; count?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
        {label}{count && <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>{count}</span>}
      </span>
      {children}
    </label>
  )
}

export function BrandEditor({ initial }: { initial: EmployerBrand }) {
  const [name, setName] = useState(initial.name)
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl)
  const [brand, setBrand] = useState<BrandProfile>(initial.profile)
  const [published, setPublished] = useState(initial.published)
  const [saved, setSaved] = useState(() => JSON.stringify({ n: initial.name, l: initial.logoUrl, b: initial.profile, p: initial.published }))
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [openIcon, setOpenIcon] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const galleryInput = useRef<HTMLInputElement>(null)

  const snapshot = JSON.stringify({ n: name, l: logoUrl, b: brand, p: published })
  const dirty = snapshot !== saved
  const { pct, missing } = useMemo(() => brandCompleteness(brand, { logoUrl }), [brand, logoUrl])
  const embed = videoEmbedUrl(brand.videoUrl)
  // Ce qui empêchera la publication à l'enregistrement — affiché AVANT de cliquer, pas après.
  const publishBlocker = published ? canPublish(brand) : null
  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => setBrand(b => ({ ...b, [k]: v }))
  const publicPath = `/entreprises/${initial.slug}`

  async function upload(slot: string, file: File | undefined, maxSide: number, keepAlpha: boolean, onUrl: (url: string) => void) {
    if (!file) return
    setError(null)
    setUploading(slot)
    try {
      const prepared = await prepareImage(file, maxSide, keepAlpha)
      const fd = new FormData()
      fd.append('file', prepared)
      const res = await uploadBrandImageAction(fd)
      if (res.error || !res.url) throw new Error(res.error ?? 'Échec de l’envoi')
      onUrl(res.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’envoi de l’image')
    } finally {
      setUploading(null)
    }
  }

  function save() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const res = await saveBrandAction({ name, logoUrl, brand, published })
      if (res.error) { setError(res.error); return }
      const b = res.brand ?? brand
      const nowPublished = res.published ?? published
      setBrand(b); setName(res.name ?? name); setLogoUrl(res.logoUrl ?? logoUrl)
      setPublished(nowPublished)
      setSaved(JSON.stringify({ n: res.name ?? name, l: res.logoUrl ?? logoUrl, b, p: nowPublished }))
      if (res.publishError) setNotice(res.publishError)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    })
  }

  const heroBtn = { background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.18)' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)', paddingBottom: 96 }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/recruiter/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <Building2 className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Marque employeur</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Votre page publique pour attirer les meilleurs profils</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold px-3 py-1.5 rounded-full" style={{ background: published ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.1)', color: published ? '#6ee7b7' : 'rgba(255,255,255,0.7)' }}>
                {published ? '● Publiée' : '○ Brouillon'}
              </span>
              <Link href={publicPath} target="_blank" className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold no-underline transition-opacity hover:opacity-85" style={heroBtn}>
                <Eye className="h-3.5 w-3.5" /> Voir la page <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* ── Identité ── */}
          <Card title="Identité" hint="Ce que les candidats voient en premier." icon={<Building2 className="h-4 w-4" />}>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'var(--color-background)', border: '1px dashed var(--color-border)' }}>
                {logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  : <Building2 className="h-7 w-7" style={{ color: 'var(--color-text-muted)' }} />}
              </div>
              <div>
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-opacity hover:opacity-85" style={{ background: 'var(--hero-bg)', color: 'white' }}>
                  {uploading === 'logo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {logoUrl ? 'Changer le logo' : 'Ajouter un logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { upload('logo', e.target.files?.[0], 512, true, setLogoUrl); e.target.value = '' }} />
                </label>
                {logoUrl && <button type="button" onClick={() => setLogoUrl('')} className="ml-2 text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Retirer</button>}
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>PNG, JPG ou WebP · carré de préférence</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Field label="Nom de l'entreprise"><input className={inputCls} style={inputStyle} value={name} maxLength={LIMITS.name} onChange={e => setName(e.target.value)} /></Field></div>
              <div className="sm:col-span-2">
                <Field label="Accroche" count={`${brand.tagline.length}/${LIMITS.tagline}`}>
                  <input className={inputCls} style={inputStyle} value={brand.tagline} maxLength={LIMITS.tagline} placeholder="Une phrase qui donne envie de vous rejoindre" onChange={e => set('tagline', e.target.value)} />
                </Field>
              </div>
              <Field label="Secteur d'activité"><input className={inputCls} style={inputStyle} value={brand.sector} maxLength={LIMITS.sector} placeholder="Conseil IT, Banque, Industrie…" onChange={e => set('sector', e.target.value)} /></Field>
              <Field label="Taille de l'entreprise">
                <select className={inputCls} style={inputStyle} value={brand.size} onChange={e => set('size', e.target.value)}>
                  <option value="">Non précisée</option>
                  {BRAND_SIZES.map(s => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Siège / localisation"><input className={inputCls} style={inputStyle} value={brand.headquarters} maxLength={LIMITS.headquarters} placeholder="Paris, France" onChange={e => set('headquarters', e.target.value)} /></Field>
              <Field label="Année de création"><input className={inputCls} style={inputStyle} inputMode="numeric" maxLength={4} value={brand.foundedYear} placeholder="2012" onChange={e => set('foundedYear', e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Site web"><input className={inputCls} style={inputStyle} value={brand.website} placeholder="https://www.entreprise.com" onChange={e => set('website', e.target.value)} /></Field>
              <Field label="Page LinkedIn"><input className={inputCls} style={inputStyle} value={brand.linkedin} placeholder="https://www.linkedin.com/company/…" onChange={e => set('linkedin', e.target.value)} /></Field>
            </div>
          </Card>

          {/* ── Couverture ── */}
          <Card title="Image de couverture" hint="Bandeau en haut de votre page (format paysage, 1600 px de large idéal)." icon={<ImagePlus className="h-4 w-4" />}>
            <div className="relative rounded-2xl overflow-hidden flex items-center justify-center" style={{ aspectRatio: '16 / 6', background: 'var(--color-background)', border: '1px dashed var(--color-border)' }}>
              {brand.coverUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={brand.coverUrl} alt="Couverture" className="absolute inset-0 w-full h-full object-cover" />
                : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Aucune image</p>}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-opacity hover:opacity-85" style={{ background: 'var(--hero-bg)', color: 'white' }}>
                {uploading === 'cover' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {brand.coverUrl ? 'Remplacer' : 'Ajouter une image'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { upload('cover', e.target.files?.[0], 1920, false, u => set('coverUrl', u)); e.target.value = '' }} />
              </label>
              {brand.coverUrl && <button type="button" onClick={() => set('coverUrl', '')} className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Retirer</button>}
            </div>
          </Card>

          {/* ── À propos ── */}
          <Card title="À propos" hint="Qui êtes-vous, ce que vous faites, ce qui vous distingue." icon={<Sparkles className="h-4 w-4" />}>
            <Field label="Présentation" count={`${brand.about.length}/${LIMITS.about}`}>
              <textarea className={`${inputCls} resize-y`} style={{ ...inputStyle, minHeight: 170 }} value={brand.about} maxLength={LIMITS.about}
                placeholder="Présentez votre entreprise, votre histoire, vos clients et vos projets…" onChange={e => set('about', e.target.value)} />
            </Field>
          </Card>

          {/* ── Valeurs ── */}
          <Card title="Nos valeurs" hint={`Jusqu'à ${LIMITS.maxValues} valeurs, avec une courte explication.`} icon={<Users className="h-4 w-4" />}>
            <div className="space-y-3">
              {brand.values.map((v, i) => (
                <div key={i} className="rounded-2xl p-3.5 space-y-2" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <input className={inputCls} style={{ ...inputStyle, background: 'var(--color-surface)' }} value={v.title} maxLength={LIMITS.valueTitle} placeholder="Titre de la valeur"
                      onChange={e => set('values', brand.values.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                    <button type="button" aria-label="Supprimer" onClick={() => set('values', brand.values.filter((_, j) => j !== i))} className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)]" style={{ color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <textarea className={`${inputCls} resize-none`} style={{ ...inputStyle, background: 'var(--color-surface)', minHeight: 64 }} value={v.text} maxLength={LIMITS.valueText} placeholder="Ce que cela signifie concrètement au quotidien"
                    onChange={e => set('values', brand.values.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                </div>
              ))}
            </div>
            {brand.values.length < LIMITS.maxValues && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button type="button" onClick={() => set('values', [...brand.values, { title: '', text: '' }])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter une valeur
                </button>
                {VALUE_SUGGESTIONS.filter(s => !brand.values.some(v => v.title === s)).slice(0, 4).map(s => (
                  <button key={s} type="button" onClick={() => set('values', [...brand.values, { title: s, text: '' }])} className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>+ {s}</button>
                ))}
              </div>
            )}
          </Card>

          {/* ── Avantages ── */}
          <Card title="Avantages" hint={`Jusqu'à ${LIMITS.maxBenefits} avantages affichés avec un pictogramme.`} icon={<Check className="h-4 w-4" />}>
            <div className="space-y-3">
              {brand.benefits.map((b, i) => (
                <div key={i} className="rounded-2xl p-3.5" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setOpenIcon(openIcon === i ? null : i)} aria-label="Choisir le pictogramme" className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center"
                      style={{ background: 'rgba(232,163,61,0.16)', color: '#b8862f' }}><BenefitIcon name={b.icon} className="h-5 w-5" /></button>
                    <input className={inputCls} style={{ ...inputStyle, background: 'var(--color-surface)' }} value={b.title} maxLength={LIMITS.benefitTitle} placeholder="Ex. Télétravail flexible"
                      onChange={e => set('benefits', brand.benefits.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                    <button type="button" aria-label="Supprimer" onClick={() => { set('benefits', brand.benefits.filter((_, j) => j !== i)); setOpenIcon(null) }} className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)]" style={{ color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {openIcon === i && (
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mt-3">
                      {Object.entries(BENEFIT_ICONS).map(([key, { label }]) => (
                        <button key={key} type="button" title={label} onClick={() => { set('benefits', brand.benefits.map((x, j) => j === i ? { ...x, icon: key } : x)); setOpenIcon(null) }}
                          className="h-10 rounded-lg flex items-center justify-center" style={{ background: b.icon === key ? 'var(--hero-bg)' : 'var(--color-surface)', color: b.icon === key ? 'white' : 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                          <BenefitIcon name={key} className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                  )}
                  <input className={`${inputCls} mt-2`} style={{ ...inputStyle, background: 'var(--color-surface)' }} value={b.text} maxLength={LIMITS.benefitText} placeholder="Précision (facultatif)"
                    onChange={e => set('benefits', brand.benefits.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                </div>
              ))}
            </div>
            {brand.benefits.length < LIMITS.maxBenefits && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button type="button" onClick={() => set('benefits', [...brand.benefits, { icon: 'gift', title: '', text: '' }])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter un avantage
                </button>
                {BENEFIT_SUGGESTIONS.filter(s => !brand.benefits.some(b => b.title === s.title)).slice(0, 4).map(s => (
                  <button key={s.title} type="button" onClick={() => set('benefits', [...brand.benefits, { icon: s.icon, title: s.title, text: '' }])} className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>+ {s.title}</button>
                ))}
              </div>
            )}
          </Card>

          {/* ── Galerie & vidéo ── */}
          <Card title="Photos & vidéo" hint={`Jusqu'à ${LIMITS.maxGallery} photos et une vidéo YouTube ou Vimeo.`} icon={<Video className="h-4 w-4" />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {brand.gallery.map((u, i) => (
                <div key={u} className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '4 / 3', border: '1px solid var(--color-border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-full h-full object-cover" />
                  <button type="button" aria-label="Retirer la photo" onClick={() => set('gallery', brand.gallery.filter((_, j) => j !== i))}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {brand.gallery.length < LIMITS.maxGallery && (
                <button type="button" onClick={() => galleryInput.current?.click()} className="rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors hover:bg-[rgba(232,163,61,0.08)]"
                  style={{ aspectRatio: '4 / 3', border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}>
                  {uploading === 'gallery' ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  Ajouter
                </button>
              )}
              <input ref={galleryInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
                onChange={async e => {
                  const files = [...(e.target.files ?? [])].slice(0, LIMITS.maxGallery - brand.gallery.length)
                  e.target.value = ''
                  for (const f of files) await upload('gallery', f, 1600, false, u => setBrand(b => ({ ...b, gallery: [...b.gallery, u].slice(0, LIMITS.maxGallery) })))
                }} />
            </div>
            <div className="mt-5">
              <Field label="Vidéo de présentation (YouTube ou Vimeo)">
                <input className={inputCls} style={inputStyle} value={brand.videoUrl} placeholder="https://www.youtube.com/watch?v=…" onChange={e => setBrand(b => ({ ...b, videoUrl: e.target.value }))} />
              </Field>
              {brand.videoUrl && !embed && <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: '#ef4444' }}><AlertCircle className="h-3.5 w-3.5" /> Lien non reconnu — collez une adresse YouTube ou Vimeo.</p>}
              {embed && (
                <div className="mt-3 rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9', maxWidth: 420 }}>
                  <iframe src={embed} title="Aperçu vidéo" className="w-full h-full" allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Colonne latérale : publication, complétion, aperçu ── */}
        <aside className="space-y-4 lg:sticky lg:top-[84px] min-w-0">
          <div className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Publier la page</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{published ? 'Visible par tous, avec vos offres actives.' : 'Non visible publiquement pour le moment.'}</p>
              </div>
              <button type="button" role="switch" aria-checked={published} onClick={() => setPublished(p => !p)}
                className="relative w-12 h-7 rounded-full shrink-0 transition-colors" style={{ background: published ? '#10b981' : 'rgba(0,0,0,0.18)' }}>
                <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all" style={{ left: published ? 22 : 2, boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </button>
            </div>
            {(publishBlocker || notice) && (
              <p className="text-xs mt-3 rounded-xl px-3 py-2.5 flex items-start gap-2 leading-snug" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#92400e' }}>
                <AlertCircle className="h-4 w-4 shrink-0 mt-px" />{publishBlocker ?? notice}
              </p>
            )}
            <p className="text-[11px] mt-3 flex items-center gap-1.5 break-all" style={{ color: 'var(--color-text-muted)' }}><Globe className="h-3 w-3 shrink-0" />mybestconsultant.fr{publicPath}</p>
          </div>

          <div className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Complétion de la page</p>
              <span className="text-sm font-bold" style={{ color: pct === 100 ? '#10b981' : 'var(--color-primary)' }}>{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct === 100 ? '#10b981' : 'var(--color-primary)' }} />
            </div>
            {missing.length > 0
              ? <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>À ajouter : {missing.join(' · ')}.</p>
              : <p className="text-xs mt-3" style={{ color: '#059669' }}>Votre page est complète, bravo !</p>}
          </div>

          <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest px-5 pt-4" style={{ color: 'var(--color-text-muted)' }}>Aperçu</p>
            <div className="p-4">
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <div className="relative h-24" style={{ background: brand.coverUrl ? undefined : 'var(--hero-bg)' }}>
                  {brand.coverUrl && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={brand.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />)}
                </div>
                <div className="px-4 pb-4">
                  <div className="-mt-6 w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center relative" style={{ background: 'white', border: '2px solid white', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                    {logoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={logoUrl} alt="" className="w-full h-full object-contain" />
                      : <Building2 className="h-5 w-5" style={{ color: '#9ca3af' }} />}
                  </div>
                  <p className="font-bold mt-2 text-sm" style={{ color: 'var(--color-text)' }}>{name || 'Votre entreprise'}</p>
                  <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>{brand.tagline || 'Votre accroche apparaîtra ici.'}</p>
                  {(brand.sector || brand.headquarters) && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {brand.sector && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>{brand.sector}</span>}
                      {brand.headquarters && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text-muted)' }}><MapPin className="h-2.5 w-2.5" />{brand.headquarters}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Barre d'enregistrement ── */}
      <div className="fixed inset-x-0 bottom-0 z-40" style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(10px)', borderTop: '1px solid var(--color-border)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <p className="text-xs font-medium min-w-0" style={{ color: error ? '#dc2626' : (notice || publishBlocker) ? '#b45309' : justSaved ? '#059669' : 'var(--color-text-muted)' }}>
            {error ? error : justSaved ? (notice ? '✓ Enregistré — mais la page n’est pas encore publiée (voir l’encadré orange)' : published ? '✓ Enregistré — votre page est publiée' : '✓ Modifications enregistrées') : publishBlocker ? 'La publication est bloquée : voir l’encadré orange' : dirty ? 'Modifications non enregistrées' : 'Tout est à jour'}
          </p>
          <button type="button" onClick={save} disabled={!dirty || pending || uploading !== null}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-40 shrink-0"
            style={{ background: 'var(--color-primary)', color: 'white' }}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? 'Enregistrement…' : published && !dirty ? 'Enregistré' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
