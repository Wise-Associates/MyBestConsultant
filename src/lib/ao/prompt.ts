// Consigne d'extraction des appels d'offres, partagée par l'import manuel (/api/admin/extract-jobs)
// et par la lecture automatique de la boîte ao@ (AO Offers).

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
- startDate: string (date de démarrage si précisée, ou "")
- experience: string (niveau d'expérience requis, ex: "5 ans minimum", ou "")

Réponds UNIQUEMENT avec un tableau JSON valide : [{ ... }, { ... }]
Aucun texte avant ou après. Aucun markdown. Juste le JSON brut.`

/** Précisions propres aux e-mails reçus sur la boîte AO (transferts, signatures, intermédiaires). */
export const AO_EMAIL_ADDENDUM = `
Le texte est un e-mail (corps + pièces jointes) reçu sur notre boîte dédiée aux appels d'offres :
- Ignore les signatures, mentions légales, historiques de transfert, publicités et messages sans rapport.
- companyName est le client final (l'entreprise où se déroule la mission), PAS la société qui envoie l'e-mail
  (ESN, cabinet, plateforme ou intermédiaire). Si le client final n'est pas nommé, mets "".
- N'inclus dans la description AUCUNE coordonnée : ni nom d'interlocuteur, ni e-mail, ni téléphone, ni lien.
- Une même offre présente à la fois dans le corps et dans une pièce jointe ne doit apparaître qu'une fois.
- Si le message ne contient aucune offre de poste ou de mission, réponds [].`
