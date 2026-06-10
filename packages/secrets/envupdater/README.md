# envupdater

Environment updater plugin for sh1pt. Syncs environment variables between `.env` files, Doppler, Railway, and GitHub Secrets.

## What it does

- Pulls environment variables from configured sources
- Pushes local environment variables to configured providers
- Syncs environment variables between providers (e.g., .env → Doppler)
- Supports .env files, Doppler, Railway projects, and GitHub Actions secrets

## Package

- Name: `@profullstack/sh1pt-secrets-envupdater`
- Path: `packages/secrets/envupdater`
- Adapter ID: `secrets-envupdater`
- Homepage: https://sh1pt.com

## Usage

```bash
# Pull from all configured providers to .env
sh1pt secrets envupdater pull

# Push .env to a specific provider
sh1pt secrets envupdater push --provider doppler

# Sync between providers
sh1pt secrets envupdater sync --from doppler --to github-secrets
```

## Configuration

Set provider tokens in your sh1pt vault:

```bash
sh1pt secret set DOPPLER_TOKEN dp.xxx
sh1pt secret set GITHUB_TOKEN ghp_xxx
sh1pt secret set RAILWAY_TOKEN rly_xxx
```
