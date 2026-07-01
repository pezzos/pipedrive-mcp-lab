# Fake Prospect Mailbox Workflow Prompt

- version: v1
- last_updated: 2026-06-17
- purpose: disposable live validation of the Pipedrive-only email preparation workflow

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Fais un test live Pipedrive-only avec un faux prospect
utilisant l'adresse `alexandre.pezzotta@gmail.com`.

Objectif :
- Creer un faux prospect jetable.
- Creer une activite de suivi liee a ce prospect.
- Tester la surface Mailbox Pipedrive disponible.
- Preparer un premier email pour ce prospect sans utiliser Gmail directement.
- Persister le contenu prepare dans Pipedrive sous forme de note et d'activite.

Contraintes importantes :
- N'utilise aucun outil Gmail, SMTP, Microsoft Graph ou fournisseur mail direct.
- N'essaie pas d'envoyer un email.
- N'essaie pas de creer un vrai brouillon email si aucun outil Pipedrive officiel
  `draft`, `send` ou `reply` n'existe dans le MCP.
- Le resultat attendu cote email est un texte pret a copier dans Pipedrive, plus une
  note Pipedrive et une activite "envoyer email".
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets crees doivent commencer par le prefixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple
  `MCP LAB - 2026-06-17 - MAILBOX-<hhmm>`.
- Pour les ecritures reelles, utilise uniquement `dry_run=false` et
  `confirm_lab_write=true`.
- N'utilise pas `PIPEDRIVE_WRITE_CONFIRMATION`.
- Utilise `validate_links=true` pour les appels qui referencent `person_id`,
  `org_id`, `deal_id` ou `lead_id`.
- Nettoie tous les objets jetables crees en fin de test, sauf si l'utilisateur demande
  explicitement de les conserver.

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
     le scenario CRM/prospect sans lecture mailbox.
4. Confirme dans le rapport qu'aucun outil Pipedrive `draft`, `send` ou `reply` n'a ete
   utilise.

Scenario :
1. Organisation optionnelle
- Cree une organisation :
  `MCP LAB - 2026-06-17 - MAILBOX-<hhmm> - Org`
- Relis-la.

2. Prospect
- Cree une personne :
  `MCP LAB - 2026-06-17 - MAILBOX-<hhmm> - Alexandre Test`
- Email principal : `alexandre.pezzotta@gmail.com`
- Lie-la a l'organisation si l'organisation a ete creee.
- Relis la personne et verifie que l'email est present sans recopier le payload complet.

3. Deal ou lead support
- Cree un deal jetable lie a la personne :
  `MCP LAB - 2026-06-17 - MAILBOX-<hhmm> - Premier contact email`
- Relis le deal.

4. Activite initiale
- Cree une activite liee au deal et a la personne :
  - subject: `MCP LAB - 2026-06-17 - MAILBOX-<hhmm> - Preparer premier email`
  - type: `task`
  - note: une phrase courte indiquant que le prospect sert au test Mailbox Pipedrive-only.
- Relis l'activite.

5. Lecture mailbox contextuelle
- Si `pipedrive_mailbox_probe` a reussi :
  - Appelle `pipedrive_list_mail_threads` avec `folder=inbox`, `limit=1`.
  - Si un thread pertinent existe pour ce prospect, relis-le avec
    `pipedrive_get_mail_thread`.
  - Si un message pertinent existe, relis-le avec `pipedrive_get_mail_message` et
    `include_body=false`.
  - Ne copie aucun sujet, adresse, snippet ou corps dans le rapport.
- Ne lie pas un thread reel au deal sauf si le thread est explicitement identifie comme
  jetable et lie au faux prospect. Si ce n'est pas certain, saute
  `pipedrive_link_mail_thread`.

6. Preparation du mail
- Redige dans ta reponse un email de premier contact en francais, pret a copier dans
  Pipedrive :
  - To: `alexandre.pezzotta@gmail.com`
  - Subject: `Premier contact - test Pipedrive`
  - Body: court, professionnel, indique clairement que c'est un test jetable.
- Ne cree pas de brouillon email reel.

7. Persistance du contenu prepare
- Cree une note liee au deal avec un contenu de ce format :
  `Draft email - Premier contact - test Pipedrive`
  puis les champs `To`, `Subject`, `Body`.
- Cree une activite liee au deal et a la personne :
  - subject: `MCP LAB - 2026-06-17 - MAILBOX-<hhmm> - Envoyer email test`
  - type: `email` si ce type existe dans `pipedrive_list_activity_types`, sinon `task`
  - note: `Contenu du mail prepare dans la note <note_id>.`
- Relis la note et l'activite.

Cleanup obligatoire :
- Supprime les activites creees.
- Supprime la note creee.
- Supprime le deal cree.
- Supprime la personne creee.
- Supprime l'organisation creee si elle existe.
- Si une suppression est bloquee par l'API, indique l'erreur exacte sans payload complet.

Rapport attendu en francais :

## Verdict
- Validation : complete / partielle / bloquee
- Mailbox probe : ok / blocked / skipped
- Vrai brouillon email cree : non
- Email envoye : non
- Cleanup : complet / partiel / bloque

## Objets Jetables
| Type | ID | Nom/titre synthetique | Cree | Relu | Supprime | Notes |

## Email Prepare
- To:
- Subject:
- Body:

## Resultats
| Etape | Resultat | Notes |

## Limites
- La v1 Pipedrive-only ne cree pas de vrai brouillon email et n'envoie pas d'email.
- Le contenu prepare doit etre colle/envoye via Pipedrive UI pour beneficier du suivi
  Pipedrive, sauf ajout futur d'un endpoint officiel de draft/send/reply.

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.
```
