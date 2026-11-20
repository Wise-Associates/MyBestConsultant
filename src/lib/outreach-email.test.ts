import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { creatorReplyTo, escapeHtml, outreachEmailBody } from './outreach-email'

const base = {
  message: 'Bonjour Camille,\n\nUne mission pourrait vous intéresser.',
  jobUrl: 'https://exemple.test/jobs/job1',
  unsubscribeUrl: 'https://exemple.test/desabonnement?u=cand1',
  repliesToRecruiter: true,
}

describe('e-mail de prise de contact au candidat', () => {
  it('donne le lien vers la page publique de l\'offre, en bouton et en texte', () => {
    const html = outreachEmailBody(base)
    assert.match(html, /<a href="https:\/\/exemple\.test\/jobs\/job1"[^>]*>Postuler<\/a>/)
    assert.match(html, /Ou copiez ce lien : <a href="https:\/\/exemple\.test\/jobs\/job1"[^>]*>https:\/\/exemple\.test\/jobs\/job1<\/a>/)
  })

  it('garde un paragraphe par ligne du message et le lien de désabonnement', () => {
    const html = outreachEmailBody(base)
    assert.match(html, />Bonjour Camille,<\/p><p[^>]*>&nbsp;<\/p><p[^>]*>Une mission pourrait vous intéresser\.<\/p>/)
    assert.match(html, /href="https:\/\/exemple\.test\/desabonnement\?u=cand1"[^>]*>Se désabonner<\/a>/)
  })

  it('prévient que la réponse arrive chez le recruteur seulement quand elle y va', () => {
    assert.match(outreachEmailBody(base), /Répondez simplement à cet e-mail : votre réponse arrivera directement chez le recruteur/)
    assert.doesNotMatch(outreachEmailBody({ ...base, repliesToRecruiter: false }), /Répondez/)
  })

  it('échappe le message (rédigé par l\'IA ou modifié par l\'admin) et les adresses', () => {
    const html = outreachEmailBody({
      ...base,
      message: 'Salaire <b>élevé</b> & "remote"',
      jobUrl: 'https://exemple.test/jobs/job1"><script>',
    })
    assert.match(html, /Salaire &lt;b&gt;élevé&lt;\/b&gt; &amp; &quot;remote&quot;/)
    assert.doesNotMatch(html, /<b>|<script>/)
    assert.match(html, /href="https:\/\/exemple\.test\/jobs\/job1&quot;&gt;&lt;script&gt;"/)
  })

  it('échappe l\'objet repris en titre de l\'e-mail', () => {
    assert.equal(escapeHtml('Mission <img src=x> & "Data"'), 'Mission &lt;img src=x&gt; &amp; &quot;Data&quot;')
  })
})

describe('destinataire des réponses du candidat', () => {
  const profile = { firstName: 'Alex', lastName: 'Durand' }
  const active = { status: true, email: 'alex@exemple.test', emailVerification: true }

  it('les réponses vont au recruteur qui a créé l\'offre', () => {
    assert.deepEqual(creatorReplyTo(profile, active), { name: 'Alex Durand', address: 'alex@exemple.test' })
    assert.deepEqual(creatorReplyTo({ firstName: 'Alex' }, active), { name: 'Alex', address: 'alex@exemple.test' })
  })

  it('sinon à l\'expéditeur : compte supprimé, désactivé, sans adresse ou adresse non vérifiée', () => {
    assert.equal(creatorReplyTo(profile, { ...active, emailVerification: false }), null, 'adresse non vérifiée')
    assert.equal(creatorReplyTo(null, active), null, 'profil supprimé')
    assert.equal(creatorReplyTo(profile, null), null, 'compte supprimé')
    assert.equal(creatorReplyTo(profile, { ...active, status: false }), null, 'compte désactivé')
    assert.equal(creatorReplyTo(profile, { ...active, email: '' }), null, 'compte sans adresse')
  })
})
