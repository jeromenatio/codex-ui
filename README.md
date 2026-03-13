# codex-ui

Interface graphique pour piloter et suivre des sessions Codex synchronisées avec `codex app-server`.

Ce dépôt contient directement l'interface web et son serveur Node.js. Sur une machine neuve, il ne suffit donc pas de cloner le repo : il faut aussi installer Node.js, installer `codex`, se connecter avec `codex login`, installer les dépendances du projet, puis lancer l'application.

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

## Installation

Ordre recommandé :

1. installer les dépendances système et Node.js
2. installer la CLI `codex`
3. se connecter avec `codex login`
4. cloner ce dépôt
5. installer les dépendances JavaScript avec `npm install`
6. lancer l'interface en mode dev ou en build de production

## Vous êtes sur Ubuntu

Commandes complètes, dans l'ordre :

1. Installe `git`, Node.js et npm :

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Installe Codex CLI :

```bash
sudo npm install -g @openai/codex
```

3. Connecte-toi à Codex :

```bash
codex login
```

4. Vérifie que Codex est bien installé et connecté :

```bash
codex --version
codex login status
```

5. Clone le dépôt et installe ses dépendances :

```bash
git clone https://github.com/jeromenatio/codex-ui.git
cd codex-ui
npm install
npm run doctor
```

6. Lance l'interface :

En développement :

```bash
npm run dev
```

En production :

```bash
npm start
```

Par défaut, l'application compilée écoute sur `http://127.0.0.1:4180`.

`npm start` rebuild automatiquement le frontend et le backend avant de lancer le serveur.

Pour choisir un autre port :

```bash
PORT=4300 npm start
```

## Development

Lance le backend Express et le frontend Vite :

```bash
npm run dev
```

URLs par defaut en dev :

- UI Vite : `http://127.0.0.1:5173`
- API Express : `http://127.0.0.1:4180`

Le proxy Vite redirige `/api` et `/events` vers `127.0.0.1:4180`.

Diagnostic rapide de l'environnement :

```bash
npm run doctor
```

## UI Smoke Tests

Playwright est maintenant intégré au projet comme dépendance de dev.

Installation du navigateur Chromium :

```bash
npm run test:e2e:install
```

Selon la machine, Playwright peut aussi nécessiter ses dépendances système :

```bash
npx playwright install-deps chromium
```

Exécution des smoke tests UI :

```bash
npm run test:e2e
```

Exécution visible :

```bash
npm run test:e2e:headed
```

Le setup :

- démarre automatiquement l'app sur `http://127.0.0.1:4180`
- rebuild automatiquement via `npm start` si besoin
- réutilise un serveur déjà lancé sur ce port si présent
- couvre les flows critiques : chat, diagnostics, files, archive zip, export, langue, configs, changement de modèle, images, clear composer, quick prompts, retry, stop, création et suppression de session

Fichiers concernés :

- `playwright.config.mjs`
- `tests/ui-smoke.spec.js`

## Production Build

Compile le frontend et le backend :

```bash
npm run build
```

Puis lance l'application compilée :

```bash
npm start
```

## Features Used By The UI

Cette UI s'appuie sur :

- `codex app-server`
- les sessions Codex existantes
- la lecture/ecriture de `~/.codex/config.toml`
- les infos de compte et quotas via Codex

Quand tu lances ce projet, le serveur Node de ce dépôt sert l'interface web et démarre aussi `codex app-server` en backend.

## Notes

- Si `codex` n'est pas installe ou n'est pas connecte, l'UI ne pourra pas charger les sessions.
- Le premier demarrage peut prendre un peu plus de temps car le backend doit lancer `codex app-server`.
- Un exemple de variables locales est disponible dans `.env.example`.
