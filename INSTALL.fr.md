# Installer Pipedrive MCP dans Claude

Ce guide concerne le pilote sandbox en version `0.3.3`. Il utilise uniquement :

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

Le connecteur distant est protégé par Cloudflare Access. L'utilisateur ne
saisit jamais de token Pipedrive : un administrateur connecte le tenant
Pipedrive de sandbox et le service renouvelle ensuite cet accès OAuth.

Choisissez un seul parcours. N'activez pas simultanément le connecteur distant
et l'extension Desktop locale `.mcpb` : ils exposent tous les deux les outils
`pipedrive_*` et peuvent créer des doublons.

Avant l'un ou l'autre parcours, l'opérateur doit ajouter l'adresse e-mail exacte
de l'utilisateur ou son groupe de fournisseur d'identité à la politique
**Allow** de l'application Cloudflare Access. Access est la porte de connexion
par utilisateur devant le serveur MCP ; elle est distincte de la connexion
OAuth Pipedrive partagée.

## Offre gratuite : skills autonomes

Un compte gratuit peut importer des skills personnalisés et utiliser un
connecteur distant personnalisé.

1. Ouvrez le
   [dernière GitHub Release](https://github.com/pezzos/pipedrive-mcp-claude-plugin/releases/latest)
   et téléchargez les ZIP souhaités. Chaque ZIP contient un seul workflow.
2. Dans Claude Web, ouvrez **Personnaliser > Skills**, puis **Créer un skill**
   et **Importer un skill**.
3. Importez chaque ZIP séparément et activez-le.
4. Ouvrez **Personnaliser > Connecteurs**, ajoutez un connecteur personnalisé
   et saisissez :

   ```text
   https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
   ```

5. Laissez l'identifiant et le secret client OAuth vides.
6. Connectez-vous et terminez l'authentification Cloudflare Access.

Un ZIP autonome contient uniquement les instructions du skill. Il ne contient
ni connecteur MCP, ni identifiant, ni état d'authentification.

## Pro, Max, Team ou Enterprise : plugin

Le plugin payant fournit les sept skills et déclare le connecteur MCP distant.

1. Dans Claude Web ou Claude Desktop, ouvrez **Personnaliser > Plugins**.
2. Ajoutez ce dépôt de marketplace privé s'il n'est pas déjà disponible :

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin
   ```

3. Installez et activez **Pipedrive MCP**.
4. Ouvrez son connecteur et terminez l'authentification Cloudflare Access. Ne
   saisissez ni token Pipedrive, ni identifiants OAuth statiques.

Les administrateurs Team et Enterprise peuvent distribuer le plugin via la
marketplace de l'organisation. Chaque utilisateur s'authentifie tout de même
individuellement dans Access.

## Surfaces du pilote

| Surface | Skills autonomes Free | Plugin payant |
| --- | --- | --- |
| Chat Claude Web | Pris en charge avec le connecteur distant ajouté manuellement | Pris en charge |
| Chat Claude Desktop | Pris en charge avec le connecteur distant ajouté manuellement | Pris en charge |
| Cowork Desktop | Indisponible avec l'offre Free | Surface de recette manuelle obligatoire |
| Cowork Mobile | Indisponible avec l'offre Free | Obligatoire lorsqu'il est activé sur le compte ou l'organisation cible du pilote ; déploiement bêta en cours |
| Cowork Web | Indisponible avec l'offre Free | À valider lorsqu'il est activé sur le compte ou l'organisation cible du pilote avant toute promesse client |
| Chat mobile classique | Hors engagement pour ce pilote | Hors engagement pour ce pilote |

Installez ou mettez à jour le plugin et les skills autonomes depuis le Web ou
Desktop. Les surfaces Cowork payantes utilisent ensuite le même compte Claude,
les mêmes skills activés et le même connecteur distant. L'éligibilité du plan ne
garantit pas que la bêta Web/Mobile d'Anthropic soit déjà active sur un compte.

## Premier test en lecture seule

Pour le parcours Free, commencez dans le Chat Claude Web puis recommencez dans
le Chat Claude Desktop. Pour un compte payant, commencez dans Cowork Desktop,
puis recommencez dans Cowork Mobile et Cowork Web uniquement lorsque chaque
surface bêta est activée sur le compte ou l'organisation cible du pilote :

```text
Valide Pipedrive MCP sans faire d'écriture. Lance d'abord
pipedrive_health_check, puis pipedrive_get_current_user. Utilise uniquement les
outils pipedrive_*.
```

Résultat attendu :

- Claude voit et utilise les outils `pipedrive_*` ;
- l'authentification Access aboutit pour l'utilisateur courant ;
- `pipedrive_get_current_user` atteint le compte Pipedrive de sandbox ;
- l'utilisateur commence en lecture seule.

Ouvrez
[`https://pipedrive-mcp-sandbox.pezzoslabs.com/settings`](https://pipedrive-mcp-sandbox.pezzoslabs.com/settings)
pour gérer les bascules Écritures, Suppressions et Mailbox de cet utilisateur.
Une écriture réelle exige toujours `dry_run=false`.

## Alternative locale Desktop

Le fichier `.mcpb` versionné reste disponible uniquement pour un usage local
dans Claude Desktop nécessitant des identifiants Pipedrive stockés localement.
C'est une alternative au connecteur distant, pas une étape supplémentaire. Il
n'est pas disponible dans Cowork, sur le Web ou sur Mobile.

Avant d'utiliser cette alternative, déconnectez le connecteur Pipedrive MCP
distant. Consultez [la livraison Claude](docs/CLAUDE_DELIVERY.md) et le
[dépannage](docs/TROUBLESHOOTING.md).

Ces informations ont été vérifiées le 16 juillet 2026 dans les guides Anthropic
consacrés aux [skills](https://support.claude.com/en/articles/12512180-use-skills-in-claude),
aux [plugins](https://support.claude.com/en/articles/13837440-use-plugins-in-claude),
aux [surfaces Cowork](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile) et
aux [connecteurs MCP distants](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
