/**
 * JSON d'une réponse de modèle (ADR 0057). À utiliser à la place de JSON.parse sur tout texte écrit par une IA.
 *
 * Même résultat que JSON.parse, avec une seule tolérance : des caractères de contrôle bruts (retour à la ligne,
 * tabulation…) dans une chaîne. Ministral 3 servi par vLLM en écrit là où Claude et GPT écrivent « \n », et
 * JSON.parse refuse alors une réponse complète (« Bad control character in string literal ») : questions
 * d'entretien, amélioration d'une offre, extraction des AO. Tout autre défaut (virgule en trop, réponse coupée) lève
 * l'erreur de JSON.parse sur le texte reçu, comme avant : rien n'est deviné.
 */
export function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    const repaired = escapeControlCharsInStrings(text)
    if (repaired === text) throw err
    try {
      const value: unknown = JSON.parse(repaired)
      // Trace de la réparation, pour voir quel volume elle rattrape et si un autre modèle s'y met ; jamais le texte, qui
      // contient des CV et des offres.
      console.warn('[ai] réponse JSON réparée : caractères de contrôle bruts dans une chaîne (ADR 0057)')
      return value
    } catch {
      // L'erreur d'origine : elle désigne le premier défaut du texte reçu, pas celui de la version réparée.
      throw err
    }
  }
}

const CONTROL_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' }

/**
 * Caractères de contrôle (U+0000 à U+001F) échappés à l'intérieur des chaînes JSON seulement : les espaces et retours à
 * la ligne entre les éléments restent tels quels. Un seul parcours du texte. Rien à échapper : le texte reçu.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  let changed = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!inString) {
      if (ch === '"') inString = true
    } else if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      inString = false
    } else if (ch.charCodeAt(0) < 0x20) {
      out += CONTROL_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
      changed = true
      continue
    }
    out += ch
  }
  return changed ? out : text
}
