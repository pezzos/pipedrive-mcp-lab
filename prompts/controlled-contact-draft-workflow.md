# Controlled Contact Draft Workflow Prompt

- version: v1
- last_updated: 2026-06-19
- purpose: controlled live validation of a Pipedrive-only contact, new-mail draft probe, mailbox thread link, and prepared draft workflow

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Fais un test live controle avec un contact de test qui
represente Alexandre Pezzotta et l'adresse `alexandrepezotta@gmail.com`.

Objectif :
- Creer un contact de test, une organisation optionnelle, un deal et des activites.
- Tester d'abord si le MCP expose une creation de brouillon pour un nouveau mail
  Pipedrive.
- Si aucun outil officiel de brouillon n'existe, tester ensuite la Mailbox Pipedrive sur
  un thread email controle au sujet unique.
- Lier ce thread au deal uniquement si le sujet exact est retrouve.
- Lire un message sans body puis avec body uniquement sur ce thread controle.
- Preparer un brouillon de reponse ou de premier contact sous forme de contenu email
  pret a copier dans Pipedrive.
- Persister ce contenu dans Pipedrive avec une note et une activite email.
- Ne pas envoyer d'email.

Prerequis humain avant de lancer :
- Il doit exister dans la mailbox synchronisee Pipedrive un email jetable envoye :
  - depuis `alexandrepezotta@gmail.com`
  - vers la mailbox Pipedrive synchronisee `hello@pezzoslabs.com`
  - avec ce sujet exact :
    `MCP LAB - MAILBOX CONTROLLED DRAFT - alexandrepezotta@gmail.com`
- Si aucun thread avec ce sujet exact n'est trouve, ne lie aucun thread et ne lis aucun
  body email. Continue seulement le scenario CRM + brouillon prepare.

Contraintes importantes :
- N'utilise aucun outil Gmail, SMTP, Microsoft Graph ou fournisseur mail direct.
- N'utilise jamais d'outil `send` ou `reply` dans ce test.
- Tu peux utiliser un outil Pipedrive de creation de brouillon uniquement si un outil
  explicitement disponible dans le MCP indique qu'il cree un brouillon email Pipedrive
  sans l'envoyer.
- N'utilise aucun endpoint invente, aucun outil Gmail et aucun outil navigateur.
- N'essaie pas d'envoyer un email.
- Si aucun outil officiel de brouillon email Pipedrive n'est disponible, le
  "brouillon" attendu est le contenu email prepare + une note Pipedrive + une activite
  email.
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets crees doivent commencer par le prefixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple
  `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm>`.
- Pour les ecritures reelles, utilise uniquement `dry_run=false` et
  `confirm_lab_write=true`.
- N'utilise pas `PIPEDRIVE_WRITE_CONFIRMATION`.
- Utilise `validate_links=true` pour les appels qui referencent `person_id`, `org_id`,
  `deal_id` ou `lead_id`.
- Ne supprime pas un thread email et ne modifie pas ses flags read/archive/share.
- Ne lie pas un thread qui n'a pas le sujet exact controle.
- Cleanup : supprime les objets CRM jetables en fin de test, sauf si l'utilisateur
  demande explicitement de les conserver pour inspecter Pipedrive.

Preflight :
1. Appelle `pipedrive_health_check`.
2. Stoppe les ecritures reelles si un de ces points est faux :
   - `writes_enabled=true`
   - `lab_prefix_required=true`
   - `lab_write_confirmation_allowed=true`
   - `lab_prefix="MCP LAB -"`
3. Appelle `pipedrive_mailbox_probe`.
   - Si le probe reussit, note seulement `mailbox_probe=ok` et les noms de champs
     retournes, sans sujet, adresse, snippet ou corps d'email.
   - Si le probe echoue en permission/auth, note `mailbox_probe=blocked` et continue
     le scenario CRM + brouillon prepare sans lecture Mailbox detaillee.
4. Appelle `pipedrive_get_current_user` si l'outil est disponible.
   - Verifie synthetiquement si l'email utilisateur semble coherent avec l'adresse
     synchronisee attendue.
   - Ne conclus pas que la mailbox est mauvaise uniquement sur ce champ : Pipedrive peut
     synchroniser une adresse differente de l'email utilisateur. Utilise ce point comme
     indice de diagnostic si le thread controle reste introuvable apres pagination.
