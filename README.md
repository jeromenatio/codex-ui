# codex-ui

Interface graphique pour piloter et suivre des sessions Codex synchronisées avec `codex app-server`.

## Prerequisites

Cette UI a besoin de :

- `git`
- `node >= 20`
- `npm >= 10`
- `codex` CLI installé et accessible dans le `PATH`
- un login Codex déjà configuré

Versions utilisées pendant le développement :

- `node v24.14.0`
- `npm 11.9.0`
- `codex-cli 0.114.0`

## Fresh Install

Sur une machine vierge :

```bash
git clone https://github.com/jeromenatio/codex-ui.git
cd codex-ui
npm install
codex login
```

### Ubuntu one-liner

Pour une fresh install Ubuntu, cette commande met a jour le systeme, installe Node.js, npm et Codex CLI :

```bash
sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get install -y curl ca-certificates gnupg && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs && sudo npm install -g @openai/codex
```

Puis connecte Codex :

```bash
codex login
```

Vérifie ensuite que Codex est bien accessible :

```bash
codex --version
codex login status
```

## Development

Lance le backend Express et le frontend Vite :

```bash
npm run dev
```

URLs par defaut en dev :

- UI Vite : `http://127.0.0.1:5173`
- API Express : `http://127.0.0.1:3001`

## Production Build

Compile le frontend et le backend :

```bash
npm run build
```

Puis lance l'application compilée :

```bash
npm start
```

Par defaut, le serveur ecoute sur `http://127.0.0.1:3001`.

Pour choisir un autre port :

```bash
PORT=4180 npm start
```

## Features Used By The UI

Cette UI s'appuie sur :

- `codex app-server`
- les sessions Codex existantes
- la lecture/ecriture de `~/.codex/config.toml`
- les infos de compte et quotas via Codex

## Notes

- Si `codex` n'est pas installe ou n'est pas connecte, l'UI ne pourra pas charger les sessions.
- Le premier demarrage peut prendre un peu plus de temps car le backend doit lancer `codex app-server`.
- Le bouton `Apply full access preset` remplace entierement le contenu de `~/.codex/config.toml` avec un preset global permissif.
