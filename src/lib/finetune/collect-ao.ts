import { createHash } from 'node:crypto'
import { Query } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllByValues, listAllDocuments } from '../appwrite/list-all'
import { cleanedAo, hiddenNamesOf, publicationAiRequest } from '../ao/ai-input'
import { CRITERIA_PROPOSAL_PROMPT, criteriaProposalRequest } from '../ao/criteria-proposal'
import { PUBLICATION_PROMPT } from '../ao/publication-copy'
import { docToAoEmail, storedContact } from '../ao/repo'
import { defaultCriteriaSet } from '../offer-criteria'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'

// Demandes des appels d'offres (ADR 0063) : version publique anonyme (« Préparer la publication ») et critères de
// matching proposés, construites comme offer-actions.ts : noms du client, des expéditeurs et de l'interlocuteur
// retirés du texte par hiddenNamesOf / cleanedAo / publicationAiRequest ; coordonnées restantes masquées. Les noms des
// clients (entreprises) restent dans la consigne « Clients à ne jamais citer », comme dans l'application.

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)

export async function collectAo(project: string, limits: { publication: number; criteria: number }): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const offers = (await listAllDocuments(databases, DB_ID, COLLECTIONS.AO_OFFERS, [Query.select(['$id', 'title', 'companyName', 'location', 'contractType', 'remote', 'salary', 'skills', 'description', 'duration', 'startDate', 'experience', 'emailId'])]))
    .filter(o => str(o.title).trim() && str(o.description).length >= 200)
    .sort((a, b) => hash(`ao:${project}:${a.$id}`) - hash(`ao:${project}:${b.$id}`))
    .slice(0, Math.max(limits.publication, limits.criteria))
  const [emails, details, sources] = await Promise.all([
    listAllByValues(databases, DB_ID, COLLECTIONS.AO_EMAILS, '$id', offers.map(o => str(o.emailId)), []),
    listAllByValues(databases, DB_ID, COLLECTIONS.AO_OFFER_DETAILS, '$id', offers.map(o => o.$id), [Query.select(['$id', 'contact'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.AO_SOURCES, [Query.select(['$id', 'ownDomains'])]),
  ])
  const emailById = new Map(emails.map(e => [e.$id, docToAoEmail(e)]))
  const contactById = new Map(details.map(d => [d.$id, storedContact(str(d.contact), d.$id)]))
  const domainsBySource = new Map(sources.map(s => [s.$id, Array.isArray(s.ownDomains) ? (s.ownDomains as string[]) : []]))

  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string) => {
    const s = (stats.tasks[task] ??= { kept: 0, skipped: {} })
    s.kept++
  }
  const items: DatasetItem[] = []
  offers.forEach((doc, i) => {
    const email = emailById.get(str(doc.emailId))
    const names = hiddenNamesOf({ companyName: str(doc.companyName), email, contact: contactById.get(doc.$id), ownDomains: domainsBySource.get(email?.sourceId ?? '') ?? [] })
    const offer = {
      title: str(doc.title), location: str(doc.location), duration: str(doc.duration), startDate: str(doc.startDate), experience: str(doc.experience),
      skills: Array.isArray(doc.skills) ? doc.skills.filter((s): s is string => typeof s === 'string') : [], description: maskLeftoverContacts(str(doc.description)),
    }
    const group = `ao:${textKey(`${offer.title}\n${offer.description}`)}`
    if (i < limits.publication) {
      const user = publicationAiRequest(offer, names.clients, names.names)
      items.push({ id: itemId('ao-publication', textKey(user)), group, project, system: PUBLICATION_PROMPT, messages: [{ role: 'user', content: user }], ctx: { task: 'ao-publication' } })
      note('ao-publication')
    }
    if (i < limits.criteria) {
      const ao = cleanedAo(offer, names.names)
      const user = criteriaProposalRequest(ao)
      items.push({ id: itemId('ao-criteria', textKey(user)), group, project, system: CRITERIA_PROPOSAL_PROMPT, messages: [{ role: 'user', content: user }], ctx: { task: 'ao-criteria', fallback: defaultCriteriaSet(ao) } })
      note('ao-criteria')
    }
  })
  return { items, stats }
}
