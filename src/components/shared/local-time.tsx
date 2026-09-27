'use client'

import { useEffect, useState } from 'react'

/**
 * Date et heure d'un instant ISO, dans le fuseau horaire du NAVIGATEUR de l'utilisateur (le serveur tourne en UTC :
 * formater côté serveur afficherait une heure décalée et provoquerait une erreur d'hydratation). Rien n'est affiché
 * avant le montage, puis « 21 sept. 2026 à 14:32 ».
 */
export function LocalTime({ iso, className, style }: { iso: string; className?: string; style?: React.CSSProperties }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return
    const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    setText(`${day} à ${time}`)
  }, [iso])
  return <time dateTime={iso} className={className} style={style}>{text || '…'}</time>
}
