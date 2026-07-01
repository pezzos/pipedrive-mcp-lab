# Product Line Item Retest Prompt

- version: v1
- last_updated: 2026-05-24
- purpose: focused product line item retest when at least one disposable or safe product exists

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Fais uniquement le retest product line item. Ne revendique
pas la couverture live produit si aucun produit n'existe.

Regles de securite :
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets crees doivent commencer par le prefixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple `MCP LAB - 2026-05-24 - AP-PRODUCT-<hhmm>`.
- Pour les ecritures reelles, utilise uniquement `dry_run=false` et `confirm_lab_write=true`.
- N'utilise pas `PIPEDRIVE_WRITE_CONFIRMATION`.
- Utilise `validate_links=true` pour les appels qui referencent `person_id`, `org_id`,
  `deal_id` ou `product_id`.
- Nettoie les objets crees en fin de test.

Preflight :
1. Appelle `pipedrive_health_check`.
2. Stoppe les ecritures reelles si un de ces points est faux :
   - `writes_enabled=true`
   - `lab_prefix_required=true`
   - `lab_write_confirmation_allowed=true`
   - `lab_prefix="MCP LAB -"`
3. Appelle `pipedrive_list_products` avec une petite limite.

Scenario :
- Si aucun produit n'existe, arrete le test avec verdict `skipped: no live product`.
- Si un produit existe :
  1. Cree une organisation/personne lab minimale si necessaire.
  2. Cree un deal lab.
  3. Ajoute le produit au deal avec `pipedrive_add_product_to_deal`.
  4. Relis les produits du deal avec `pipedrive_list_deal_products`.
  5. Verifie seulement que l'operation a reussi et que le lien deal/produit est
     observable sans copier de payload complet.

Cleanup obligatoire :
- Supprime le deal cree.
- Supprime la personne et l'organisation creees.
- Note les tombstones ou erreurs attendues de suppression.

Rapport attendu en francais :

## Verdict
- Validation : live produit validee / skipped no live product / bloquee
- Ecritures reelles : oui/non
- Cleanup : complet / partiel / bloque

## Produit
| Product ID | Utilise | Notes |

## Objets Jetables
| Type | ID | Nom/titre synthetique | Supprime | Notes |

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.
```
