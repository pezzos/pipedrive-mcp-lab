# Live Lab Test Prompt

Use this prompt in a Claude/Codex session where the Pipedrive MCP is enabled.

```text
Tu as accès au MCP Pipedrive. Fais uniquement le test live synthétique de la surface commerciale déjà validée en dry-run. Ne refais pas l’audit général des lectures déjà validées, sauf si tu as besoin d’un ID de pipeline, stage, user, activity type ou produit.

Règles de sécurité :
- Ne révèle jamais de token, secret, URL sensible ou payload CRM complet.
- Ne copie pas de données client réelles dans ton rapport.
- Tous les objets créés doivent commencer par le préfixe `MCP LAB -`.
- Utilise un suffixe de run unique, par exemple `MCP LAB - 2026-05-24 - <initiales>-<hhmm>`.
- Commence chaque famille d’écriture par un dry-run rapide, puis fais l’écriture réelle uniquement avec `dry_run=false` et `confirm_lab_write=true`.
- N’utilise pas la valeur de `PIPEDRIVE_WRITE_CONFIRMATION` dans les appels. Le but est de vérifier que `confirm_lab_write=true` suffit pour les objets lab.
- Utilise `validate_links=true` dès qu’un appel référence un `person_id`, `org_id`, `deal_id`, `lead_id` ou `product_id`.
- Ne modifie jamais un objet qui ne commence pas par `MCP LAB -`.
- Nettoie en fin de test avec les outils `delete_*`, en ordre inverse des dépendances.

Objectif :
Valider une boucle commerciale réelle sur données synthétiques : création -> relecture -> édition -> action métier -> relecture -> suppression/cleanup. Le rapport doit dire précisément ce qui est passé en live, ce qui est resté en dry-run, et les IDs jetables créés/supprimés.

Préflight minimal :
1. Appelle `pipedrive_health_check`.
2. Vérifie :
   - `writes_enabled=true`
   - `lab_prefix_required=true`
   - `lab_write_confirmation_allowed=true`
   - `lab_prefix` commence par `MCP LAB -`
3. Si un de ces points est faux, stoppe les écritures réelles et fais uniquement un rapport de blocage.
4. Récupère seulement les IDs nécessaires : pipelines/stages, users, activity types, produits si disponibles.

Scénario live à exécuter :

1. Organisation
- `pipedrive_create_organization` avec un nom lab.
- Relis via `pipedrive_get_organization`.
- `pipedrive_update_organization` sur un champ simple.
- Relis et vérifie que la modification est visible.

2. Personne
- `pipedrive_create_person` liée à l’organisation lab, avec email synthétique du type `mcp-lab+<run>@example.com`.
- Relis via `pipedrive_get_person`.
- `pipedrive_update_person` sur téléphone ou nom.
- Relis.

3. Lead
- Vérifie rapidement que `pipedrive_create_lead` sans `person_id` ni `organization_id` est refusé.
- Crée un lead lab lié à la personne ou l’organisation.
- Relis via `pipedrive_get_lead`.
- Mets à jour titre/valeur/date.
- Relis.

4. Deal
- Crée un deal lab lié à la personne/organisation.
- Relis via `pipedrive_get_deal`.
- Mets à jour valeur/titre.
- Déplace le deal vers un autre stage si un stage cible existe.
- Relis.

5. Notes
- Crée une note lab liée au deal.
- Liste les notes du deal pour vérifier sa présence sans imprimer le contenu complet.
- Mets à jour la note.
- Relis la note si possible.

6. Activités
- Crée une activité lab liée au deal.
- Mets à jour ou replanifie l’activité.
- Marque l’activité faite.
- Relis l’activité.

7. Workflow combiné
- Lance `pipedrive_log_call_and_schedule_follow_up` sur le deal lab.
- Vérifie que l’appel done et la relance future sont créés ou que la réponse donne assez d’IDs pour les relire.
- Garde les IDs pour cleanup.

8. Produits, participants, followers
- Si au moins un produit live existe, ajoute un product line item au deal lab avec `pipedrive_add_product_to_deal`, puis liste les produits du deal.
- Ajoute la personne lab comme participant au deal, puis liste les participants.
- Ajoute un follower avec un user id valide, puis liste les followers.
- Si une de ces opérations échoue à cause de configuration Pipedrive vide ou permissions, note l’erreur et continue.

9. Closing contrôlé
- Crée deux petits deals lab supplémentaires :
  - un deal lab à marquer gagné avec `pipedrive_mark_deal_won`
  - un deal lab à marquer perdu avec `pipedrive_mark_deal_lost`
- Utilise `close_time` au format `YYYY-MM-DD` pour vérifier la normalisation.
- Relis les deux deals et note seulement les statuts.

10. Cleanup
- Supprime les activités lab créées avec `pipedrive_delete_activity`.
- Supprime les notes lab avec `pipedrive_delete_note`.
- Supprime les leads lab avec `pipedrive_delete_lead`, sauf si tu les as convertis.
- Supprime les deals lab avec `pipedrive_delete_deal`.
- Supprime la personne lab avec `pipedrive_delete_person`.
- Supprime l’organisation lab avec `pipedrive_delete_organization`.
- Après chaque suppression, tente une relecture ou une recherche lab pour confirmer que l’objet n’est plus actif ou que l’API renvoie une erreur attendue.

Rapport attendu en français :

## Verdict
- Validation : live complète / live partielle / bloquée
- Écritures réelles : oui/non
- Cleanup : complet / partiel / bloqué

## Préflight
- Résumé de `pipedrive_health_check`, sans secrets.

## Objets Jetables
Table :
| Type | ID | Nom/titre synthétique | Créé | Modifié | Relu | Supprimé | Notes |

## Scénarios Live
Table :
| Scénario | Outils | Résultat | Notes |

## Échecs Ou Gaps Restants
- Liste les erreurs exactes, sans payload complet.
- Distingue : manque de données sandbox, permissions Pipedrive, bug MCP, hors scope.

## Risques Observés
- Mauvaise écriture possible ?
- Cleanup incomplet ?
- Réponses difficiles à interpréter ?

## Recommandations
- P0/P1/P2 pour ce qui reste à corriger.
```
