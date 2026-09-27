import { Client, Account, Databases, Storage, Users, Messaging } from 'node-appwrite'

export function createAdminClient() {
  const client = new Client()
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
  const client = new Client()
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
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)

  return { account: new Account(client) }
}
