---
name: pipedrive-next-action
description: Use when the user asks what to do next, how to follow up, how to prepare the next step, or which old/overdue Pipedrive tasks or activities should be handled first for a contact, company, deal, lead, or queue.
---

# Pipedrive Next Action

Use this skill for requests like "aide-moi à préparer la prochaine action pour Acme", "que dois-je faire avec Jean ?", "quelles relances sont les plus anciennes ?", or "prépare-moi la prochaine tâche sur cette affaire".

## Modes

Record-focused mode:

- The user names a person, organization, deal, or lead.
- Resolve that record, then inspect its context.

Queue mode:

- The user asks for old, overdue, pending, or priority tasks/activities.
- List open activities and tasks, focusing on earliest due dates and most overdue work first.

## Gather Context

Read before proposing action:

- Target person, organization, deal, or lead.
- Recent and open activities.
- Notes.
- Deal mail messages when available.
- Mailbox threads/messages only when Mailbox tools are enabled and the user explicitly asks for email context.
- Existing planned, overdue, or incomplete activities.

If Mailbox is not enabled, state that email context is not included.

## Recommend The Next Action

Summarize:

- What happened recently.
- What is planned.
- What is overdue or incomplete.
- The recommended next action and why.

If the next action is a follow-up email, use the Pipedrive email activity workflow to draft an email-as-activity. If the next action is a call, meeting, task, or deadline, use the Pipedrive add activity workflow.

This skill reads and recommends only. All writes must be performed by the appropriate write skill with dry-run preview and explicit approval.
