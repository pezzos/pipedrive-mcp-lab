# MCP Client Examples

## Read-Only Configuration

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/absolute/path/to/pipedrive-mcp/dist/server.js"],
      "env": {
        "PIPEDRIVE_COMPANY_DOMAIN": "your-company",
        "PIPEDRIVE_API_TOKEN": "your-api-token",
        "PIPEDRIVE_ENABLE_WRITES": "false",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "false",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "false",
        "PIPEDRIVE_LOAD_DOTENV": "false"
      }
    }
  }
}
```

Useful read-only calls:

```json
{ "name": "pipedrive_health_check", "arguments": {} }
```

```json
{ "name": "pipedrive_list_deals", "arguments": { "limit": 5 } }
```

```json
{ "name": "pipedrive_search_items", "arguments": { "term": "Acme", "item_types": ["deal", "person"] } }
```

## Write-Enabled Configuration

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/absolute/path/to/pipedrive-mcp/dist/server.js"],
      "env": {
        "PIPEDRIVE_COMPANY_DOMAIN": "your-company",
        "PIPEDRIVE_API_TOKEN": "your-api-token",
        "PIPEDRIVE_ENABLE_WRITES": "true",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "false",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "false",
        "PIPEDRIVE_LOAD_DOTENV": "false"
      }
    }
  }
}
```

Dry-run write:

```json
{
  "name": "pipedrive_create_deal",
  "arguments": {
    "title": "New opportunity",
    "value": 1000,
    "currency": "EUR",
    "dry_run": true
  }
}
```

Real write:

```json
{
  "name": "pipedrive_create_deal",
  "arguments": {
    "title": "New opportunity",
    "value": 1000,
    "currency": "EUR",
    "dry_run": false
  }
}
```

Write with linked-record validation:

```json
{
  "name": "pipedrive_update_deal",
  "arguments": {
    "deal_id": 123,
    "title": "Updated opportunity",
    "validate_links": true,
    "dry_run": false
  }
}
```

Email activity linked to a contact, deal and organization:

```json
{
  "name": "pipedrive_create_activity",
  "arguments": {
    "subject": "Email follow-up",
    "type": "email",
    "person_id": 123,
    "deal_id": 456,
    "org_id": 789,
    "note": "<p>Draft body or instructions for the email activity.</p>",
    "validate_links": true,
    "dry_run": true
  }
}
```

This creates a Pipedrive activity, not a Mailbox draft. Use `dry_run=false` only
after reviewing the payload.

## Delete-Enabled Configuration

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/absolute/path/to/pipedrive-mcp/dist/server.js"],
      "env": {
        "PIPEDRIVE_COMPANY_DOMAIN": "your-company",
        "PIPEDRIVE_API_TOKEN": "your-api-token",
        "PIPEDRIVE_ENABLE_WRITES": "true",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "false",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "true",
        "PIPEDRIVE_LOAD_DOTENV": "false"
      }
    }
  }
}
```

Delete dry-run:

```json
{
  "name": "pipedrive_delete_deal",
  "arguments": {
    "deal_id": 123,
    "validate_links": true,
    "dry_run": true
  }
}
```

Delete execution:

```json
{
  "name": "pipedrive_delete_deal",
  "arguments": {
    "deal_id": 123,
    "validate_links": true,
    "dry_run": false
  }
}
```

## Mailbox

Mailbox tools are registered only when writes and Mailbox tools are both
enabled:

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/absolute/path/to/pipedrive-mcp/dist/server.js"],
      "env": {
        "PIPEDRIVE_COMPANY_DOMAIN": "your-company",
        "PIPEDRIVE_ACCESS_TOKEN": "your-oauth-access-token",
        "PIPEDRIVE_ENABLE_WRITES": "true",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "true",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "false",
        "PIPEDRIVE_LOAD_DOTENV": "false"
      }
    }
  }
}
```

Start with the probe:

```json
{ "name": "pipedrive_mailbox_probe", "arguments": {} }
```

Link a thread to a deal:

```json
{
  "name": "pipedrive_link_mail_thread",
  "arguments": {
    "mail_thread_id": 91,
    "deal_id": 123,
    "validate_links": true,
    "dry_run": false
  }
}
```

Mailbox access may require `PIPEDRIVE_ACCESS_TOKEN` with appropriate scopes.
Mailbox draft creation and email sending are not supported.
