---
name: pipedrive-add-note
description: Use when the user asks to add, record, save, or attach information, a note, a memo, a detail, or a meeting/call summary to a Pipedrive contact, company, deal, lead, or activity.
---

# Pipedrive Add Note

## Required Tooling

Requires Pipedrive MCP. Use only `pipedrive_*` tools. Do not use the official Pipedrive connector. If no `pipedrive_*` tools are available, stop and tell the user that the Pipedrive MCP connection must be configured before this skill can be used.

Use this skill for requests like "ajoute cette info sur Jean", "note ça sur Acme", "mets ce compte rendu sur l'affaire X", or "garde cette information sur ce prospect".

## Choose The Target

Map the user's words to the right Pipedrive object:

- contact, personne, interlocuteur -> person
- société, entreprise, compte, client -> organization
- affaire, opportunité, deal -> deal
- prospect -> lead, or person when clearly individual
- appel, réunion, tâche précise -> activity when the user refers to an existing activity

Search before writing. If there are multiple matches, ask the user to pick one. If no match is found, use the dictation alias workflow and ask whether to create a new record only when the user explicitly wants that.

## Preserve The User's Meaning

Do not turn narrative text into field updates. A sentence like "Jean est maintenant CEO" should become a note unless the user explicitly says to update the job title field.

Clean the note lightly for readability, but do not invent facts. Include dates or source context only when the user gave them or they are obvious from the current request.

## Write Safely

Use `pipedrive_create_note`.

Always:

1. Resolve the target record.
2. Call first with `dry_run=true` and `validate_links=true`.
3. Show the note content and linked record IDs.
4. Ask for explicit approval before calling again with `dry_run=false`.
