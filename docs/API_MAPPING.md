# API Mapping Notes

This file records live mapping lessons discovered while validating the lab against a
configured Pipedrive account on 2026-05-24. It is not a complete Pipedrive API contract
and should not be treated as production coverage.

## Scope

- Evidence source: disposable lab-prefixed live records plus mocked stdio tests.
- Live target: a configured Pipedrive account, not independently verified as sandbox or
  trial.
- Safety: no customer CRM payloads are copied here.
- Coverage limit: product line items, pagination, rate-limit behavior, Pipedrive email
  draft/send/reply, files, reports, automations, webhooks, OAuth refresh flows and
  remote hosting remain outside this mapping note.

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
  "emails": [{ "value": "mcp-lab@example.invalid", "primary": true, "label": "work" }],
  "phones": [{ "value": "+33100000000", "primary": true, "label": "work" }]
}
```

Live result: person create/update accepted email and phone through this mapping. The
reporting layer redacts email and phone fields.

## Mailbox v1

The MCP exposes Pipedrive Mailbox as a Pipedrive-only read/link surface. It does not
create drafts, send email or reply to email because the documented Mailbox API does not
provide those endpoints.

Current tool mapping:

- `pipedrive_mailbox_probe` calls `GET /api/v1/mailbox/mailThreads` with
  `folder=inbox`, `start=0`, and `limit=1`, then returns only response shape metadata
  such as top-level keys and field names.
- `pipedrive_list_mail_threads` calls `GET /api/v1/mailbox/mailThreads` with
  `folder`, `start`, and `limit`. Folder is limited to `inbox`, `drafts`, `sent`, or
  `archive`; `drafts` is read-only here.
- `pipedrive_get_mail_thread` calls `GET /api/v1/mailbox/mailThreads/{id}`.
- `pipedrive_list_mail_thread_messages` calls
  `GET /api/v1/mailbox/mailThreads/{id}/mailMessages`.
- `pipedrive_get_mail_message` calls `GET /api/v1/mailbox/mailMessages/{id}` and maps
  boolean `include_body` to Pipedrive's `0`/`1` query value.
- `pipedrive_link_mail_thread` calls `PUT /api/v1/mailbox/mailThreads/{id}` with an
  `application/x-www-form-urlencoded` body containing exactly one of `deal_id` or
  `lead_id`. Real lab writes may use `confirm_lab_write=true`, but the linked deal or
  lead is read first and must satisfy the lab-prefix guard before the mailbox thread is
  linked.

`PUT /api/v1/mailbox/mailThreads/{id}` is treated only as an existing-thread metadata
update path. It requires a known thread ID in the URL and the MCP sends only link fields
there; it is not a draft or thread creation path. The MCP does not expose or implement a
`POST /api/v1/mailbox/mailThreads` equivalent, and reading `folder=drafts` only proves
that Pipedrive drafts can be listed, not that they can be created through the documented
Mailbox API.

Current safety stance:

- Mailbox reads may return sensitive email metadata or body content. Body reads require
  `include_body=true`; the default is `false`.
- The probe intentionally does not return subjects, addresses, snippets or bodies.
- Dry-run payload redaction covers common Mailbox fields including `body`, `body_html`,
  `body_url`, `snippet`, `subject`, `from_address`, `to_address`, `from_email`,
  `to_email`, `cc`, `bcc`, `reply_to`, `sender`, `recipients` and `attachments`.
- Thread linking excludes `shared_flag`, `read_flag`, `archived_flag` and thread delete
  operations in this v1.

Auth note: the client accepts either `PIPEDRIVE_API_TOKEN` via `x-api-token` or
`PIPEDRIVE_ACCESS_TOKEN` via `Authorization: Bearer`. Run the mailbox probe against the
target account before relying on Mailbox tools; if API-token access is rejected, provide
an OAuth access token with the needed Mailbox scope.

## Activity Person Links

The initial direct `person_id` activity payload was not reliable because Pipedrive
treated `person_id` as read-only in the observed v2 activity write path.

The MCP keeps `person_id` as the user-facing input, then maps it to activity
participants:

```json
{
  "participants": [{ "person_id": 123, "primary": true }]
}
```

Live result: activity create/update/mark-done/read/delete passed with `person_id`
mapped through `participants`.

## Lead Value

The MCP accepts a flat lead value input:

- `value`
- `currency`

For lead create/update, the value is mapped to Pipedrive's amount/currency object:

```json
{
  "value": { "amount": 100, "currency": "EUR" }
}
```

Rules kept by the MCP:

- A lead must link to `person_id` or `organization_id`.
- If `value` is provided, `currency` is required.

Live result: linked lead create/update/read/delete passed with value and currency.

## Organization Address

Organization `address` was removed from the MCP write schema after live retest because
the v2 organization write behavior was not reliable enough for this lab surface.

Current lab stance:

- Create/update organizations by lab-prefixed `name`.
- Do not claim live support for organization address writes.
- Reintroduce address only after a focused live test identifies the exact expected
  payload shape and readback behavior.

## Product Line Items

The MCP has mocked coverage for product and deal-product endpoints, including
`pipedrive_add_product_to_deal`.

Live result: product line item write was not tested because `pipedrive_list_products`
returned zero products in the configured account. The lab should not claim live product
line item coverage until a disposable product exists and the write/readback path is
validated.

## Projects

Project endpoints are beta in Pipedrive's API surface. The MCP exposes read tools for
boards, phases, templates, project fields, projects and archived projects, plus guarded
write tools for lab-scoped project create/update/archive/delete.

Current lab stance:

- `pipedrive_create_project` requires `title`, `board_id` and `phase_id`.
- `template_id`, project `status`, and `health_status` are intentionally not part of
  the first write schema because their interaction with board/phase and enum values was
  not live-validated.
- Project `custom_fields` stay nested under the `custom_fields` object:

```json
{
  "title": "MCP LAB - Project",
  "board_id": 1,
  "phase_id": 2,
  "custom_fields": {
    "project_field_hash": "value"
  }
}
```

Unlike deal/person/organization writes, project custom fields are not spread into the
top-level payload.

## Project Tasks

Task endpoints are beta and tasks must be linked to a project. The MCP exposes task
read tools plus guarded task create/update/delete tools.

Current lab stance:

- `pipedrive_create_task` requires `title` and `project_id`.
- `assignee_id` is supported; `assignee_ids` is intentionally excluded until precedence
  between the two fields is validated.
- `done` and `milestone` are accepted as booleans in MCP inputs. Pipedrive's Tasks
  docs list write fields as `done` and `milestone` integer flags, but the live beta API
  observed on 2026-06-18 ignored those body fields while accepting `is_done` and
  `is_milestone`. The MCP therefore maps the public booleans to the effective beta API
  write fields:

```json
{
  "is_done": true,
  "is_milestone": false
}
```

- Task read responses are normalized back to the MCP vocabulary: `is_done` becomes
  `done`, and `is_milestone` becomes `milestone`. The documented `done` and
  `milestone` response names are still tolerated defensively if returned as `0` or `1`.
- Milestone tasks require a due date. The MCP rejects `milestone=true` without a
  `due_date` on create, and update requires either a `due_date` in the payload or one
  already present on the task.
- Project-plan v1 move endpoints are out of scope for this first project/task slice.