5. Verifie la surface d'outils disponible :
   - Si un outil Pipedrive de type `create_mail_draft`, `create_email_draft`,
     `create_draft_email`, `create_mail`, ou equivalent existe et annonce une creation
     de brouillon sans envoi, note `new_mail_draft_tool=available`.
   - Si aucun outil de ce type n'existe, note `new_mail_draft_tool=unavailable`.
   - Ne considere pas `pipedrive_create_activity` comme une creation de brouillon email.
6. Appelle `pipedrive_list_activity_types` et determine si le type `email` existe.
   - Si oui, utilise `type: "email"` pour l'activite d'envoi.
   - Sinon, utilise `type: "task"`.

Scenario CRM :
1. Organisation
- Cree une organisation :
  `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Org`
- Relis-la.

2. Contact
- Cree une personne :
  `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Alexandre Pezzotta Test`
- Email principal : `alexandrepezotta@gmail.com`
- Lie-la a l'organisation.
- Relis la personne et verifie synthetiquement que l'email principal est present.
- Ne copie pas le payload complet.

3. Deal
- Cree un deal lie a la personne et a l'organisation :
  `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Brouillon email controle`
- Relis le deal.

4. Activite de preparation
- Cree une activite liee au deal et a la personne :
  - subject: `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Preparer brouillon`
  - type: `task`
  - note: `Test controle de preparation de brouillon Pipedrive-only.`
- Relis l'activite.

Scenario brouillon nouveau mail :
1. Tentative de creation d'un nouveau brouillon Pipedrive
- Si `new_mail_draft_tool=available` :
  - Cree d'abord un brouillon de nouveau mail pour le contact, sans envoi.
  - To: `alexandrepezotta@gmail.com`
  - Subject: `MCP LAB - Nouveau brouillon Pipedrive - alexandrepezotta@gmail.com`
  - Body: court, professionnel, indique clairement qu'il s'agit d'un test jetable.
  - Lie le brouillon au deal/personne si l'outil le permet officiellement.
  - Relis le brouillon si un outil de lecture associe existe.
  - Ne l'envoie pas.
  - Note `vrai_brouillon_email_cree=oui` dans le rapport.
- Si `new_mail_draft_tool=unavailable` :
  - Ne tente aucune creation de brouillon email.
  - Note `vrai_brouillon_email_cree=non`.
  - Continue avec le scenario Mailbox controle puis la persistance note/activite.

Scenario Mailbox controle :
1. Recherche du thread controle
- Si `pipedrive_mailbox_probe` a reussi, cherche le sujet exact avec
  `pipedrive_list_mail_threads` dans cet ordre :
  - `folder=inbox`
  - `folder=sent`
  - `folder=archive`
  - `folder=drafts`
- Pour chaque dossier :
  - Utilise `limit=100`, `start=0`.
  - Si `additional_data.pagination.more_items_in_collection=true`, continue avec
    `start=next_start`.
  - Si `next_start` est absent mais que le nombre d'elements retournes vaut `limit`,
    continue avec `start=start+limit`.
  - Arrete seulement quand le sujet exact est trouve ou quand le dossier est epuise.
- Identifie un thread uniquement si son sujet est exactement :
  `MCP LAB - MAILBOX CONTROLLED DRAFT - alexandrepezotta@gmail.com`
- Dans le rapport, indique seulement `thread controle trouve: oui/non`, le dossier
  eventuel et le nombre de pages inspectees ; ne copie pas d'autre sujet de thread.

2. Lecture du thread et des messages
- Si le thread controle exact est trouve :
  - Appelle `pipedrive_get_mail_thread` pour ce thread.
  - Appelle `pipedrive_list_mail_thread_messages` pour ce thread.
  - Selectionne un message du thread.
  - Appelle `pipedrive_get_mail_message` avec `include_body=false`.
  - Puis appelle `pipedrive_get_mail_message` avec `include_body=true`.
  - Dans le rapport, ne copie pas le body complet ; indique seulement si le body est
    disponible et une longueur approximative.
- Si le thread controle exact n'est pas trouve :
  - Ne lis aucun body.
  - Ne lie aucun thread.

