#!/usr/bin/env node
// `next dev` pour un réseau sans IPv6 ou éloigné du serveur Appwrite (npm run dev:local).
//
// Node.js laisse 250 ms à chaque tentative de connexion (IPv6 puis IPv4) : quand le serveur Appwrite
// répond en plus de 250 ms, toutes les requêtes échouent en « fetch failed (ETIMEDOUT) ». On porte ce
// délai à 2 s via NODE_OPTIONS, que `next dev` transmet à son serveur (même réglage que .claude/launch.json).
// Les arguments sont transmis tels quels : npm run dev:local -- --port 3001
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const FLAG = '--network-family-autoselection-attempt-timeout=2000'
const require = createRequire(import.meta.url)

const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, FLAG].filter(Boolean).join(' ') },
})

// Ctrl+C atteint aussi `next dev` : on attend qu'il s'arrête pour rendre la main avec son code de sortie.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
