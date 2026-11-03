# 0024 — « CV format cabinet » : contenu du CV recopié mot pour mot, identité anonymisée

- Statut : accepté
- Date : 2026-11-02
- Modifie : 0009 (export au format ESN)

## Contexte

Essai du 2026-11-02 sur un CV du vivier général (`/recruiter/vivier?vue=general`), modèle « version courte » de Wise
Associates. Comparé au CV d'origine, le document généré résumait le contenu au lieu de le reprendre :

- profil réécrit en trois paragraphes (le troisième fabriqué à partir de la formation), noms des clients et chiffres du
  profil perdus, rubriques de compétences raccourcies, tableau « Environnement technique » absent ;
- **3 réalisations gardées sur 5 à 9 par expérience**, ligne de contexte (« Direction Data et Digital ») perdue,
  intitulé recomposé en « Équipe / programme — Rôle » ;
- **années inventées** : « Master … (2012) », chaque certification « (2020) », alors que le CV n'en donne aucune, et
  « [À COMPLÉTER] » à la place d'un établissement que le CV ne cite pas.

Causes, toutes dans les consignes de l'IA (`prompt.ts`) : l'exemple de la réponse JSON contenait des valeurs réalistes
(`"annees": "2012"`, `"annee": "2020"`, `"Janv 2021 – Aujourd'hui"`…) que le modèle recopiait quand le CV n'en avait
pas ; la consigne demandait un résumé de « 2 ou 3 paragraphes courts » (§3 : diplôme), de « reformuler en phrases
courtes », des mois abrégés et des rôles « Équipe / programme — Rôle ».

Demande de l'utilisateur (2026-11-02) : le nom du candidat reste anonymisé, le contenu du CV est recopié mot pour mot
dans le modèle.

## Décision

- **Copie mot pour mot**, dans les deux anonymisations : profil (chaque paragraphe), dates telles qu'écrites (durée
  comprise), intitulé du poste, ligne de contexte, chaque puce, environnement, toutes les rubriques de compétences
  (tableaux compris, une ligne = un élément avec son libellé), formations et certifications telles qu'écrites (une ligne
  qui en cite plusieurs = un élément par certification). Ni résumé, ni reformulation, ni correction. Seule exception :
  l'anonymisation, inchangée (initiales calculées par le code, coordonnées, données personnelles et personnes citées
  retirées ; en renforcée, clients et employeurs remplacés).
- Années, établissement, organisme : seulement s'ils sont écrits. « [À COMPLÉTER] » réservé à la date et au client
  d'une expérience, et à la durée d'expérience.
- Exemple JSON aux valeurs neutres (« … »), testé (`prompt.test.ts`).
- Traduction phrase par phrase, mois traduits sous la même forme (complète ou abrégée), durées traduites.
- La consigne de cartographie des modèles (`template-mapping.ts`) parle d'une liste de paragraphes de résumé, plus de
  « 2 ou 3 ».
- **Anonymisation standard = identité du candidat seulement** (2026-11-03). Essai : export standard bloqué sur
  « CNEP », « Groupe Crédit Agricole », « LOCAM », « Groupe SANOFI » : l'IA les gardait dans le dossier (à juste titre)
  mais les rangeait aussi parmi ses `termes_identifiants`, que le contrôle des fuites cherche. Désormais :
  - consigne standard : clients, employeurs, écoles et organismes conservés partout (rubrique « Références clients »
    comprise) et jamais dans les termes d'identité ; « références » à retirer = personnes de référence et leurs
    coordonnées ;
  - contrôle des fuites (`leakTerms`, `leak-check.ts`) : en standard, nom, e-mail et téléphone du candidat connus sans
    l'IA (fiche du candidat ou nom du CV du vivier, exigé avant l'export), plus tout e-mail, téléphone ou lien absent
    du modèle ; les termes de l'IA ne sont cherchés qu'en renforcée (clients et employeurs remplacés).
- **Référence de résultat** (consigne donnée jusqu'ici à la main, 2026-11-03) : « Anonymiser mais mettre le logo de
  Wise Associates et non celui de MBC. Comme initiales tu mets M.H. Tu ne modifies rien, au format Word. N'oublie pas
  les informations de David. » Logo et contact du commercial viennent du modèle de l'organisation, initiales du code,
  contenu recopié. Le même jour :
  - **Compétences** : les lignes d'une rubrique répétaient son titre (« IT & FINANCE CERTIFICATIONS : » trois fois),
    conséquence de la consigne « titre de la rubrique s'il n'a pas de libellé ». Une ligne garde son propre libellé
    (« Finance & Risk: … »), les lignes sans libellé d'une rubrique forment un élément (séparées par « ; »), et le code
    le garantit quelle que soit la réponse (`groupRepeatedSkills`, appliqué à l'extraction, avant la traduction).
  - **Traduction partielle** : l'exemple JSON portait `"langue": "fr"` (même défaut que les années), et la langue
    annoncée par l'IA décide de ce qui est traduit ; la consigne de traduction gardait aussi tels quels les « noms
    d'équipes ou de programmes » (lignes de contexte, libellés de compétences). Désormais exemple neutre, langue lue
    par le code dans les phrases du CV (`dominantLang`, mots-outils propres à chaque langue ; celle de l'IA si le texte
    ne tranche pas), tout traduit sauf noms d'entreprises, d'écoles et d'organismes, outils, sigles et intitulés de
    certifications, et phrases restées dans la langue d'origine comptées au compte rendu (`untranslatedCount`), sans
    nouvel appel d'IA.
  - **Texte du modèle** : « Votre interlocuteur : » restait en français dans la version anglaise (zone conservée, hors
    en-têtes) : libellé `contact` réécrit par `fixed` dans les cartographies de Wise Associates et de l'exemple, et
    règle donnée à l'IA pour les modèles déposés. Au dépôt, refus d'une cartographie qui fait disparaître le téléphone
    ou l'e-mail du contact du modèle, ou qui laisse un libellé anglais dans la version française (modèle rédigé en
    anglais). Les cartographies déjà enregistrées ne sont pas revérifiées : redéposer le modèle pour en profiter.

## Conséquences

- Un CV long donne une réponse de l'IA plus longue qu'avant (plus rien n'est résumé) : la limite de 16 000 jetons peut
  être atteinte plus tôt (« CV trop long pour une seule réponse » : exporter une seule langue).
- Les versions déjà enregistrées ont été générées avec les anciennes consignes et peuvent être résumées : les régénérer.
- La fidélité repose sur la consigne : aucun contrôle automatique ne compare le dossier au CV (le texte d'un PDF coupe
  les lignes, et les rubriques du modèle réordonnent le contenu). Le recruteur relit le document, comme avant.
- Écart avec la skill `cv-esn-anonymise`, qui demande encore un résumé : à reporter si la skill doit produire la même
  copie.
- Les cartographies `templates/wise-associates/` et `templates/example/` diffèrent désormais de celle de la skill
  `cv-esn-anonymise` (libellé `contact`) : à reporter dans la skill.
- Un intitulé de fonction du contact (« Directeur Associé ») reste tel qu'écrit dans le modèle, dans les deux langues.
- En standard, le contrôle ne vérifie plus ce que seule l'IA connaît (rue de l'adresse, société créée par le
  candidat sans son nom, variante du nom absente de la fiche) : ces éléments sont retirés par la consigne, sans second
  contrôle. Acceptable pour cette anonymisation, qui laisse déjà clients, dates et intitulés visibles (le candidat
  peut être retrouvé sur LinkedIn) ; la renforcée garde le contrôle complet.
