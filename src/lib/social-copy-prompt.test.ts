import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WISE_POLES, fallbackCopy, type JobLite } from './social-content'
import { SOCIAL_COPY_SYSTEM, parseSocialCopy, socialCopyPrompt } from './social-copy-prompt'

const job: JobLite = {
  id: 'j1', title: 'Architecte Cloud AWS', company: 'Entreprise exemple', location: 'Paris', skills: ['AWS', 'Terraform'],
  description: 'Conception d’une plateforme fictive.\n### Au programme\n- Migration des applications',
}

describe('socialCopyPrompt', () => {
  it('message de l’utilisateur : offre, entreprise, lieu, compétences et description, une ligne chacun', () => {
    assert.equal(socialCopyPrompt(job).user, [
      'Offre : Architecte Cloud AWS', 'Entreprise : Entreprise exemple', 'Lieu : Paris', 'Compétences : AWS, Terraform',
      'Description : Conception d’une plateforme fictive.\n### Au programme\n- Migration des applications',
    ].join('\n'))
    assert.equal(socialCopyPrompt({ ...job, company: '', location: '', skills: [], description: '' }).user, 'Offre : Architecte Cloud AWS\nEntreprise : \nLieu : \nCompétences : \nDescription : ')
  })

  it('consignes identiques pour toute offre, avec les pôles de Wise Associates', () => {
    assert.equal(socialCopyPrompt(job).system, SOCIAL_COPY_SYSTEM)
    assert.ok(SOCIAL_COPY_SYSTEM.startsWith('Tu es community manager d\'une plateforme de recrutement IT.'))
    assert.ok(SOCIAL_COPY_SYSTEM.includes(`exactement l'un de : ${WISE_POLES.join(', ')} ;`))
  })
})

describe('parseSocialCopy', () => {
  it('lit le JSON entouré de texte, garde un pôle connu et complète par le repli', () => {
    const copy = parseSocialCopy('Voici :\n{"hook":"Accroche","pole":"finance et conformite","hashtags":["Java"]}\nFin', job)
    assert.equal(copy.hook, 'Accroche')
    assert.equal(copy.pole, 'Finance et conformité')
    assert.deepEqual(copy.hashtags, ['Java'])
    assert.deepEqual(copy.missionBullets, fallbackCopy(job).missionBullets)
  })

  it('sans objet JSON : le repli', () => {
    assert.deepEqual(parseSocialCopy('Je ne peux pas répondre.', job), fallbackCopy(job))
  })

  it('lève sur un JSON illisible (generateCopy prend alors le repli)', () => {
    assert.throws(() => parseSocialCopy('{"hook": }', job))
  })
})
