// Consigne d'extraction des appels d'offres, partagée par l'import manuel (/api/admin/extract-jobs)
// et par la lecture automatique des boîtes d'appels d'offres (AO Offers : plateforme et organisations).

export const AO_EXTRACTION_PROMPT = `Tu es un assistant expert en recrutement.
Tu reçois le texte brut d'un ou plusieurs appels d'offres / offres de mission.
Tu dois extraire TOUTES les offres distinctes que tu trouves dans ce texte.
Pour chaque offre, retourne un objet JSON avec les champs suivants (valeurs en français) :
- title: string (titre du poste)
- companyName: string (nom de l'entreprise cliente, ou "" si absent)
- location: string (ville/pays)
- contractType: "cdi" | "cdd" | "freelance" | "mission" (voir « Type de contrat » ci-dessous)
- remote: "onsite" | "hybrid" | "remote" ("hybrid" ou "remote" seulement si le texte parle de télétravail ; sinon "onsite")
- salary: number | null (tarif journalier en € ou salaire annuel brut — nombre uniquement, null si absent ; voir « Montant » ci-dessous)
- skills: string[] (compétences clés, max 8)
- technologies: string[] (technologies, langages, frameworks, outils et plateformes cités, ex. "Java", "React", "AWS", max 15 ; [] si aucun)
- engagement: "assistance" | "forfait" | "" (assistance : profil(s) facturé(s) à l'unité, en régie ou au TJM ; forfait : projet à prix global, engagement de résultat ; "" si le texte ne le dit pas)
- description: string (description complète et bien rédigée du poste, en markdown — contexte, missions, profil recherché —, 150-400 mots quand le texte le permet ; plus courte si le texte est bref, jamais complétée par ce qu'il ne dit pas)
- duration: string (durée de la mission si précisée, ex: "6 mois renouvelables", ou "")
- startDate: string (date de démarrage, SEULEMENT si le texte la désigne comme telle : « démarrage », « début », « à partir du », « ASAP »… ; sinon "")
- deadline: string (date limite de réponse, de candidature ou de remise de l'offre, SEULEMENT si le texte la désigne comme telle ; sinon "")
- otherDates: string[] (dates citées sans libellé qui dise s'il s'agit d'un démarrage ou d'une date limite, recopiées telles quelles avec le jour de la semaine s'il est écrit ; [] s'il n'y en a pas)
- experience: string (niveau d'expérience demandé par le texte, ex: "5 ans minimum" ou "Senior", sinon "" ; jamais un nombre d'années qu'il ne donne pas)

Règles :
- N'invente rien : chaque valeur vient du texte. Une information absente reste vide ("", null ou []) ; ne la déduis pas du titre, du secteur ni de ce qui est habituel pour ce genre de poste. Ville, compétences et technologies : seulement celles que cite le texte.
- Sois logique : les champs d'une même offre ne se contredisent pas (contrat, montant, durée, expérience).

Type de contrat (contractType) :
- "cdi" seulement si le texte parle de CDI, de poste permanent ou d'une embauche (poste salarié, salaire annuel) sans durée limitée.
- "cdd" seulement s'il parle de CDD ou d'alternance (apprentissage, contrat de professionnalisation).
- Sinon "freelance" ou "mission", le plus approprié ; "mission" si le texte ne dit rien du contrat.
- Un stage (stagiaire, internship, convention de stage) n'est jamais un CDI ni un CDD : mets "mission" et garde le mot « Stage » dans le titre.
- Une durée (« 6 mois renouvelables ») ne fait pas un CDD : une mission de prestation a aussi une durée.

Montant (salary), selon le contrat :
- "cdi" et "cdd" : salaire annuel brut (un salaire mensuel brut est multiplié par 12).
- "freelance" et "mission" : tarif journalier.
- null pour une gratification de stage, un montant dont tu ne sais pas s'il est journalier, mensuel ou annuel, ou qui n'est pas la rémunération du poste (budget, chiffre d'affaires).

Ne classe pas toi-même une date sans libellé, par exemple celle en tête d'un récapitulatif :
30/10/2026
Mission longue
480,00
Paris
5 ans et plus
Mets-la dans otherDates : elle est classée ensuite selon son jour de la semaine.

Réponds UNIQUEMENT avec un tableau JSON valide : [{ ... }, { ... }]
Aucun texte avant ou après. Aucun markdown. Juste le JSON brut.`

/** Précisions propres aux e-mails reçus sur la boîte AO (transferts, signatures, intermédiaires). */
export const AO_EMAIL_ADDENDUM = `
Le texte est un e-mail (corps + pièces jointes) reçu sur notre boîte dédiée aux appels d'offres :
- Ne reprends dans les offres ni signatures, ni mentions légales, ni historiques de transfert, ni publicités.
- N'inclus dans la description AUCUNE coordonnée : ni nom d'interlocuteur, ni e-mail, ni téléphone, ni lien (ils vont dans contact et sourceUrl).
- Ajoute à chaque offre endClient : string (client final cité dans le texte, l'entreprise où se déroule la mission, ou "").
- Ajoute à chaque offre contact : { name, role, email, phone } — l'interlocuteur du client pour cette offre : la personne qui signe l'appel d'offres d'origine, ou celle que le texte désigne comme contact. Chaque valeur recopiée telle qu'écrite dans le texte, "" si elle n'y est pas ; null s'il n'y a aucun interlocuteur. Jamais un collaborateur de notre organisation (celui qui transfère l'e-mail), jamais une adresse générique de désinscription.
- Ajoute à chaque offre sourceUrl : string — le lien vers l'annonce ou l'avis d'origine (« Avis officiel », « Offre en ligne », page de l'offre sur le site du client), recopié tel quel ; "" s'il n'y en a pas. Jamais un lien de désinscription, de réseau social, de signature ou de suivi.
- Une même offre présente à la fois dans le corps et dans une pièce jointe ne doit apparaître qu'une fois.
- Si le message ne contient aucune offre de poste ou de mission, réponds [].`

// Nom de l'organisation qui lit la boîte, saisi par elle : une ligne courte, sans guillemets (il entre dans la consigne).
const safeName = (name: string) => name.replace(/[\r\n"«»`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'notre organisation'

/**
 * Client = entreprise de l'expéditeur d'origine (règle métier, voir origin.ts) : seul le domaine de son adresse est
 * donné en tête du texte (moins de données personnelles confiées à l'IA). La valeur retenue pour l'e-mail est
 * recalculée ensuite (senderCompany).
 */
export function clientFromSender(orgName: string): string {
  return `
- companyName est l'entreprise de l'expéditeur d'origine, dont le domaine d'adresse est indiqué en tête du texte
  (« Domaine de l'expéditeur d'origine : ») : d'après sa signature, sinon d'après ce domaine (sauf messagerie grand
  public). Même valeur pour toutes les offres, même si le texte cite un client final (il va dans endClient). Jamais
  ${safeName(orgName)} (nous), qui ne faisons que transférer. Si tu ne peux pas la déterminer, mets "".`
}

/** Pas d'expéditeur d'origine connu (appel d'offres écrit par l'organisation) : le client est celui que cite le texte. */
export function clientFromText(orgName: string): string {
  return `
- companyName est le client cité dans le texte, jamais ${safeName(orgName)} (nous). S'il n'est pas nommé, mets "".`
}
