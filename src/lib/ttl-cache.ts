// Petit cache en mémoire du processus, par clé, à durée de vie et borné en taille ; heure injectée (testé dans
// ttl-cache.test.ts). Une seule instance de l'application sert la production (VPS) : chaque instance a le sien.

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>()

  constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

  get size(): number {
    return this.entries.size
  }

  /** Valeur gardée depuis moins de `ttlMs`, sinon undefined (une valeur expirée est retirée). */
  get(key: string, now: number): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (now - entry.at >= this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V, now: number): void {
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      for (const [k, entry] of this.entries) if (now - entry.at >= this.ttlMs) this.entries.delete(k)
    }
    // Toujours plein : la plus ancienne valeur part (une Map garde l'ordre d'insertion).
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(key, { value, at: now })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }
}
