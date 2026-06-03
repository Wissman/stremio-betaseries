# BetaSeries Tracker - Stremio Addon

Ce projet est un addon Stremio développé en Node.js (Express) permettant d'intégrer et de synchroniser votre compte **BetaSeries** avec **Stremio**.

## Fonctionnalités

- **Catalogue personnalisé** : Affiche vos catalogues "Séries à voir" (basé sur votre planning chronologique) et "Films à voir" directement dans l'interface de Stremio.
- **Indicateurs visuels** : Préfixe les titres des épisodes et des films directement dans Stremio pour voir d'un coup d'œil ce qui est vu (**🟢**) ou à voir (**🔴**).
- **Scrobbler automatique** : Marque automatiquement un épisode ou un film comme "vu" sur BetaSeries dès que vous lancez la lecture dans Stremio.
- **Interface de configuration** : Une page de configuration moderne en dark mode pour vous connecter et générer votre lien d'installation Stremio personnalisé.
- **Déploiement Vercel** : Pré-configuré avec `vercel.json` pour un déploiement instantané en Serverless.

## Installation Locale

1. Installez les dépendances :
   ```bash
   npm install
   ```
2. Démarrez le serveur :
   ```bash
   npm start
   ```
3. Ouvrez votre navigateur sur `http://localhost:7000` pour configurer l'addon.

## Déploiement sur Vercel

1. Poussez ce dépôt sur votre compte GitHub.
2. Créez un nouveau projet sur **Vercel** et liez-le à ce dépôt.
3. Déployez ! L'addon fonctionnera instantanément comme une Serverless Function.

## Configuration dans Stremio

1. Accédez à l'URL de votre application déployée (ex: `https://votre-addon.vercel.app/`).
2. Saisissez votre **clé API BetaSeries** (disponible gratuitement sur le [portail développeur BetaSeries](https://www.betaseries.com/api/)).
3. Saisissez vos identifiants de connexion BetaSeries.
4. Cliquez sur **Générer le lien Stremio**.
5. Copiez le lien généré (`stremio://...`) et collez-le dans la barre de recherche des addons de Stremio pour l'installer.
