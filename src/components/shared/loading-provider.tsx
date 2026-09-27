'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { PageLoader } from './page-loader'

interface LoadingCtx {
  isLoading: boolean
  startLoading: (message?: string) => void
  stopLoading: () => void
  withLoading: <T>(fn: () => Promise<T>, message?: string) => Promise<T>
}

const Ctx = createContext<LoadingCtx>({
  isLoading: false,
  startLoading: () => {},
  stopLoading: () => {},
  withLoading: async (fn) => fn(),
})

export function useLoading() { return useContext(Ctx) }

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0)
  const [message, setMessage] = useState('Chargement…')
  const isLoading = count > 0

  const startLoading = useCallback((msg?: string) => {
    if (msg) setMessage(msg)
    setCount(n => n + 1)
  }, [])
  const stopLoading = useCallback(() => setCount(n => Math.max(0, n - 1)), [])

  const withLoading = useCallback(async <T,>(fn: () => Promise<T>, msg?: string): Promise<T> => {
    startLoading(msg)
    try { return await fn() }
    finally { stopLoading() }
  }, [startLoading, stopLoading])

  return (
    <Ctx.Provider value={{ isLoading, startLoading, stopLoading, withLoading }}>
      {children}
      {isLoading && <PageLoader message={message} />}
    </Ctx.Provider>
  )
}
