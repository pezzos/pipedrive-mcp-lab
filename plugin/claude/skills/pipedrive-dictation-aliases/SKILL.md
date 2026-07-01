---
name: pipedrive-dictation-aliases
description: Use when a spoken or dictated contact, company, deal, lead, project, or activity name is not found in Pipedrive, looks phonetically close to another result, or the user corrects a dictated CRM name.
---

# Pipedrive Dictation Aliases

Use this skill when speech-to-text likely changed a Pipedrive name. Example: "David Lespée" may need to resolve to "David Lespect".

## Resolution Workflow

When a direct search fails:

1. Try tolerant variants: remove accents, normalize apostrophes/hyphens, search first name and last name separately, search only company stem words, and try close-sounding alternatives.
2. Search across likely entities: person first, then organization/deal/lead when the wording suggests them.
3. Present a short candidate list with record type, name/title, organization, and ID.
4. Ask the user to confirm the match.

When the user confirms an alias mapping, repeat it back clearly:

```text
Je retiens pour cette session : "David Lespée" -> "David Lespect" (person_id=123).
```

Use the corrected CRM record for the rest of the current task.

## Persistence Limit

Current plugin skills can use the confirmed alias during the active conversation, but they do not provide durable cross-session alias storage by themselves. A durable alias registry requires a future MCP tool or plugin data store that can read and write mappings such as:

```json
{
  "spoken": "David Lespée",
  "canonical": "David Lespect",
  "entity_type": "person",
  "entity_id": 123
}
```

Until that registry exists, do not claim that the alias will be remembered permanently. If durable memory is required, propose adding an alias registry tool to the MCP.
