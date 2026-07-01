---
name: pipedrive-update-record
description: Use when the user explicitly asks to update a specific field or status on a Pipedrive contact, company, deal, lead, project, project task, note, or activity.
---

# Pipedrive Update Record

Use this skill only when the user clearly names the record and the field or status to change. Examples: "mets le poste de Jean à CEO", "change le téléphone de ce contact", "passe cette affaire en gagné", "mets cette tâche projet comme terminée".

Do not infer field updates from narrative information. If the user says "Jean est maintenant CEO" without asking to update the record, use the add note workflow instead.

## Resolve And Validate

Search for the target record before writing. If there are multiple matches, ask the user to choose. If no match is found, use the dictation alias workflow before suggesting creation.

For deals and leads, verify pipeline/stage/status changes carefully. For project tasks, respect milestone and due-date rules.

## Write Safely

Use the narrowest matching tool:

- `pipedrive_update_person`
- `pipedrive_update_organization`
- `pipedrive_update_deal`
- `pipedrive_move_deal_stage`
- `pipedrive_mark_deal_won`
- `pipedrive_mark_deal_lost`
- `pipedrive_update_lead`
- `pipedrive_update_project`
- `pipedrive_update_task`
- `pipedrive_update_note`
- `pipedrive_update_activity`

Always call first with `dry_run=true` and `validate_links=true` when links are present. Show old value when known, proposed new value, target record ID, and expected impact. Execute with `dry_run=false` only after explicit approval.

Never delete records from this skill.
