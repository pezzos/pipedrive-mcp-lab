# Focused Retest Mappings Prompt

- version: v1
- last_updated: 2026-05-24
- purpose: targeted live retest for corrected request payload mappings

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as acces au MCP Pipedrive. Ne refais pas le test complet : les lectures, deals,
notes, activites simples, workflow call/follow-up, participants, followers, closing et
cleanup ont deja ete valides en live. Fais uniquement le retest cible des mappings
corriges.

Regles de securite :
- Ne revele jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets crees doivent commencer par le prefixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple `MCP LAB - 2026-05-24 - AP-RETEST-<hhmm>`.
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
3. Recupere seulement les IDs strictement necessaires : pipeline/stage si besoin.

Scenarios a retester :

1. Organisation sans address
- Cree une organisation lab sans champ `address`.
- Relis-la.
- Mets a jour uniquement son `name`.
- Relis-la.
- Critere OK : aucun essai n'envoie `address`, et l'update nom passe.

2. Personne avec email/telephone
- Cree une personne lab liee ou non a l'organisation lab, avec :
  - `email: "mcp-lab+<run>@example.com"`
  - `phone: "+33100000000"`
- Relis-la.
- Mets a jour email ou telephone.
- Relis-la.
- Critere OK : l'API accepte email/telephone via le MCP.

3. Activite liee a une personne
- Cree une activite lab avec `person_id` de la personne lab et eventuellement `deal_id`
  si tu crees un deal support.
- Relis l'activite.
- Mets a jour l'activite avec `person_id` et une nouvelle date.
- Marque-la done.
- Critere OK : plus d'erreur `person_id is a read-only field`; le MCP doit utiliser les
  participants.

4. Lead lie
- Verifie que le lead sans lien est encore refuse.
- Cree un lead lab lie a `person_id` ou `organization_id`.
- Si tu mets une valeur, fournis aussi `currency: "EUR"`.
- Relis le lead.
- Mets a jour titre, valeur et `expected_close_date`.
- Relis.
- Critere OK : plus d'erreur `Couldn't create lead, body is invalid.`

5. Produit si disponible
- Liste les produits.
- Si au moins un produit existe, cree un deal lab et ajoute un product line item.
- Relis les produits du deal.
- Si aucun produit n'existe, note seulement `skip: no live product`.

Cleanup obligatoire :
- Supprime les activites creees.
- Supprime les leads crees.
- Supprime les deals crees.
- Supprime la personne creee.
- Supprime l'organisation creee.
- Apres suppression, une relecture peut retourner un tombstone ; note `is_deleted=true`,
  `active_flag=false`, ou l'erreur attendue.

Rapport attendu en francais :

## Verdict
- Validation : live complete / live partielle / bloquee
- Ecritures reelles : oui/non
- Cleanup : complet / partiel / bloque

## Objets Jetables
| Type | ID | Nom/titre synthetique | Cree | Modifie | Relu | Supprime | Notes |

## Resultats Cibles
| Correction testee | Resultat | Notes |

## Echecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / donnees sandbox manquantes / hors scope.

## Recommandations
- P0/P1/P2 uniquement pour les problemes encore ouverts.
```
