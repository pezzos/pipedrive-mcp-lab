---
name: pipedrive-add-activity
description: Use when the user asks in natural language to add, schedule, plan, or log a Pipedrive activity such as a task, follow-up, call, meeting, deadline, or email to do for a contact, company, deal, lead, or project.
---

# Pipedrive Add Activity

Use this skill for requests like "ajoute une relance demain pour Jean", "prévois un appel avec Acme vendredi", "mets un mail à faire sur l'affaire Dupont", or "planifie une réunion avec ce prospect".

## Interpret The Request

Map French CRM language to Pipedrive records:

- contact, personne, interlocuteur -> person
- société, entreprise, compte, client -> organization
- affaire, opportunité, deal -> deal
- prospect -> lead, or person when the user clearly means an individual contact
- tâche, relance, suivi, appel, réunion, mail à faire, deadline -> activity

Infer the activity type conservatively:

- relance, suivi, tâche -> task
- appel, coup de fil -> call
- réunion, rendez-vous, visio -> meeting
- mail, email à faire, réponse à envoyer -> email
- date limite, échéance -> deadline

If the type, target, or due date is ambiguous, ask a short clarification before writing.

## Resolve Targets

Search before writing. Resolve the referenced person, organization, deal, lead, or project with read-only tools. If there are multiple matches, present a short disambiguation list with names and IDs. Do not write against an ambiguous record.

If a dictated name fails to match, use the Pipedrive dictation alias workflow before giving up.

## Write Safely

Use `pipedrive_create_activity`.

Always:

1. Build the activity with linked IDs: `person_id`, `org_id`, `deal_id`, `lead_id`, or project-related context when available.
2. Call the tool first with `dry_run=true` and `validate_links=true` when links are present.
3. Show the proposed subject, type, date/time, note, and linked records.
4. Ask for explicit approval before calling again with `dry_run=false`.

Never create a live activity without previewing the dry-run result.
