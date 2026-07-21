# Installer Pipedrive MCP dans Claude

Ce guide concerne le pilote sandbox en version `0.3.4`. Il utilise uniquement :

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

Seules les métadonnées client sandbox sont suivies. Un endpoint ou artefact
client de production n'est pas une alternative d'installation et ne doit pas
être déduit de ce guide.

Le déploiement du Worker est une opération manuelle protégée distincte ;
l'installation de ce client ne le déclenche ni ne l'autorise.

Le connecteur distant est protégé par Cloudflare Access. L'utilisateur ne
saisit jamais de token Pipedrive. L'administrateur de la plateforme approuve le
domaine Pipedrive prévu, puis chaque utilisateur Access ouvre `/pipedrive` et
termine OAuth avec sa propre identité Pipedrive. Le service stocke et renouvelle
uniquement l'accès chiffré de cet utilisateur.

Choisissez un seul parcours. N'activez pas simultanément le connecteur distant
et l'extension Desktop locale `.mcpb` : ils exposent tous les deux les outils
`pipedrive_*` et peuvent créer des doublons.

Avant l'un ou l'autre parcours, l'opérateur doit ajouter l'adresse e-mail exacte
de l'utilisateur ou son groupe de fournisseur d'identité à la politique
**Allow** de l'application Cloudflare Access. Access est la porte de connexion
par utilisateur devant le serveur MCP ; il n'approuve pas une société Pipedrive
et ne crée pas la connexion OAuth Pipedrive de cet utilisateur.

> **Gate du pilote :** le Worker sandbox a été déployé et smoke-testé, mais la
> recette OAuth avec deux utilisateurs/deux sociétés et la suspension déployée
> restent obligatoires avant le rollout client. Confirmez la version active du
> Worker et la [recette sandbox restante](docs/REMOTE_MCP_CLOUDFLARE.md#sandbox-acceptance)
> avant de distribuer l'un de ces parcours.

## Application ChatGPT privée et preuve de cycle isolé

Le package ChatGPT **Pipedrive Sandbox** contient une déclaration d'application
requise et les sept skills; il ne contient ni connecteur MCP direct, ni secret.
La source distingue l'identifiant d'installation distant `plugin_asdk_app...`
de l'identifiant d'application `asdk_app...` utilisé par `.app.json`.

Pour la preuve B3 locale uniquement, exécutez `npm run pack:chatgpt-lifecycle`
puis `npm run accept:chatgpt-lifecycle`. Les profils sont jetables et restent
sous `dist/chatgpt-lifecycle/profiles/`; la recette vérifie le cycle local de
marketplace Codex, une déclaration d'application et sept skills, sans
authentification ni découverte MCP.

N'exécutez pas la commande de fallback direct pendant B3 : `codex mcp add
pipedrive-sandbox --url https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp` peut
démarrer l'enregistrement dynamique du client. Le plan sans secret refuse les
conflits de nom ou d'URL et reste bloqué jusqu'à B8 (connexion externe, DCR,
Access, authentification, action, découverte des outils et première lecture
sûre). `invalid_client_metadata`
signifie que l'enregistrement n'est pas accepté : ne réessayez pas
automatiquement et n'ajoutez aucun secret.

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

## Connecter votre identité Pipedrive

Après l'authentification Cloudflare Access du connecteur :

1. L'administrateur de la plateforme approuve le sous-domaine Pipedrive prévu
   sur `https://pipedrive-mcp-sandbox.pezzoslabs.com/admin/pipedrive`.
2. L'utilisateur ouvre
   [`https://pipedrive-mcp-sandbox.pezzoslabs.com/pipedrive`](https://pipedrive-mcp-sandbox.pezzoslabs.com/pipedrive),
   saisit ce sous-domaine approuvé et termine OAuth avec sa propre identité
   Pipedrive.
3. L'utilisateur vérifie la société connectée affichée sur `/pipedrive`. Il ne
   faut pas la déduire du seul écran de succès OAuth.
4. L'utilisateur ouvre `/settings` et confirme que la nouvelle paire
   utilisateur-société commence en lecture seule.

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
Valide ma connexion Pipedrive MCP sans faire d'écriture. Lance d'abord
pipedrive_connection_check, puis pipedrive_get_current_user et une requête
connue en lecture seule. Indique l'utilisateur courant et si les enregistrements
retournés correspondent à la société affichée sur /pipedrive. Utilise uniquement
les outils pipedrive_*.
```

Résultat attendu :

- Claude voit et utilise les outils `pipedrive_*` ;
- l'authentification Access aboutit pour l'utilisateur courant ;
- `pipedrive_connection_check` accepte l'accès OAuth de cet utilisateur ;
- l'utilisateur courant et les enregistrements connus correspondent à la
  société affichée sur `/pipedrive` ;
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

## Récupération depuis la page de connexion

La page de connexion affiche des notices sûres et typées après une annulation
ou un échec OAuth. Lors d’un remplacement, la connexion actuelle reste active
jusqu’à la vérification complète de la nouvelle société, qui commence en lecture
seule. La déconnexion locale supprime seulement le matériel OAuth conservé par
le Worker, sans modifier Access, l’application Pipedrive dans ChatGPT ni
l’autorisation côté fournisseur.
