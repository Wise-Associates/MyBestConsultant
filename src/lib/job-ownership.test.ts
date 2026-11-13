import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jobOwnership, planJobRecruiter, recruiterCanOpenJob, recruiterCanSeeApplication, type UserRef } from './job-ownership'

const author: UserRef = { $id: 'profil1', userId: 'auth1', tenantId: 'org1', role: 'recruiter' }
const colleague: UserRef = { $id: 'profil2', userId: 'auth2', tenantId: 'org1', role: 'recruiter' }
/** Recherche par profil, puis par compte Auth, comme le script. */
const find = (id: string) => [author, colleague].find(user => user.$id === id) ?? [author, colleague].find(user => user.userId === id)

describe('auteur et recruteur affecté d’une offre créée', () => {
  it('affecte l’offre à celui qui la crée : recruiterId === postedBy (profil)', () => {
    assert.deepEqual(jobOwnership({ $id: 'profil1' }), { postedBy: 'profil1', recruiterId: 'profil1' })
  })

  it('garde le recruteur affecté à l’appel d’offres publié', () => {
    assert.deepEqual(jobOwnership({ $id: 'profil1' }, 'profil2'), { postedBy: 'profil1', recruiterId: 'profil2' })
    assert.deepEqual(jobOwnership({ $id: 'profil1' }, ''), { postedBy: 'profil1', recruiterId: 'profil1' }, 'AO non affecté')
  })
})

describe('recruteur affecté d’une offre existante (script)', () => {
  it('affecte une offre sans recruteur à son auteur', () => {
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: 'profil1', recruiterId: '' }, find), { note: 'filled', recruiterId: 'profil1' })
  })

  it('convertit un compte Auth en profil, sans changer de recruteur', () => {
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: 'profil1', recruiterId: 'auth2' }, find), { note: 'converted', recruiterId: 'profil2' })
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: '', recruiterId: 'auth1' }, find), { note: 'converted', recruiterId: 'profil1' }, 'offre créée au tableau de bord')
  })

  it('garde une affectation déjà au bon format, même à un autre recruteur', () => {
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: 'profil1', recruiterId: 'profil2' }, find), { note: 'already' })
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: 'profil1', recruiterId: 'inconnu' }, find), { note: 'recruiter-unknown' })
  })

  it('n’affecte pas un auteur introuvable ou hors de l’organisation de l’offre', () => {
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: 'inconnu', recruiterId: '' }, find), { note: 'author-unknown' })
    assert.deepEqual(planJobRecruiter({ tenantId: 'org2', postedBy: 'profil1', recruiterId: '' }, find), { note: 'author-outside' }, 'offre déplacée')
    assert.deepEqual(planJobRecruiter({ tenantId: '', postedBy: 'profil1', recruiterId: '' }, find), { note: 'author-outside' }, 'offre de la plateforme')
    assert.deepEqual(planJobRecruiter({ tenantId: 'org1', postedBy: '', recruiterId: '' }, find), { note: 'unowned' })
  })
})

describe('offre ouverte par un recruteur (pipeline, Matching IA)', () => {
  it('offre de son organisation ou partagée par la plateforme', () => {
    assert.equal(recruiterCanOpenJob('org1', 'org1'), true)
    assert.equal(recruiterCanOpenJob('', 'org1'), true)
  })

  it('jamais l’offre d’une autre organisation, ni sans organisation', () => {
    assert.equal(recruiterCanOpenJob('org2', 'org1'), false)
    assert.equal(recruiterCanOpenJob('', ''), false)
    assert.equal(recruiterCanOpenJob('', null), false)
  })
})

describe('candidature vue par un recruteur (screening, entretiens, pipeline)', () => {
  it('voit toutes les candidatures des offres de son organisation', () => {
    assert.equal(recruiterCanSeeApplication('org1', 'org1', 'org1'), true)
    assert.equal(recruiterCanSeeApplication('org2', 'org2', 'org1'), false)
  })

  it('sur une offre partagée, voit les siennes et les candidatures directes, jamais celles d\'une autre organisation', () => {
    assert.equal(recruiterCanSeeApplication('', 'org1', 'org1'), true)
    assert.equal(recruiterCanSeeApplication('', '', 'org1'), true)
    assert.equal(recruiterCanSeeApplication('', 'org2', 'org1'), false)
    assert.equal(recruiterCanSeeApplication('', '', null), false)
  })
})
