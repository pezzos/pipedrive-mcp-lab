---
name: pipedrive-email-activity
description: Use when the user asks to draft, prepare, or update an email-like follow-up in Pipedrive as an activity linked to a person, company, deal, or lead.
---

# Pipedrive Email Activity

Use this skill when Claude must compose or refine the content of an email from CRM context. If the user already provided the full activity content and only wants it scheduled, use the Pipedrive add activity workflow instead.

This workflow creates or updates a Pipedrive activity of type `email`. It does not create a real Pipedrive Mailbox draft and it does not send email.

## Prepare The Draft

Resolve the target person, organization, deal, or lead. Read relevant notes, activities, and deal mail messages when available. Use Mailbox tools only when enabled and explicitly relevant.

Draft:

- subject
- recipient/context
- body or operator instructions in the activity note
- due date/time
- linked record IDs

Keep the tone ready for operator review. Do not claim that the email was sent.

## Write Safely

Use `pipedrive_create_activity` or `pipedrive_update_activity` with `type="email"`.

Always:

1. Call first with `dry_run=true` and `validate_links=true`.
2. Show the proposed subject, note/body, due date, and linked records.
3. Ask for explicit approval before calling again with `dry_run=false`.
