// Unité du montant d'une offre (jobs.salary), fixée par le type de contrat : CDI et CDD, salaire annuel brut ;
// freelance, mission ou contrat non précisé, TJM. Décision du 2026-11-03 : la collection jobs n'a plus de place pour
// garder une unité choisie à part (16/16 attributs). Avant, la publication sur LinkedIn écrivait « €/mois » pour un CDI
// que la page de l'offre affichait en « €/an ». Formulaire de création, pages publiques, publications et affiche suivent
// cette règle ; pur, utilisable dans le navigateur, testé dans job-pay.test.ts.
//
// À l'affichage, l'unité doit aussi être vraisemblable pour le montant (payUnitOf) : une offre de production sans
// contrat, à 60 000 €, s'affichait « 60 000 €/j » (même jour). Un montant qui contredit son contrat prend la seule unité
// qui lui ressemble ; un montant entre les deux (salaire mensuel ?) est affiché sans unité plutôt qu'avec une fausse.

export type PayUnit = 'jour' | 'an'

/** Unité attendue pour un contrat (libellé du formulaire) : salaire annuel pour un CDI ou un CDD, TJM sinon. */
export function payUnitFor(contractType: string | null | undefined): PayUnit {
  return contractType === 'cdi' || contractType === 'cdd' ? 'an' : 'jour'
}

/** Montants vraisemblables : un TJM ne dépasse pas 3 000 €, un salaire annuel brut ne descend pas sous 10 000 €. */
const PLAUSIBLE: Record<PayUnit, (salary: number) => boolean> = {
  jour: salary => salary > 0 && salary <= 3000,
  an: salary => salary >= 10_000,
}

/**
 * Unité affichée pour un montant enregistré : celle du contrat si le montant lui ressemble, sinon la seule unité
 * vraisemblable pour ce montant (contrat absent ou contredit), sinon aucune (null : montant affiché sans unité).
 */
export function payUnitOf(salary: number, contractType: string | null | undefined): PayUnit | null {
  const expected = contractType ? payUnitFor(contractType) : null
  if (expected && PLAUSIBLE[expected](salary)) return expected
  return (['an', 'jour'] as const).find(unit => PLAUSIBLE[unit](salary)) ?? null
}

/** Libellé du champ « montant » du formulaire de création d'une offre. */
export const PAY_FIELD_LABEL: Record<PayUnit, string> = { jour: 'TJM (€/jour)', an: 'Salaire annuel brut (€/an)' }

// Espace simple pour les milliers : l'espace fine insécable de toLocaleString s'affiche mal sur certains réseaux.
const amountOf = (salary: number) => Math.round(salary).toLocaleString('fr-FR').replace(/\s/g, ' ')

/** Montant tel que publié (LinkedIn, Facebook, Instagram, X, affiche) : « TJM : 650 €/jour », « Salaire : 55 000 €/an ». */
export function payText(salary: number, contractType: string | null | undefined): string {
  const unit = payUnitOf(salary, contractType)
  if (unit === 'an') return `Salaire : ${amountOf(salary)} €/an`
  if (unit === 'jour') return `TJM : ${amountOf(salary)} €/jour`
  return `Rémunération : ${amountOf(salary)} €`
}

/** Montant de la liste des offres (/jobs) : « 650 €/jour », « 55 000 €/an », « 4 500 € » (unité invraisemblable). */
export function payListText(salary: number, contractType: string | null | undefined): string {
  const unit = payUnitOf(salary, contractType)
  return `${amountOf(salary)} €${unit === 'an' ? '/an' : unit === 'jour' ? '/jour' : ''}`
}

/** Montant court des pages et listes : « 650 €/j », « 55 000 €/an », « 4 500 € » (unité invraisemblable). */
export function payShort(salary: number, contractType: string | null | undefined): string {
  const unit = payUnitOf(salary, contractType)
  return `${amountOf(salary)} €${unit === 'an' ? '/an' : unit === 'jour' ? '/j' : ''}`
}

/**
 * Montant qui ne ressemble pas à son unité (un salaire annuel saisi pour une mission, un TJM pour un CDI) : averti dans
 * le formulaire, jamais refusé. Mêmes bornes qu'à l'affichage.
 */
export function payLooksWrong(salary: number, unit: PayUnit): boolean {
  return !PLAUSIBLE[unit](salary)
}

/** Montant saisi sans type de contrat : son unité serait devinée (TJM). Refusé à la création d'une offre. */
export const PAY_NEEDS_CONTRACT = 'Choisissez le type de contrat : il indique si le montant est un TJM (mission, freelance) ou un salaire annuel brut (CDI, CDD).'

/** Aide sous le champ « montant » du formulaire : l'unité retenue, ou un avertissement (`warning`) à corriger. */
export function payHint(salary: number | null, contractType: string | null | undefined): { text: string; warning: boolean } {
  if (!contractType) {
    return salary
      ? { text: PAY_NEEDS_CONTRACT, warning: true }
      : { text: 'Le type de contrat fixe l’unité : TJM pour une mission ou un freelance, salaire annuel brut pour un CDI ou un CDD.', warning: false }
  }
  const unit = payUnitFor(contractType)
  if (salary && payLooksWrong(salary, unit)) {
    const amount = salary.toLocaleString('fr-FR')
    return unit === 'jour'
      ? { text: `${amount} € par jour : s’agit-il d’un salaire annuel ? Choisissez alors CDI ou CDD.`, warning: true }
      : { text: `${amount} € par an : s’agit-il d’un TJM ? Choisissez alors Mission ou Freelance.`, warning: true }
  }
  return { text: `Publié comme ${unit === 'an' ? 'salaire annuel brut (€/an)' : 'TJM (€/jour)'}, sur l’offre et sur LinkedIn.`, warning: false }
}
