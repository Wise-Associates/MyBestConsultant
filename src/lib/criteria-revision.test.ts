import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CRITERIA_REVISION_PROMPT, RevisionInputSchema, criteriaChanges, criteriaRevisionRequest, parseCriteriaRevision } from './criteria-revision'
import { criteriaSetProblem, defaultCriteriaSet, type OfferCriteriaSet } from './offer-criteria'

// Offre fictive.
const OFFER = { title: 'Développeur Java', description: 'Le client cherche un développeur Java pour ses paiements.', skills: ['Java', 'Spring'], location: 'Lyon', experience: '' }
const current = (): OfferCriteriaSet => defaultCriteriaSet(OFFER)

/** Réponse de l'IA : les critères actuels, modifiés par `edit`. */
function answer(edit: (criteres: { id: string; nom: string; poids: number; libelles: { libelle: string; poids: number; requis: boolean }[] }[]) => void, extra: object = {}) {
  const criteres = current().criteria.map(c => ({ id: c.id, nom: c.name, poids: c.weight, libelles: c.labels.map(l => ({ libelle: l.label, poids: l.weight, requis: l.required })) }))
  edit(criteres)
  return `Voici : ${JSON.stringify({ reponse: 'Kafka ajouté, requis.', criteres, autres_intitules: [], ...extra })}`
}

