# Read-Only Smoke Prompt

- version: v1
- last_updated: 2026-06-17
- purpose: safe read-only live smoke without CRM writes

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Fais uniquement un smoke test read-only. Ne fais aucune
ecriture et n'appelle aucun outil create/update/delete/convert/add/mark/reschedule/log.

Regles de securite :
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Ne copie aucun objet CRM complet dans le rapport.
- Ne copie aucun sujet, adresse, snippet ou corps d'email dans le rapport.
- Utilise de petites limites : 1 a 3 elements maximum par liste.
- Si `writes_enabled=true`, garde quand meme ce test strictement read-only.

Preflight :
1. Appelle `pipedrive_health_check`.
2. Confirme seulement les flags de configuration, sans imprimer de secret.

Lectures a tester :
- `pipedrive_list_pipelines`
- `pipedrive_list_stages`
- `pipedrive_list_deals` avec `limit=1`
- `pipedrive_list_persons` avec `limit=1`
- `pipedrive_list_organizations` avec `limit=1`
- `pipedrive_list_leads` avec `limit=1`
- `pipedrive_list_activities` avec `limit=1`
- `pipedrive_list_notes` avec `limit=1`
- `pipedrive_list_products` avec `limit=1`
- `pipedrive_list_deal_fields` avec `limit=1`
- `pipedrive_list_person_fields` avec `limit=1`
- `pipedrive_list_organization_fields` avec `limit=1`
- `pipedrive_mailbox_probe`

Lectures mailbox optionnelles, seulement si `pipedrive_mailbox_probe` reussit :
- `pipedrive_list_mail_threads` avec `folder=inbox`, `limit=1`
- Si un thread est disponible, `pipedrive_get_mail_thread` sur cet identifiant, sans
  copier les champs sensibles dans le rapport.
- Si un message est disponible, `pipedrive_get_mail_message` avec `include_body=false`.

Rapport attendu en francais :

## Verdict
- Validation : read-only ok / read-only partielle / bloquee
- Ecritures reelles : non

## Resultats
| Outil | Success | Count synthetique | Notes |

## Limites
- Ce smoke test ne valide aucune ecriture.
- Ce smoke test ne valide pas la pagination reelle ni les rate limits.
- Ce smoke test ne valide pas la creation de brouillon, l'envoi ou la reponse email,
  qui ne sont pas exposes par cette surface Pipedrive-only.

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.
```
