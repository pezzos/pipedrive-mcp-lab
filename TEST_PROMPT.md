# Focused Live Retest Prompt

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as accès au MCP Pipedrive. Ne refais pas le test complet : les lectures, deals, notes, activités simples, workflow call/follow-up, participants, followers, closing et cleanup ont déjà été validés en live. Fais uniquement le retest ciblé des mappings corrigés.

Règles de sécurité :
- Ne révèle jamais de token, secret, URL sensible ou payload CRM complet.
- Tous les objets créés doivent commencer par le préfixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple `MCP LAB - 2026-05-24 - AP-RETEST-<hhmm>`.
- Pour les écritures réelles, utilise uniquement `dry_run=false` et `confirm_lab_write=true`.
- N’utilise pas `PIPEDRIVE_WRITE_CONFIRMATION`.
- Utilise `validate_links=true` pour tout appel qui référence `person_id`, `org_id`, `deal_id`, `lead_id` ou `product_id`.
- Nettoie tous les objets créés en fin de test avec les outils `pipedrive_delete_*`.

Préflight :
1. Appelle `pipedrive_health_check`.
2. Stoppe les écritures réelles si un de ces points est faux :
   - `writes_enabled=true`
   - `lab_prefix_required=true`
   - `lab_write_confirmation_allowed=true`
   - `lab_prefix="MCP LAB -"`
3. Récupère seulement les IDs strictement nécessaires : pipeline/stage si besoin.

Scénarios à retester :

1. Organisation sans address
- Crée une organisation lab sans champ `address`.
- Relis-la.
- Mets à jour uniquement son `name`.
- Relis-la.
- Critère OK : aucun essai n’envoie `address`, et l’update nom passe.

2. Personne avec email/téléphone
- Crée une personne lab liée ou non à l’organisation lab, avec :
  - `email: "mcp-lab+<run>@example.com"`
  - `phone: "+33100000000"`
- Relis-la.
- Mets à jour email ou téléphone.
- Relis-la.
- Critère OK : l’API accepte email/téléphone via le MCP.

3. Activité liée à une personne
- Crée une activité lab avec `person_id` de la personne lab et éventuellement `deal_id` si tu crées un deal support.
- Relis l’activité.
- Mets à jour l’activité avec `person_id` et une nouvelle date.
- Marque-la done.
- Critère OK : plus d’erreur `person_id is a read-only field`; le MCP doit utiliser les participants.

4. Lead lié
- Vérifie que le lead sans lien est encore refusé.
- Crée un lead lab lié à `person_id` ou `organization_id`.
- Si tu mets une valeur, fournis aussi `currency: "EUR"`.
- Relis le lead.
- Mets à jour titre, valeur et `expected_close_date`.
- Relis.
- Critère OK : plus d’erreur `Couldn't create lead, body is invalid.`

5. Produit si disponible
- Liste les produits.
- Si au moins un produit existe, crée un deal lab et ajoute un product line item.
- Relis les produits du deal.
- Si aucun produit n’existe, note seulement `skip: no live product`.

Cleanup obligatoire :
- Supprime les activités créées.
- Supprime les leads créés.
- Supprime les deals créés.
- Supprime la personne créée.
- Supprime l’organisation créée.
- Après suppression, une relecture peut retourner un tombstone ; note `is_deleted=true`, `active_flag=false`, ou l’erreur attendue.

Rapport attendu en français :

## Verdict
- Validation : live complète / live partielle / bloquée
- Écritures réelles : oui/non
- Cleanup : complet / partiel / bloqué

## Objets Jetables
| Type | ID | Nom/titre synthétique | Créé | Modifié | Relu | Supprimé | Notes |

## Résultats Ciblés
| Correction testée | Résultat | Notes |

## Échecs Restants
- Erreur exacte sans payload complet.
- Classe : bug MCP / permission Pipedrive / données sandbox manquantes / hors scope.

## Recommandations
- P0/P1/P2 uniquement pour les problèmes encore ouverts.
```
