'use client'

import { useState, useTransition } from 'react'
import { Menu, ArrowUp, ArrowDown, X, Plus, Loader2, Check, AlertCircle, FileText, Code2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveNavLinks } from './actions'
import type { NavLink } from '@/types/layout'

interface AvailablePage extends NavLink {
  source: 'code' | 'cms'
}

interface Props {
  initialNavLinks: NavLink[]
  availablePages: AvailablePage[]
}

export function NavMenuManager({ initialNavLinks, availablePages }: Props) {
  const [navLinks, setNavLinks] = useState(initialNavLinks)
  const [toAdd, setToAdd] = useState('')
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const addedHrefs = new Set(navLinks.map(l => l.href))
  const pickable = availablePages.filter(p => !addedHrefs.has(p.href))

  function move(index: number, dir: -1 | 1) {
    setSaved(false)
    setNavLinks(list => {
      const next = [...list]
      const target = index + dir
      if (target < 0 || target >= next.length) return next
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function remove(href: string) {
    setSaved(false)
    setNavLinks(list => list.filter(l => l.href !== href))
  }

  function add() {
    const page = availablePages.find(p => p.href === toAdd)
    if (!page) return
    setSaved(false)
    setNavLinks(list => [...list, { href: page.href, label: page.label }])
    setToAdd('')
  }

  function save() {
    setError('')
    startTransition(async () => {
      const r = await saveNavLinks(navLinks)
      if ('error' in r) setError(r.error)
      else setSaved(true)
    })
  }

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.1] space-y-4">
      <div className="flex items-center gap-2">
        <Menu className="h-4 w-4 text-white/40" />
        <div>
          <h2 className="text-sm font-semibold text-white/80">Menu de navigation</h2>
          <p className="text-xs text-white/30">Pages affichées en haut du site, dans l&apos;ordre ci-dessous</p>
        </div>
      </div>

      {navLinks.length === 0 ? (
        <p className="text-xs text-white/25 py-2">Aucune page dans le menu.</p>
      ) : (
        <div className="space-y-1.5">
          {navLinks.map((link, i) => (
            <div key={link.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.07]">
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="text-white/25 hover:text-white/70 disabled:opacity-20 disabled:hover:text-white/25">
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === navLinks.length - 1}
                  className="text-white/25 hover:text-white/70 disabled:opacity-20 disabled:hover:text-white/25">
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/80 truncate">{link.label}</p>
                <p className="text-xs text-white/30 font-mono">{link.href}</p>
              </div>
              <button onClick={() => remove(link.href)}
                className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pickable.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select value={toAdd} onChange={e => setToAdd(e.target.value)}
            className="flex-1 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm px-3 outline-none">
            <option value="" className="bg-[#0a0c10]">Ajouter une page au menu…</option>
            {pickable.map(p => (
              <option key={p.href} value={p.href} className="bg-[#0a0c10]">
                {p.label} ({p.href}) — {p.source === 'cms' ? 'page créée' : 'page du site'}
              </option>
            ))}
          </select>
          <Button onClick={add} disabled={!toAdd} className="gap-1.5 bg-white/10 text-white/80 hover:bg-white/20 text-sm h-9">
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-[10px] text-white/20 pt-1">
        <Code2 className="h-3 w-3" /> page du site (créée en code)
        <span className="mx-1">·</span>
        <FileText className="h-3 w-3" /> page créée dans ce module
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={save} disabled={isPending} className="gap-2 bg-white text-black hover:bg-white/90 font-semibold text-sm h-9">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {isPending ? 'Enregistrement...' : 'Enregistrer le menu'}
        </Button>
        {saved && !isPending && <span className="text-xs text-emerald-400">Menu mis à jour</span>}
      </div>
    </div>
  )
}
