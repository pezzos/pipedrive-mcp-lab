# API Mapping Notes

This document records the Pipedrive API mappings used by `pipedrive-mcp`. It is
not a complete Pipedrive API contract.

## Scope

- Evidence source: mocked stdio tests and prior controlled Pipedrive validation.
- Coverage limit: product line items, pagination, rate-limit behavior, Mailbox
  draft/send/reply, file upload/download, reports, automations, webhooks, OAuth
  refresh flows, and remote hosting remain outside this mapping note.
- Safety: customer CRM payloads should not be copied into tests or docs.

## Person Email And Phone

The MCP accepts simple user-facing fields for person create/update:

- `email`
- `phone`
- `emails`
- `phones`

For Pipedrive v2 person writes, simple `email` and `phone` are mapped into array
payloads:

```json
{
  "emails": [{ "value": "person@example.invalid", "primary": true, "label": "work" }],
  "phones": [{ "value": "+33100000000", "primary": true, "label": "work" }]
}
```

## Mailbox v1

The MCP exposes Pipedrive Mailbox as a read/link surface only when writes and
Mailbox tools are both enabled. It does not create drafts, send email, or reply
to email because the documented Mailbox API does not provide a reliable endpoint
for those operations.

Current tool mapping:

- `pipedrive_mailbox_probe` calls `GET /api/v1/mailbox/mailThreads` with
  `folder=inbox`, `start=0`, and `limit=1`, then returns only response shape
  metadata.
- `pipedrive_list_deal_mail_messages` calls
  `GET /api/v1/deals/{id}/mailMessages`.
- `pipedrive_list_mail_threads` calls `GET /api/v1/mailbox/mailThreads`.
- `pipedrive_get_mail_thread` calls `GET /api/v1/mailbox/mailThreads/{id}`.
- `pipedrive_list_mail_thread_messages` calls
  `GET /api/v1/mailbox/mailThreads/{id}/mailMessages`.
- `pipedrive_get_mail_message` calls `GET /api/v1/mailbox/mailMessages/{id}` and
  maps `include_body` to Pipedrive's `0`/`1` query value.
- `pipedrive_link_mail_thread` calls `PUT /api/v1/mailbox/mailThreads/{id}` with
  a form-encoded body containing exactly one of `deal_id` or `lead_id`.

Mailbox reads may return sensitive email metadata or body content. Body reads
require `include_body=true`; the default is `false`. Some Pipedrive accounts may
require `PIPEDRIVE_ACCESS_TOKEN` with Mailbox scopes instead of an API token.
This MCP accepts externally supplied OAuth tokens but does not obtain or refresh
them.

## Activity Person Links

The MCP keeps `person_id` as the user-facing input for activity writes, then maps
it to activity participants:

```json
{
  "participants": [{ "person_id": 123, "primary": true }]
}
```

## Email Activities

The MCP supports Pipedrive email activities through `pipedrive_create_activity`.
Pass `type: "email"` and put the draft body or operator instructions in `note`.
Link the activity with one or more of `person_id`, `deal_id`, `org_id`, or
`lead_id`.

This creates a Pipedrive activity, not a Mailbox draft. Mailbox draft creation is
not implemented because the documented Mailbox API does not provide a reliable
create-draft endpoint.

## Lead Value

The MCP accepts a flat lead value input:

- `value`
- `currency`

For lead create/update, the value is mapped to Pipedrive's amount/currency
object:

```json
{
  "value": { "amount": 100, "currency": "EUR" }
}
```

Rules kept by the MCP:

- A lead must link to `person_id` or `organization_id`.
- If `value` is provided, `currency` is required.

## Organization Address

Organization `address` is not part of the write schema. Reintroduce it only after
a focused validation identifies the exact expected payload shape and readback
behavior for the target account.

## Product Line Items

The MCP has mocked coverage for product and deal-product endpoints, including
`pipedrive_add_product_to_deal`. Product line item behavior still depends on the
target account having products available.

## Projects

Project endpoints are beta in Pipedrive's API surface. The MCP exposes read
tools for boards, phases, templates, project fields, projects, and archived
projects, plus write tools for project create/update/archive/delete when writes
and delete tools are enabled as appropriate.

Current stance:

- `pipedrive_create_project` requires `title`, `board_id`, and `phase_id`.
- `template_id`, project `status`, and `health_status` are intentionally not
  part of the first write schema.
- Project `custom_fields` stay nested under the `custom_fields` object:

```json
{
  "title": "Implementation Project",
  "board_id": 1,
  "phase_id": 2,
  "custom_fields": {
    "project_field_hash": "value"
  }
}
```

Unlike deal/person/organization writes, project custom fields are not spread into
the top-level payload.

## Project Tasks

Task endpoints are beta and tasks must be linked to a project. The MCP exposes
task read tools plus task create/update/delete tools.

Current stance:

- `pipedrive_create_task` requires `title` and `project_id`.
- `assignee_id` is supported; `assignee_ids` is intentionally excluded.
- `done` and `milestone` are accepted as booleans in MCP inputs. The MCP maps
  those public booleans to the effective beta API write fields:

```json
{
  "is_done": true,
  "is_milestone": false
}
```

- Task read responses are normalized back to the MCP vocabulary: `is_done`
  becomes `done`, and `is_milestone` becomes `milestone`.
- Milestone tasks require a due date. The MCP rejects `milestone=true` without a
  `due_date` on create. Update requires either a `due_date` in the payload or one
  already present on the task.
- Project-plan v1 move endpoints are out of scope.
