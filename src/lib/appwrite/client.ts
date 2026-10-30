import { Client, Account, Databases, Storage, Users, Messaging } from 'node-appwrite'
import { createAgent } from 'node-fetch-native-with-agent/agent'

// node-appwrite 15 crée un nouvel agent HTTP à chaque requête (Client.prepareRequest) : chaque appel ouvrait une nouvelle
// connexion, poignées de main TCP et TLS comprises. Mesuré le 2026-10-30 sur DEV depuis un poste éloigné du serveur :
// ~750 ms par appel, ~255 ms en réutilisant la connexion. Un seul agent par serveur Appwrite, partagé par tous les
// clients du processus (et d'une invocation à l'autre tant qu'une fonction Vercel reste chaude). Même bibliothèque et
// même version que node-appwrite (dépendance directe épinglée) ; node-appwrite est figé en v15 (serveur 1.7.4) : à
// revérifier si le SDK change.
const agents = new Map<string, ReturnType<typeof createAgent>>()

function sharedAgent(endpoint: string, selfSigned: boolean): ReturnType<typeof createAgent> {
  const key = `${endpoint}|${selfSigned}`
  let agent = agents.get(key)
  if (!agent) {
    agent = createAgent(endpoint, { rejectUnauthorized: !selfSigned })
    agents.set(key, agent)
  }
  return agent
}

/** Client node-appwrite qui garde ses connexions ouvertes (voir plus haut). */
class KeepAliveClient extends Client {
  prepareRequest(...args: Parameters<Client['prepareRequest']>): ReturnType<Client['prepareRequest']> {
    const prepared = super.prepareRequest(...args)
    return { ...prepared, options: { ...prepared.options, ...sharedAgent(this.config.endpoint, this.config.selfSigned) } }
  }
}

export function createAdminClient() {
  const client = new KeepAliveClient()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!)

  return {
    account: new Account(client),
    databases: new Databases(client),
    storage: new Storage(client),
    users: new Users(client),
    messaging: new Messaging(client),
  }
}

export function createSessionClient(sessionToken: string) {
  const client = new KeepAliveClient()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setSession(sessionToken)

  return {
    account: new Account(client),
    databases: new Databases(client),
    storage: new Storage(client),
  }
}

// No key, no session — for the handful of Account endpoints (email/recovery
// verification confirmation) that Appwrite only exposes to unauthenticated
// "guest" callers. Calling these via an API key fails with a scope error
// no key permission can grant.
export function createGuestClient() {
  const client = new KeepAliveClient()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)

  return { account: new Account(client) }
}
