'use client'

import { useState } from 'react'
import { Check, CheckCircle2, ChevronDown, ChevronUp, Copy, ExternalLink, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'
import { testZernioInstagramAction } from './actions'

// Outils de configuration réservés aux développeurs : affichés seulement en développement local, ou en production
// quand la variable SOCIAL_DEV_TOOLS vaut 1. Les clients ne voient jamais ce bloc (ni son code : il n'est envoyé au
// navigateur que lorsqu'il est affiché).

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const field = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }

const KIE_BODY = `{"model":"gpt-image-2-image-to-image","input":{"prompt":"{{1.content.escaped.imagePrompt}}","input_urls":["{{1.content.image.logoUrl}}"],"aspect_ratio":"{{1.content.image.aspectRatio}}","resolution":"1K","output_format":"png"}}`
const BUFFER_BODY = `{"query":"mutation Publier($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }","variables":{"input":{"channelId":"ID_DU_CANAL","text":"{{1.content.escaped.linkedin}}","schedulingType":"automatic","mode":"shareNow","assets":[{"image":{"url":"URL_IMAGE"}}]}}}`
const BUFFER_IG = `"metadata":{"instagram":{"type":"post","shouldShareToFeed":true}}`
const CALLBACK_NET = `{"publicationId":"{{1.publicationId}}","results":[{"network":"linkedin","status":"{{if(BUFFER.data.data.createPost.post.id; "published"; "failed")}}","error":"{{BUFFER.data.data.createPost.message}}"}]}`

export function SocialDevPanel({ env, callbackUrl, zernioEnv }: {
  env: { webhook: boolean; secret: boolean; configured: boolean }; callbackUrl: string
  zernioEnv?: { kie: boolean; key: boolean; account: boolean }
}) {
  const [copied, setCopied] = useState(false)
  const [secret, setSecret] = useState('')
  const [secretCopied, setSecretCopied] = useState(false)
  const [guide, setGuide] = useState(false)

  async function copyUrl() { try { await navigator.clipboard.writeText(callbackUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* presse-papiers indisponible */ } }

  // Mot de passe aléatoire fabriqué dans le navigateur : rien n'est envoyé ni enregistré, on le copie dans les variables d'environnement et dans Make.
  function generateSecret() {
    const b = new Uint8Array(24)
    crypto.getRandomValues(b)
    setSecret(Array.from(b, x => x.toString(16).padStart(2, '0')).join(''))
    setSecretCopied(false)
  }
  async function copySecret() { try { await navigator.clipboard.writeText(secret); setSecretCopied(true); setTimeout(() => setSecretCopied(false), 1500) } catch { /* presse-papiers indisponible */ } }

  const checks = [
    { ok: env.webhook, label: 'Webhook Make', hint: 'Variable MAKE_SOCIAL_WEBHOOK_URL (https)' },
    { ok: env.secret, label: 'Mot de passe partagé', hint: 'Variable SOCIAL_WEBHOOK_SECRET (16 caractères min.)' },
  ]

  return (
    <>
      <section className="rounded-2xl p-5 space-y-4" style={card}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 style={{ fontSize: "1rem" }} className="font-semibold text-white">Outils développeur — connexion à Make</h2>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: env.configured ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)', color: env.configured ? '#34d399' : '#f87171' }}>{env.configured ? '● Configuré' : '● À configurer'}</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {checks.map(c => (
            <div key={c.label} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {c.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 text-red-400 shrink-0" />}
              <div><p className="text-sm font-semibold text-white/85">{c.label}</p><p className="text-[11px] text-white/40 mt-0.5">{c.hint}</p></div>
            </div>
          ))}
        </div>
        {!env.secret && (
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(232,163,61,0.08)', border: '1px solid rgba(232,163,61,0.25)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>Pas encore de mot de passe partagé ? Générez-en un, puis copiez-le dans <code>SOCIAL_WEBHOOK_SECRET</code> et dans Make.</p>
              <button type="button" onClick={generateSecret} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: '#B8860B', color: 'white' }}><RefreshCw className="h-3.5 w-3.5" />{secret ? 'En générer un autre' : 'Générer un mot de passe'}</button>
            </div>
            {secret && (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg text-xs" style={field}>{secret}</code>
                <button type="button" onClick={copySecret} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>{secretCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{secretCopied ? 'Copié' : 'Copier'}</button>
              </div>
            )}
            {secret && <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Il n’est pas enregistré ici : conservez-le, il faut ensuite redéployer pour que la plateforme le prenne en compte.</p>}
          </div>
        )}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>URL de rappel (à mettre dans le dernier module HTTP de Make)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg text-xs" style={field}>{callbackUrl}</code>
            <button type="button" onClick={copyUrl} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copié' : 'Copier'}</button>
          </div>
        </div>
        <button type="button" onClick={() => setGuide(g => !g)} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#e8a33d' }}>{guide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}Guide de configuration du scénario Make</button>
        {guide && <MakeGuide />}
      </section>
      {zernioEnv && <ZernioPilot env={zernioEnv} />}
    </>
  )
}

