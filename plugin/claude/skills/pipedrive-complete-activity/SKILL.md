---
name: pipedrive-complete-activity
description: Use when the user says an activity, task, call, meeting, reminder, follow-up, or email todo has been done, should be marked done, rescheduled, postponed, or updated in Pipedrive.
---

# Pipedrive Complete Activity

## Required Tooling

Requires Pipedrive MCP. Use only `pipedrive_*` tools. Do not use the official Pipedrive connector. If no `pipedrive_*` tools are available, stop and tell the user that the Pipedrive MCP connection must be configured before this skill can be used.

Use this skill for requests like "j'ai fait l'appel avec Jean", "marque cette relance comme faite", "l'email est parti", "reporte cette tâche à vendredi", or "mets à jour cette activité".

## Resolve The Activity

Find the open activity from the user's context:

- Search by person, organization, deal, lead, subject, type, and due date.
- Prefer open and overdue activities.
- If several activities match, present a shortlist and ask which one to use.

Do not mark an ambiguous activity as done.

## Choose The Operation

- Done/completed/finished -> `pipedrive_mark_activity_done`.
- Postpone/reschedule/change date -> `pipedrive_reschedule_activity`.
- Use `pipedrive_update_activity` only for completion support fields that are not covered by marking done or rescheduling. If the request is to compose or change email activity content, use the email activity workflow. If the request is a general field update unrelated to completion or rescheduling, use the update record workflow.

After completion, offer to create a follow-up when the completed activity is a call or meeting, or when the activity note mentions a pending commitment. Do not offer unprompted follow-ups for simple deadline or email activities.

## Write Safely

Always run the selected tool with `dry_run=true` first. Use `validate_links=true` when any linked record ID is present in the payload. Show the target activity ID, current subject/date, and proposed change. Execute with `dry_run=false` only after explicit approval.
