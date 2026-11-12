import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractionPrompt, translationPrompt } from './prompt'
import type { AnonymizationMode } from './types'

const MODES: AnonymizationMode[] = ['standard', 'renforcee']

describe('extractionPrompt', () => {
  it('ne montre aucune valeur réaliste en exemple : l\'IA recopiait « 2012 », « 2020 » et la langue « fr »', () => {
    for (const mode of MODES) assert.doesNotMatch(extractionPrompt(mode), /"(annees|annee|experience|dates|langue)": "[^…"]/, mode)
  })

  it('compétences : un libellé par ligne qui en a un, une rubrique sans libellés regroupée, jamais un libellé répété', () => {
    const prompt = extractionPrompt('standard')
    assert.match(prompt, /commence par son propre libellé/)
    assert.match(prompt, /un seul élément, "categorie" = le titre de la rubrique/)
    assert.match(prompt, /Jamais le même "categorie" sur deux éléments qui se suivent/)
  })

  it('demande la copie mot pour mot du CV, sans résumé, avec l\'identité du candidat anonymisée', () => {
    for (const mode of MODES) {
      const prompt = extractionPrompt(mode)
      assert.match(prompt, /mot pour mot/, mode)
      assert.match(prompt, /ni résumé/, mode)
      assert.match(prompt, /Seule exception : l'anonymisation/, mode)
      assert.match(prompt, /Retirer : prénom, nom/, mode)
    }
  })

  it('garde les clients en anonymisation standard, sans les compter parmi les termes d\'identité ; les remplace en renforcée', () => {
    const standard = extractionPrompt('standard')
    assert.match(standard, /seule l'identité du candidat est retirée/)
    assert.match(standard, /Conserver tels quels, partout, les noms des clients, des employeurs/)
    assert.match(standard, /jamais un nom gardé dans le dossier/)
    assert.match(extractionPrompt('renforcee'), /Anonymisation renforcée/)
    assert.match(extractionPrompt('renforcee'), /clients et des employeurs remplacés/)
  })

  it('garde ce qui n\'a pas de champ à soi : sous-titres des réalisations, contexte entier, contrat, intitulé complet (2026-11-12)', () => {
    for (const mode of MODES) {
      const prompt = extractionPrompt(mode)
      assert.match(prompt, /sous-titre qui regroupe les puces suivantes est un élément à part, précédé de « ## »/, mode)
      assert.match(prompt, /toutes ses phrases/, mode)
      assert.match(prompt, /type de contrat ou le statut écrit à côté/, mode)
      assert.match(prompt, /la plus complète/, mode)
    }
    assert.match(translationPrompt('en'), /commence par « ## » \(sous-titre\) garde ce début/)
  })

  it('« références » désigne les personnes de référence, pas les références clients', () => {
    for (const mode of MODES) assert.match(extractionPrompt(mode), /personnes de référence et leurs coordonnées/, mode)
  })
})

describe('translationPrompt', () => {
  it('traduit tout le dossier : seuls les noms, outils, sigles et certifications restent tels quels', () => {
    assert.match(translationPrompt('en'), /Tout le dossier est traduit/)
    assert.match(translationPrompt('en'), /Aucun passage ne reste en français/)
    assert.match(translationPrompt('fr'), /Aucun passage ne reste en anglais/)
    assert.match(translationPrompt('fr'), /Restent tels quels seulement/)
    assert.doesNotMatch(translationPrompt('en'), /noms d'équipes ou de programmes/)
  })

  it('traduit sans résumer et garde la forme des dates', () => {
    assert.match(translationPrompt('en'), /ni résumé/)
    assert.match(translationPrompt('en'), /même forme/)
    assert.match(translationPrompt('fr'), /même forme/)
  })
})