describe('assistant des critères (ADR 0062)', () => {
  it('demande : offre, critères actuels en JSON, échange puis demande ; consigne sans nom d’entreprise', () => {
    const request = criteriaRevisionRequest(OFFER, { criteria: current(), message: 'Kafka indispensable', history: [{ role: 'recruteur', text: 'Bonjour' }, { role: 'assistant', text: 'Bonjour !' }] })
    assert.match(request, /^=== OFFRE ===\nTitre : Développeur Java\n/)
    assert.match(request, /=== CRITÈRES ACTUELS ===\n\{"criteres":\[\{"id":"poste","nom":"Intitulé","poids":33,/)
    assert.match(request, /=== ÉCHANGE PRÉCÉDENT ===\nRecruteur : Bonjour\nAssistant : Bonjour !\n\n=== DEMANDE DU RECRUTEUR ===\nKafka indispensable$/)
    assert.match(CRITERIA_REVISION_PROMPT, /Aucun nom d'entreprise, de client ni de personne/)
    assert.match(CRITERIA_REVISION_PROMPT, /"langue" \(Langue\)/)
  })

  it('applique les critères rendus : libellé ajouté, poids des libellés ramenés à 100, phrase de l’IA', () => {
    const result = parseCriteriaRevision(answer(cs => {
      cs[3].libelles.push({ libelle: 'Kafka', poids: 50, requis: true })
    }), current())
    assert.ok(result)
    assert.equal(result.reply, 'Kafka ajouté, requis.')
    assert.equal(criteriaSetProblem(result.criteria), null)
    const techno = result.criteria.criteria.find(c => c.id === 'competences')
    assert.deepEqual(techno?.labels.map(l => [l.label, l.required]), [['Java', false], ['Spring', false], ['Kafka', true]])
    assert.equal(techno?.labels.reduce((s, l) => s + l.weight, 0), 100)
    assert.deepEqual(criteriaChanges(current(), result.criteria), [{ id: 'competences', name: 'Compétences', kind: 'labels' }])
  })

  it('critère du barème ajouté et critère créé ; total des critères faux ramené à 100 en proportion', () => {
    const result = parseCriteriaRevision(answer(cs => {
      cs.push({ id: 'langue', nom: 'Peu importe', poids: 10, libelles: [{ libelle: 'Anglais courant', poids: 100, requis: true }] })
      cs.push({ id: 'disponibilite', nom: 'Disponibilité : ASAP', poids: 10, libelles: [] })
    }), current())
    assert.ok(result)
    const ids = result.criteria.criteria.map(c => [c.id, c.name])
    assert.deepEqual(ids.slice(-2), [['langue', 'Langue'], ['x1', 'Disponibilité ASAP']])
    assert.equal(result.criteria.criteria.reduce((s, c) => s + c.weight, 0), 100)
    assert.deepEqual(criteriaChanges(current(), result.criteria).map(c => [c.id, c.kind]), [
      ['poste', 'weight'], ['localisation', 'weight'], ['niveau', 'weight'], ['competences', 'weight'], ['domaine', 'weight'], ['langue', 'added'], ['x1', 'added'],
    ])
  })

  it('critère retiré par « retires », autres intitulés ; poste borné à 4 métiers ; doublons écartés', () => {
    const result = parseCriteriaRevision(answer(cs => {
      cs[0].libelles = Array.from({ length: 6 }, (_, i) => ({ libelle: `Métier ${i}`, poids: 20, requis: i === 0 }))
      cs.push({ ...cs[1] })
    }, { retires: ['domaine', 'inconnu'], autres_intitules: ['Ingénieur Java', 'ingénieur java', ''] }), current())
    assert.ok(result)
    assert.equal(result.criteria.criteria.find(c => c.id === 'poste')?.labels.length, 4)
    assert.deepEqual(result.criteria.criteria.map(c => c.id), ['poste', 'localisation', 'niveau', 'competences'])
    assert.deepEqual(result.criteria.alternativeTitles, ['Ingénieur Java'])
    const kinds = criteriaChanges(current(), result.criteria).map(c => [c.id, c.kind])
    assert.deepEqual(kinds.filter(([, k]) => k !== 'weight'), [['poste', 'labels'], ['domaine', 'removed']])
  })

  it('critères non rendus gardés : une réponse avec le seul Intitulé ne retire rien (petit modèle, 2026-11-26)', () => {
    const only = JSON.stringify({ reponse: 'J’ai ajouté les compétences.', criteres: [{ id: 'poste', nom: 'Intitulé', poids: 100, libelles: [{ libelle: 'Développeur Java', poids: 100, requis: true }] }] })
    const result = parseCriteriaRevision(only, current())
    assert.deepEqual(result?.criteria.criteria.map(c => c.id), current().criteria.map(c => c.id))
    assert.equal(result?.criteria.criteria.reduce((s, c) => s + c.weight, 0), 100)
    assert.deepEqual(result && criteriaChanges(current(), result.criteria).filter(c => c.kind === 'removed'), [])
  })

  it('poids demandé gardé exactement, les autres se partagent le reste ; libellés absents : ceux d’avant', () => {
    const reply = JSON.stringify({ reponse: 'Compétences à 40.', criteres: [{ id: 'competences', poids: 40 }] })
    const result = parseCriteriaRevision(reply, current())
    const weights = Object.fromEntries(result?.criteria.criteria.map(c => [c.id, c.weight]) ?? [])
    assert.deepEqual(weights, { poste: 28, localisation: 12, niveau: 10, competences: 40, domaine: 10 })
    assert.deepEqual(result?.criteria.criteria.find(c => c.id === 'competences')?.labels, current().criteria.find(c => c.id === 'competences')?.labels)
  })

  it('un critère créé rendu sans nom garde son nom actuel', () => {
    const withCustom: OfferCriteriaSet = { ...current(), criteria: [...current().criteria.slice(0, 4), { id: 'x1', name: 'Expérience bancaire', weight: 12, labels: [] }] }
    const reply = JSON.stringify({ reponse: 'ok', criteres: withCustom.criteria.map(c => ({ id: c.id, poids: c.weight, libelles: [] })) })
    const result = parseCriteriaRevision(reply, withCustom)
    assert.equal(result?.criteria.criteria.find(c => c.id === 'x1')?.name, 'Expérience bancaire')
    assert.deepEqual(result && criteriaChanges(withCustom, result.criteria).filter(c => c.kind === 'removed'), [])
  })

  it('réponse sans critères, illisible ou invalide : null ; sans phrase : « Critères mis à jour. »', () => {
    assert.equal(parseCriteriaRevision('Je ne peux pas.', current()), null)
    assert.equal(parseCriteriaRevision(JSON.stringify({ reponse: 'Rien.' }), current()), null)
    // Rien d'utilisable dans « criteres » : les critères restent tels quels.
    const unknown = parseCriteriaRevision(JSON.stringify({ criteres: [{ id: 'inconnu' }] }), current())
    assert.deepEqual(unknown?.criteria, current())
    // Tout retirer : refusé (un critère au moins).
    assert.equal(parseCriteriaRevision(JSON.stringify({ criteres: [], retires: current().criteria.map(c => c.id) }), current()), null)
    const same = parseCriteriaRevision(answer(() => undefined, { reponse: '' }), current())
    assert.equal(same?.reply, 'Critères mis à jour.')
    assert.deepEqual(same && criteriaChanges(current(), same.criteria), [])
  })

  it('entrée du navigateur : critères valides, demande bornée, échange limité aux derniers messages', () => {
    const ok = RevisionInputSchema.safeParse({
      criteria: current(), message: '  Kafka indispensable  ',
      history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'recruteur', text: `m${i}` })),
    })
    assert.ok(ok.success)
    assert.equal(ok.data.message, 'Kafka indispensable')
    assert.equal(ok.data.history.length, 12)
    assert.equal(ok.data.history[0].text, 'm8')
    assert.equal(RevisionInputSchema.safeParse({ criteria: current(), message: 'x'.repeat(1001), history: [] }).success, false)
    assert.equal(RevisionInputSchema.safeParse({ criteria: { ...current(), criteria: [] }, message: 'Kafka', history: [] }).success, false)
    assert.equal(RevisionInputSchema.safeParse({ criteria: current(), message: 'Kafka', history: [{ role: 'system', text: 'x' }] }).success, false)
  })
})
