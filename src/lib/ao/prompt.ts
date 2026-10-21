// Consigne d'extraction des appels d'offres, partagée par l'import manuel (/api/admin/extract-jobs)
// et par la lecture automatique des boîtes d'appels d'offres (AO Offers : plateforme et organisations).

export const AO_EXTRACTION_PROMPT = `Tu es un assistant expert en recrutement.
Tu reçois le texte brut d'un ou plusieurs appels d'offres / offres de mission.
Tu dois extraire TOUTES les offres distinctes que tu trouves dans ce texte.
Pour chaque offre, retourne un objet JSON avec les champs suivants (valeurs en français) :
- title: string (titre du poste)
- companyName: string (nom de l'entreprise cliente, ou "" si absent)
- location: string (ville/pays)
- contractType: "cdi" | "cdd" | "freelance" | "mission" (choisir le plus approprié)
- remote: "onsite" | "hybrid" | "remote"
- salary: number | null (tarif journalier en € ou salaire annuel brut — nombre uniquement, null si absent)
- skills: string[] (compétences clés, max 8)
- description: string (description complète et bien rédigée du poste, en markdown, 150-400 mots minimum — inclus contexte, missions, profil recherché)
- duration: string (durée de la mission si précisée, ex: "6 mois renouvelables", ou "")
- startDate: string (date de démarrage, seulement si le texte la présente comme telle : « démarrage », « début », « à partir du », « ASAP »… ; sinon "")
- deadline: string (date limite de réponse, de candidature ou de remise de l'offre si précisée, ou "")
- experience: string (niveau d'expérience requis, ex: "5 ans minimum", ou "")

Une date sans libellé en tête d'un récapitulatif, par exemple :
30/10/2026
Mission longue
480,00
Paris
5 ans et plus
est la date limite de réponse (deadline), jamais la date de démarrage.

Réponds UNIQUEMENT avec un tableau JSON valide : [{ ... }, { ... }]
Aucun texte avant ou après. Aucun markdown. Juste le JSON brut.`

/** Précisions propres aux e-mails reçus sur la boîte AO (transferts, signatures, intermédiaires). */
export const AO_EMAIL_ADDENDUM = `
Le texte est un e-mail (corps + pièces jointes) reçu sur notre boîte dédiée aux appels d'offres :
- Ne reprends dans les offres ni signatures, ni mentions légales, ni historiques de transfert, ni publicités.
- N'inclus dans la description AUCUNE coordonnée : ni nom d'interlocuteur, ni e-mail, ni téléphone, ni lien.
- Ajoute à chaque offre endClient : string (client final cité dans le texte, l'entreprise où se déroule la mission, ou "").
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