3. Liaison au deal
- Si et seulement si le thread controle exact est trouve :
  - Appelle `pipedrive_link_mail_thread` avec `mail_thread_id`, `deal_id`,
    `dry_run=true`, `validate_links=true`.
  - Si le dry-run est OK, appelle `pipedrive_link_mail_thread` avec
    `dry_run=false`, `confirm_lab_write=true`, `validate_links=true`.
  - Appelle `pipedrive_list_deal_mail_messages` sur le deal.
  - Verifie synthetiquement que le deal a au moins un mail associe ou que l'API renvoie
    une reponse coherent avec la liaison.

Preparation du contenu de brouillon :
- Redige un email en francais, pret a copier/envoyer via Pipedrive UI :
  - To: `alexandrepezotta@gmail.com`
  - Subject: `Re: MCP LAB - MAILBOX CONTROLLED DRAFT - alexandrepezotta@gmail.com`
    si un thread controle a ete trouve, sinon `Premier contact - test Pipedrive`
  - Body: court, professionnel, mentionne explicitement qu'il s'agit d'un test jetable
    Pipedrive-only sans envoi automatique.
- Si un vrai brouillon Pipedrive a deja ete cree, ne cree pas de second contenu
  concurrent ; resume seulement les champs du brouillon cree.
- Si aucun vrai brouillon Pipedrive n'a ete cree, prepare le contenu ci-dessous.
- Si un body controle a ete lu, utilise-le uniquement comme contexte de formulation ;
  ne le recopie pas dans le rapport.

Persistance du contenu prepare :
1. Si un vrai brouillon Pipedrive a ete cree, cree seulement une note courte liee au
   deal indiquant l'ID du brouillon et le fait qu'il n'a pas ete envoye.
2. Si aucun vrai brouillon Pipedrive n'a ete cree, cree une note liee au deal avec un
   contenu de ce format :
   `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Draft email`
   puis les champs `To`, `Subject`, `Body`, et une ligne `Thread linked: yes/no`.
3. Relis la note.
4. Cree une activite liee au deal et a la personne :
   - subject: `MCP LAB - 2026-06-18 - CONTROLLED-DRAFT-<hhmm> - Envoyer brouillon`
   - type: `email` si disponible, sinon `task`
   - note: `Brouillon prepare dans la note <note_id>.` ou
     `Vrai brouillon Pipedrive cree: <draft_id>.`
5. Relis l'activite.

Cleanup obligatoire :
- Supprime les activites creees.
- Supprime la note creee.
- Si aucun thread email reel n'a ete lie au deal, supprime le deal cree.
- Si un thread email reel a ete lie au deal, ne supprime pas le deal : conserve-le pour
  eviter de laisser le thread attache a un deal supprime. Note l'ID du deal conserve et
  marque le cleanup `partiel`.
- Supprime la personne creee uniquement si elle n'est plus necessaire au deal conserve.
- Supprime l'organisation creee uniquement si elle n'est plus necessaire au deal
  conserve.
- Ne supprime pas le thread email.
- Si une suppression est bloquee par l'API, indique l'erreur exacte sans payload complet.

Rapport attendu en francais :

## Verdict
- Validation : complete / partielle / bloquee
- Mailbox probe : ok / blocked / skipped
- Thread controle trouve : oui/non
- Thread lie au deal : oui/non/non tente
- Body lu avec `include_body=true` : oui/non/non tente
- Outil nouveau brouillon disponible : oui/non
- Vrai brouillon email cree : oui/non
- Email envoye : non
- Cleanup : complet / partiel / bloque
- Outils Pipedrive `draft`, `send`, `reply` utilises : non

## Objets Jetables
| Type | ID | Nom/titre synthetique | Cree | Relu | Supprime | Notes |

## Mailbox Controlee
| Etape | Resultat | Notes |

## Brouillon Nouveau Mail
- Outil utilise:
- Draft ID:
- Resultat:

## Contenu Prepare
- To:
- Subject:
- Body:

## Resultats
| Etape | Resultat | Notes |

## Limites
- Si aucun outil officiel de brouillon email Pipedrive n'est disponible, la v1
  Pipedrive-only ne cree pas de vrai brouillon email et n'envoie pas d'email.
- Dans ce cas, le contenu prepare doit etre colle/envoye via Pipedrive UI pour
  beneficier du suivi Pipedrive, sauf ajout futur d'un endpoint officiel de
  draft/send/reply.
- La liaison de thread est une mutation CRM/Mailbox reelle ; elle ne doit etre faite
  que sur le thread controle au sujet exact.

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.
```
