'use client'

import { createContext, useContext } from 'react'

// Identité du recruteur connecté (nom + entreprise), disponible dans tout /recruiter pour pré-remplir des
// messages (ex. modèles WhatsApp « Bonjour…, je suis {recruteur} de {entreprise} ») sans la faire descendre
// en props à travers chaque écran.
export interface RecruiterIdentity { name: string; company: string }

const Ctx = createContext<RecruiterIdentity>({ name: '', company: '' })

export const RecruiterIdentityProvider = Ctx.Provider
export const useRecruiterIdentity = () => useContext(Ctx)