// Pilote : publication directe sur Instagram via Zernio, en parallèle de Make + Buffer qui reste le flux de
// production pour LinkedIn. But : comparer les deux avant de généraliser à d'autres réseaux (voir lib/zernio.ts).
function ZernioPilot({ env }: { env: { kie: boolean; key: boolean; account: boolean } }) {
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; permalink?: string } | null>(null)
  const ready = env.kie && env.key && env.account

  async function test() {
    setTesting(true); setMsg(null)
    const r = await testZernioInstagramAction()
    setMsg({ ok: r.ok, text: r.message, permalink: r.permalink }); setTesting(false)
  }

  const checks = [
    { ok: env.kie, label: 'Clé kie.ai', hint: 'Variable KIE_API_KEY — la même que dans Make' },
    { ok: env.key, label: 'Clé API Zernio', hint: 'Variable ZERNIO_API_KEY (créée sur zernio.com › API keys)' },
    { ok: env.account, label: 'Compte Instagram connecté', hint: 'Variable ZERNIO_INSTAGRAM_ACCOUNT_ID (après connexion sur zernio.com)' },
  ]

  return (
    <section className="rounded-2xl p-5 space-y-4" style={card}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 style={{ fontSize: '1rem' }} className="font-semibold text-white">Pilote — Instagram via Zernio</h2>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: ready ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)', color: ready ? '#34d399' : '#f87171' }}>{ready ? '● Configuré' : '● À configurer'}</span>
      </div>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        LinkedIn reste sur Make + Buffer. Ce bloc teste Zernio uniquement sur Instagram, en parallèle, pour comparer les deux avant de généraliser.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {checks.map(c => (
          <div key={c.label} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {c.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 text-red-400 shrink-0" />}
            <div><p className="text-sm font-semibold text-white/85">{c.label}</p><p className="text-[11px] text-white/40 mt-0.5">{c.hint}</p></div>
          </div>
        ))}
      </div>
      {!env.key && (
        <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'rgba(232,163,61,0.08)', border: '1px solid rgba(232,163,61,0.25)' }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
            Pas encore de compte Zernio : créez-en un sur <code>zernio.com</code>, générez une clé API (section « API keys »), créez un profil,
            puis connectez le compte Instagram (<code>GET /v1/connect/instagram?profileId=…</code> donne un lien d’autorisation à ouvrir).
            Récupérez ensuite l’<code>accountId</code> (<code>GET /v1/accounts</code>) et ajoutez <code>ZERNIO_API_KEY</code> et <code>ZERNIO_INSTAGRAM_ACCOUNT_ID</code> aux variables d’environnement.
          </p>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={test} disabled={testing || !ready} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Publier un post réel sur Instagram (via Zernio)
        </button>
        {msg && (
          <span className="text-xs inline-flex items-center gap-1.5" style={{ color: msg.ok ? '#34d399' : '#f87171' }}>
            {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{msg.text}
            {msg.permalink && <a href={msg.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Voir le post<ExternalLink className="h-3 w-3" /></a>}
          </span>
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Ce bouton publie pour de vrai sur le compte Instagram connecté (offre d’exemple) — à utiliser une seule fois pour vérifier, pas comme test répétable.</p>
    </section>
  )
}

function Code({ children }: { children: string }) {
  return <pre className="text-[11px] leading-relaxed rounded-lg p-2.5 mt-1.5 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: 'rgba(0,0,0,0.3)', color: '#fcd9a0', fontFamily: 'ui-monospace, monospace' }}>{children}</pre>
}

// Le scénario Make à construire, module par module.
function MakeGuide() {
  const step = (n: number, title: string, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold" style={{ background: 'rgba(232,163,61,0.18)', color: '#e8a33d' }}>{n}</span>
      <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-white/90">{title}</p><div className="text-xs leading-relaxed mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{body}</div></div>
    </li>
  )
  return (
    <ol className="space-y-4 pt-1 list-none p-0">
      {step(1, 'Webhooks › Custom webhook', <>Créez le webhook, activez « Get request headers », copiez son URL dans <code>MAKE_SOCIAL_WEBHOOK_URL</code>. Cliquez sur « Run once » dans Make puis sur « Envoyer un test » sur cette page : Make apprend la structure d’un exemple complet. Ajoutez un filtre sur la flèche suivante : <code>event</code> égal à <code>job.published</code> ET l’en-tête <code>x-mbc-secret</code> égal à votre mot de passe partagé. Le test est ainsi stoppé : rien n’est publié.</>)}
      {step(2, 'HTTP › Make a request — kie.ai (création de l’image)', <>POST <code>https://api.kie.ai/api/v1/jobs/createTask</code>, en-têtes <code>Authorization: Bearer VOTRE_CLE_KIE</code> et <code>Content-Type: application/json</code>, corps « Raw / JSON », « Parse response » activé :<Code>{KIE_BODY}</Code></>)}
      {step(3, 'Tools › Sleep', <>90 secondes : le temps que kie.ai génère l’image.</>)}
      {step(4, 'HTTP › Make a request — kie.ai (récupération)', <>GET <code>https://api.kie.ai/api/v1/jobs/recordInfo?taskId=</code> suivi de <code>data.data.taskId</code> du module 2, même en-tête <code>Authorization</code>, « Parse response » activé. Le résultat contient <code>state</code> (<code>success</code> quand l’image est prête) et <code>resultJson</code>.</>)}
      {step(5, 'Router après le module 4 — 2 routes', <><strong>Route « image prête »</strong> : filtre <code>data.data.state</code> égal à <code>success</code>, puis les étapes 6 à 10. <strong>Route « échec »</strong> (sans filtre) : un HTTP POST vers <code>{'{{1.callbackUrl}}'}</code>, en-tête <code>Authorization: Bearer VOTRE_MOT_DE_PASSE</code>, corps <code>{'{"publicationId":"{{1.publicationId}}","status":"failed","error":"Image non générée"}'}</code>.</>)}
      {step(6, 'JSON › Parse JSON (route « image prête »)', <>Champ « JSON string » = <code>data.data.resultJson</code> du module 4. Structure de données : générez-la avec l’exemple <code>{'{"resultUrls":["https://exemple.com/image.png"]}'}</code>. L’URL de l’image est ensuite <code>resultUrls</code> (1er élément).</>)}
      {step(7, 'HTTP › Make a request — rappel « image prête »', <>POST <code>{'{{1.callbackUrl}}'}</code>, en-tête <code>Authorization: Bearer VOTRE_MOT_DE_PASSE</code>, corps <code>{'{"publicationId":"{{1.publicationId}}","status":"images_ready","images":["URL_IMAGE"]}'}</code>. La plateforme affiche alors « Visuels prêts ».</>)}
      {step(8, 'Router — 4 routes, une par réseau', <>LinkedIn, Instagram, Facebook, X. Filtre de chaque route : <code>{'{{1.networks.linkedin}}'}</code> (puis <code>instagram</code>, <code>facebook</code>, <code>x</code>) égal à <code>true</code>. Un réseau désactivé dans les réglages est ainsi sauté.</>)}
      {step(9, 'LinkedIn, Instagram, X : HTTP › Buffer', <>Réutilisez le module Buffer qui fonctionne déjà ailleurs et changez seulement trois valeurs : <code>channelId</code>, le texte (<code>{'{{1.content.escaped.linkedin}}'}</code>, puis <code>instagram</code>, <code>x</code>) et l’URL de l’image. Modèle de corps :<Code>{BUFFER_BODY}</Code>Pour <strong>Instagram</strong>, ajoutez aussi dans <code>input</code> :<Code>{BUFFER_IG}</Code></>)}
      {step(10, 'Facebook : module natif « Facebook Pages › Create a Photo »', <>Pas besoin de Buffer. Choisissez la Page, source de la photo « URL » = l’URL de l’image, message = <code>{'{{1.content.captions.facebook}}'}</code> (ici le texte NON protégé, pas <code>escaped</code>).</>)}
      {step(11, 'Dans chaque route : HTTP › rappel du résultat', <>POST <code>{'{{1.callbackUrl}}'}</code>, en-tête <code>Authorization: Bearer VOTRE_MOT_DE_PASSE</code>, corps (adaptez <code>network</code>) :<Code>{CALLBACK_NET}</Code>Pour Facebook, sans module Buffer : <code>{'{"publicationId":"{{1.publicationId}}","results":[{"network":"facebook","status":"published"}]}'}</code>. Quand les 4 réseaux ont répondu, la publication passe à « Publié », « Partiel » ou « Échec ».</>)}
    </ol>
  )
}
