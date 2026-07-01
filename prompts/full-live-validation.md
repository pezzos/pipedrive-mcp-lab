# Full Live Validation Prompt

- version: v1
- last_updated: 2026-05-24
- purpose: end-to-end disposable live validation of the Pipedrive MCP lab surface

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Fais une validation live complete, mais uniquement sur
des objets jetables prefixes lab.

Regles de securite :
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets crees doivent commencer par le prefixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple `MCP LAB - 2026-05-24 - AP-FULL-<hhmm>`.
- Pour les ecritures reelles, utilise uniquement `dry_run=false` et `confirm_lab_write=true`.
- N'utilise pas `PIPEDRIVE_WRITE_CONFIRMATION`.
- Utilise `validate_links=true` pour tout appel qui reference `person_id`, `org_id`,
  `deal_id`, `lead_id` ou `product_id`.
- Nettoie tous les objets crees en fin de test avec les outils `pipedrive_delete_*`.

Preflight :
1. Appelle `pipedrive_health_check`.
2. Stoppe les ecritures reelles si un de ces points est faux :
   - `writes_enabled=true`
   - `lab_prefix_required=true`
   - `lab_write_confirmation_allowed=true`
   - `lab_prefix="MCP LAB -"`
3. Liste les pipelines/stages seulement si necessaire pour le scenario.

Scenarios :
1. Organisation
- Cree une organisation lab sans champ `address`.
- Relis-la.
- Mets a jour uniquement son `name`.
- Relis-la.

2. Personne
- Cree une personne lab avec email et telephone, liee a l'organisation si disponible.
- Relis-la.
- Mets a jour email ou telephone.
- Relis-la.

3. Lead
- Verifie que le lead sans `person_id` ni `organization_id` est refuse.
- Cree un lead lab lie a la personne ou a l'organisation.
- Si tu fournis `value`, fournis aussi `currency: "EUR"`.
- Relis, mets a jour titre/valeur/date, puis relis.

4. Deal
- Cree un deal lab lie a la personne et/ou l'organisation.
- Relis-le.
- Mets a jour titre, valeur ou stage si un stage cible fiable existe.
- Relis-le.
- Cloture-le en won ou lost selon le scenario retenu.
- Relis-le apres cloture.

5. Note
- Cree une note lab liee au deal ou au lead.
- Relis-la.
- Mets a jour son contenu.
- Relis-la.

6. Activite
- Cree une activite lab avec `person_id` et/ou `deal_id`.
- Relis-la.
- Mets a jour l'activite.
- Marque-la done.
- Relis-la.

7. Produits
- Liste les produits.
- Si au moins un produit existe, cree un deal lab separe et ajoute un product line item.
- Relis les produits du deal.
- Si aucun produit n'existe, note seulement `skip: no live product`.

Cleanup obligatoire :
- Supprime les activites creees.
- Supprime les notes creees.
- Supprime les leads crees.
- Supprime les deals crees.
- Supprime les personnes creees.
- Supprime les organisations creees.
- Apres suppression, une relecture peut retourner un tombstone ; note `is_deleted=true`,
  `active_flag=false`, ou l'erreur attendue.

Rapport attendu en francais :

## Verdict
- Validation : live complete / live partielle / bloquee
- Ecritures reelles : oui/non
- Cleanup : complet / partiel / bloque

## Objets Jetables
| Type | ID | Nom/titre synthetique | Cree | Modifie | Relu | Supprime | Notes |

## Resultats
| Surface | Resultat | Notes |

## Limites
- Ne revendique pas la couverture produit si aucun produit n'existait.
- Ne revendique pas le support `address` organisation.
- Ne copie aucun payload CRM complet.

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.
```
