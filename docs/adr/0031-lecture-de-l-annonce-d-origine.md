# 0031 — Lecture de l'annonce d'origine des offres AO incomplètes

- Statut : accepté
- Date : 2026-11-12

## Contexte

La synchronisation des boîtes AO lit le corps de l'e-mail et ses pièces jointes, jamais les liens : l'IA recopie le
lien de l'annonce d'origine dans `sourceUrl` (vérifié présent tel quel dans l'e-mail, `keepCitedContact`), mais la
page n'est pas ouverte. Un e-mail d'alerte (« nouvelle offre : Développeur Java — voir l'offre ») donne donc une offre
presque vide. Demande du 2026-11-12 : ouvrir ce lien quand l'offre n'a pas les informations attendues, avec tous les
garde-fous.

N'importe qui peut écrire à une boîte AO : le lien est choisi par un tiers, et c'est **notre serveur** qui l'ouvre
(SSRF), puis notre IA qui lit la page (injection de consignes), à nos frais (quotas).

## Décision

Choix de l'utilisateur (2026-11-12) : tous les sites sauf une liste d'exclusion, robots.txt respecté ; lecture quand
la description est courte ou qu'il manque lieu, compétences ou expérience ; toutes les boîtes (plateforme et
organisations), avec quotas ; trace enregistrée et affichée sur l'offre.

1. **Quand** (`isIncomplete`, `source-page/rules.ts`) : offre extraite par l'IA (pas une ligne de tableau, pas la
   veille, dont les e-mails portent l'avis officiel), avec un lien, et description de moins de 500 caractères, ou
   lieu, compétences ou expérience absents. Pas pour une offre déjà enregistrée (doublon d'un autre e-mail, ou créée par un essai
   interrompu du même e-mail : elle ne serait pas modifiée).
2. **Quelles adresses** (`checkPageUrl`) : https seulement (un lien http est lu en https, jamais en clair), port
   standard, sans identifiants, nom de domaine (pas d'adresse IP), pas de lien de désinscription, cherché dans le site,
   le chemin et les paramètres (un GET suffit parfois à désinscrire la boîte), site non exclu : PLACE, Maximilien,
   marches-publics.info (reprise interdite sans autorisation écrite), achatpublic, Partenaire GC, Malt (comptes
   connectés), LinkedIn, Indeed (lecture automatique interdite), et les copies servies sous un autre nom (traducteur
   `translate.goog`, archives), sous-domaines compris (`BLOCKED_SITES`). Chaque redirection (3 au plus) est revérifiée.
3. **Réseau** (`source-page/fetch-page.ts`, `node:https` sans dépendance nouvelle) : toutes les adresses DNS du nom
   doivent être publiques (`isPublicAddress`, la règle des serveurs IMAP) et la connexion se fait à l'une d'elles,
   sans second DNS (`publicOnlyLookup`) ; robots.txt lu une fois par site et par passage (RFC 9309 : 4xx = aucune
   règle, injoignable ou 5xx = tout interdit ; agent `MBCAnnonceBot`) ; réponse 200 seulement, HTML ou texte, 3 Mo
   au plus **après décompression**, 15 s pour toute la lecture ; ni cookie ni identifiant envoyés ; page de connexion
   ou sans texte (JavaScript) ignorée. Aucun agent HTTP partagé.
4. **Texte confié à l'IA** (`source-page/page-text.ts`) : données JobPosting (schema.org) d'abord, puis le texte
   visible (sans scripts, styles, menus ni pied de page), 30 000 caractères au plus. **Calcul linéaire** : un parcours
   vers l'avant (indexOf), ni expression régulière à `[^>]*` ni analyseur HTML qui empile les balises. La revue de
   sécurité du 2026-11-12 a mesuré qu'une page hostile de 3 Mo (« <script » répété, compressé en 4 ko) figeait le
   serveur de 10 à 25 minutes avec sanitize-html et des expressions régulières ; `page-text.test.ts` vérifie que neuf
   formes de page hostile de 3 Mo se traitent en moins de 2 s (quelques dizaines de ms mesurées). Même consigne d'extraction que
   les e-mails, plus `AO_PAGE_ADDENDUM` : la page est entre délimiteurs (que la page ne peut pas imiter) et c'est une
   donnée, jamais une consigne ; même validation (`parseOffersJson`). Pas de contact repris d'une page.
5. **Complément** (`fillFromPage`) : l'offre de la page doit décrire le même poste (`pickPageOffer` : tous les mots
   distinctifs de l'intitulé le plus court, hors métier et niveau, se retrouvent dans l'autre — « Chef de projet SAP »
   n'est pas « Chef de projet Salesforce ») ;
   **seuls les champs vides** sont remplis, rien de ce que dit l'e-mail n'est remplacé. Description courte : celle de
   la page est ajoutée après. Contrat, télétravail, intitulé et client ne sont jamais repris (leur valeur par défaut ne
   se distingue pas d'une valeur dite par l'e-mail ; le client suit la règle de l'expéditeur, ADR 0004) ; montant
   seulement pour le même contrat. Le client, le client final et les autres noms du client lus sur la page (s'ils y
   sont cités, jamais notre organisation : `withPageClientNames`) rejoignent les noms **masqués à la publication**
   (`citedClients` calculé après le complément) : la description de la page peut les citer.
6. **Dédoublonnage inchangé** : l'empreinte est tirée de l'offre telle que l'e-mail la donne (`basis`), pour qu'une
   reprise de l'e-mail qui lirait l'annonce autrement retrouve l'offre déjà créée.
7. **Coût et temps** : 3 annonces au plus par e-mail ; 30 par organisation et 300 pour toutes les organisations par
   jour (places `takeDailySlotId`, compteurs `aoPageOrg` / `aoPageAll`) ; la boîte de la plateforme n'a que son quota
   de 30 (des organisations inscrites librement pourraient sinon épuiser le plafond commun) ; une lecture qui échoue
   compte. Une lecture n'est
   commencée que s'il reste 50 s au passage ; IA 20 à 60 s. **Jamais d'exception** : annonce illisible, refusée, hors
   délai ou IA indisponible = offre créée telle que l'e-mail la donne.
8. **Trace** : `ao_offer_details.pageFill` (JSON : date, site — « lien → site final » quand une redirection mène
   ailleurs —, statut `filled` / `unchanged` / `not_read`, champs complétés, raison ; 9/16 attributs ; jamais coupée au
   milieu du JSON, `pageFillJson`), affichée sous « Annonce d'origine » sur la page de l'offre (« Complété depuis
   l'annonce d'origine : lieu, compétences. À vérifier sur l'annonce avant de publier. », ou la raison de la non-lecture).
9. **Interrupteur** : `AO_SOURCE_PAGES_ENABLED=true`. Vide, rien ne change (aucune lecture, aucun attribut écrit). Lue
   au démarrage : la changer demande de relancer l'application (VPS : `mbc-deploy`, voir `docs/deploiement-vps.md` ;
   Vercel : redéploiement).
10. **Reprises** : une offre déjà enregistrée n'est pas relue ; ses détails et sa trace sont gardés, et les noms masqués
   de l'e-mail sont **fusionnés** avec ceux de l'essai précédent (`mergeCitedClients`), jamais remplacés : sinon les
   noms connus par la seule annonce disparaîtraient de la liste à masquer. Une offre complétée dont la trace n'a pas
   pu être écrite est retirée, et la reprise la recrée entière (sans trace, rien ne dirait qu'elle vient d'une page).

## Conséquences

- Mise en place, dans cet ordre, pour chaque projet (DEV puis production, production par un humain) :
  `npm run schema:push -- dev|prod` (attribut `pageFill`, vérifié « available » dans la console : `schema:check` ne voit
  pas l'état d'un attribut), déployer, **puis** `AO_SOURCE_PAGES_ENABLED=true` et relancer. Variable définie sans
  l'attribut : chaque offre complétée fait échouer son e-mail (« Unknown attribute ») et est retirée ; retirer la
  variable, relancer, puis « Réessayer ».
- Empreinte inchangée : tirée de l'offre de l'e-mail, elle n'inclut pas le lieu lu sur l'annonce. Un e-mail suivant
  qui donne la même offre avec son lieu ne sera pas reconnu comme doublon (comme avant cette décision).
- Une page lue peut induire l'IA en erreur sur un champ vide (texte trompeur, autre offre) : la trace dit quels champs
  viennent de la page, et la publication reste soumise à la relecture humaine (ADR 0013).
- Risque juridique résiduel sur les sites non listés : lecture ponctuelle d'un lien reçu, robots.txt respecté, contenu
  réécrit et anonymisé avant publication. Un site qui l'interdit s'ajoute à `BLOCKED_SITES`.
- Les sites qui chargent l'annonce en JavaScript ne sont pas lisibles (« page sans texte lisible ») : pas de
  navigateur côté serveur.
