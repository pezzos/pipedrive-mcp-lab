# Installation de Pipedrive MCP dans Claude Desktop

Ce guide est destiné à un utilisateur non technique. Installez et testez
d'abord dans le chat Claude Desktop. Validez ensuite Claude Cowork si vous
voulez utiliser des espaces projet et des documents de travail persistants.

## Avant de commencer

Vous avez besoin de :

- Claude Desktop installé et connecté.
- Un token API Pipedrive.
- Le domaine Pipedrive de l'entreprise.
  - Exemple : pour `https://acme.pipedrive.com`, saisir uniquement `acme`.

Vous n'avez normalement pas besoin d'installer Node.js. Claude Desktop inclut
Node.js pour les extensions Desktop. Installez Node.js seulement si le test
Cowork à la fin ne trouve pas les outils Pipedrive après un redémarrage complet
de Claude Desktop.

## Ce que vous allez installer

Il y a deux éléments :

- Le plugin Claude : il ajoute les compétences Pipedrive utilisées par Claude.
- Le fichier d'extension Desktop (`.mcpb`) : il ajoute le connecteur local
  Pipedrive et l'écran de réglages où saisir le domaine Pipedrive et le token
  API.

Les deux éléments sont nécessaires.

## 1. Installer le plugin Claude

1. Ouvrir Claude Desktop.
2. Ouvrir **Personnaliser**. Dans l'interface actuelle de Claude Desktop, cela
   ouvre **Paramètres** avec la section **Personnaliser**.
3. Ouvrir **Personnaliser** > **Plugins**.
4. Cliquer sur **Ajouter un plugin**.
5. Coller cette URL de plugin :

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin
   ```

6. Installer **Pipedrive MCP**.
7. L'activer si Claude ne l'active pas automatiquement.

Résultat attendu : **Pipedrive MCP** apparaît dans les plugins personnels, avec
les compétences Pipedrive disponibles.

Si Claude indique que les plugins personnels ne sont pas autorisés, demander à
l'administrateur de l'espace Claude d'autoriser ce plugin privé.

## 2. Installer le connecteur Pipedrive

1. Télécharger ce fichier :

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main/pipedrive-mcp-0.1.6.mcpb
   ```

2. Ouvrir le fichier téléchargé `pipedrive-mcp-0.1.6.mcpb`.
3. Claude Desktop doit ouvrir l'écran d'installation de l'extension
   **Pipedrive MCP**.
4. Cliquer sur **Installer** ou **Mettre à jour**.
5. Si Claude demande **Voulez-vous installer Pipedrive MCP ?**, cliquer sur
   **Installer**.
6. Sur la page de l'extension, vérifier que le commutateur affiche **Activé**.
   S'il affiche **Désactivé**, l'activer.

Si le double-clic sur le fichier n'ouvre pas Claude Desktop :

1. Ouvrir Claude Desktop.
2. Ouvrir **Paramètres**.
3. Ouvrir **Application bureau** > **Extensions**.
4. Cliquer sur **Installer l'extension**.
5. Sélectionner `pipedrive-mcp-0.1.6.mcpb`.

## 3. Configurer Pipedrive

Après l'installation, Claude doit ouvrir automatiquement **Configurer Pipedrive
MCP**.

1. Renseigner :
   - **Pipedrive company domain** : uniquement le sous-domaine, par exemple `acme`.
     Ne collez pas l'URL complète ici.
   - **Pipedrive API token** : le token API de Pipedrive.
2. Laisser **Pipedrive base URL** vide, sauf si le support vous a donné une URL
   Pipedrive complète.
3. Laisser **Pipedrive OAuth access token** vide, sauf si le support vous a
   donné un token OAuth.
4. Laisser ces options désactivées pour le premier test :
   - **Enable write tools**
   - **Enable Mailbox tools**
   - **Enable delete tools**
5. Garder **Request timeout** à `10000`.
6. Cliquer sur **Enregistrer**.

Pour modifier ces réglages plus tard :

1. Ouvrir **Paramètres**.
2. Ouvrir **Application bureau** > **Extensions**.
3. Ouvrir les réglages de l'extension **Pipedrive MCP**.

Ne configurez pas cela dans l'écran **Connecteurs** du plugin Claude Cowork. Cet
écran peut être en lecture seule. Les réglages modifiables sont dans
l'extension Desktop.

## 4. Redémarrer Claude Desktop

1. Quitter complètement Claude Desktop.
2. Ouvrir Claude Desktop à nouveau.

## 5. Tester dans le chat Claude Desktop

1. Ouvrir un nouveau chat Claude Desktop.
2. Demander :

   ```text
   Valide Pipedrive MCP sans faire d'écriture. Lance d'abord pipedrive_health_check, puis pipedrive_get_current_user comme test API en lecture seule. Utilise uniquement les outils pipedrive_*.
   ```

3. Si Claude demande l'autorisation d'utiliser un outil Pipedrive MCP, ouvrir
   le menu d'autorisation et choisir **Autoriser une fois** pour le premier
   test.

Résultat attendu :

- Claude peut utiliser les outils `pipedrive_*`.
- `pipedrive_health_check` indique que le domaine Pipedrive et le token sont
  configurés.
- `pipedrive_get_current_user` confirme que le token fonctionne contre l'API
  Pipedrive réelle.
- Les outils d'écriture restent désactivés tant que **Enable write tools** est
  désactivé.

Si ce test échoue, vérifier les réglages de l'extension avant d'essayer Cowork.

## 6. Valider dans Claude Cowork

Utiliser Cowork après que le test dans le chat Desktop fonctionne.

1. Ouvrir une nouvelle tâche Cowork.
2. Demander :

   ```text
   Valide Pipedrive MCP dans Cowork sans faire d'écriture. Lance d'abord pipedrive_health_check, puis pipedrive_get_current_user comme test API en lecture seule. Utilise uniquement les outils pipedrive_*.
   ```

3. Si Claude demande l'autorisation d'utiliser un outil Pipedrive MCP, ouvrir
   le menu d'autorisation et choisir **Autoriser une fois** pour le premier
   test. Claude peut demander une autorisation par outil.

Résultat attendu :

- Claude affiche le connecteur `pipedrive` ou peut utiliser les outils
  `pipedrive_*`.
- `pipedrive_health_check` indique que le domaine Pipedrive et le token sont
  configurés.
- `pipedrive_get_current_user` confirme la connectivité API réelle.
- Les outils d'écriture restent désactivés tant que **Enable write tools** est
  désactivé.

Si Cowork ne trouve pas les outils :

1. Quitter complètement Claude Desktop.
2. Ouvrir Claude Desktop à nouveau.
3. Démarrer une nouvelle tâche Cowork et retester.
4. Si les outils restent indisponibles, installer Node.js LTS depuis
   <https://nodejs.org>, redémarrer Claude Desktop, puis retester.

Ne pas utiliser le connecteur officiel Pipedrive de Claude pour ce workflow.
