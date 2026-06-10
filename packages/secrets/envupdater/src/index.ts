import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { defineSecretProvider, manualSetup, type SecretRef } from '@profullstack/sh1pt-core';

interface Config {
  envFile?: string;
  dopplerProject?: string;
  dopplerConfig?: string;
  railwayProject?: string;
  railwayEnvironment?: string;
  githubRepo?: string;
}

const DEFAULT_ENV_FILE = '.env';

const ENV_ENTRY = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

function envFile(config: Config): string {
  return config.envFile ?? DEFAULT_ENV_FILE;
}

async function readEnvFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function unquoteValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\([nrt"\\])/g, (_match: string, escaped: string) => {
      if (escaped === 'n') return '\n';
      if (escaped === 'r') return '\r';
      if (escaped === 't') return '\t';
      return escaped;
    });
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function formatValue(value: string): string {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"')}"`;
}

function parseEntry(line: string): { prefix: string; key: string; spacing: string; value: string } | undefined {
  const match = ENV_ENTRY.exec(line);
  if (!match) return undefined;
  const [, prefix, key, spacing, value] = match;
  if (prefix === undefined || key === undefined || spacing === undefined || value === undefined) return undefined;
  return { prefix, key, spacing, value };
}

async function pullDotEnv(file: string): Promise<SecretRef[]> {
  const text = await readEnvFile(file);
  return text.split(/\r?\n/).flatMap((line) => {
    const entry = parseEntry(line);
    if (!entry) return [];
    return [{ key: entry.key, value: unquoteValue(entry.value), path: file }];
  });
}

async function pushDotEnv(file: string, secrets: SecretRef[]): Promise<{ count: number }> {
  const pending = new Map(secrets.map((s) => [s.key, s.value ?? '']));
  const text = await readEnvFile(file);
  const lines = text === '' ? [''] : text.split(/\r?\n/);
  const nextLines = lines.map((line) => {
    const entry = parseEntry(line);
    if (!entry || !pending.has(entry.key)) return line;
    const value = pending.get(entry.key)!;
    pending.delete(entry.key);
    return `${entry.prefix}${entry.key}${entry.spacing}${formatValue(value)}`;
  });
  const additions = [...pending].map(([key, value]) => `${key}=${formatValue(value)}`);
  if (additions.length) {
    if (nextLines.length === 1 && nextLines[0] === '') {
      nextLines.splice(0, 1, ...additions, '');
    } else if (nextLines[nextLines.length - 1] === '') {
      nextLines.push(...additions, '');
    } else {
      nextLines.push(...additions);
    }
  }
  await writeFile(file, nextLines.join('\n'), 'utf8');
  return { count: secrets.length };
}

async function pullDoppler(config: Config): Promise<SecretRef[]> {
  const project = config.dopplerProject ?? '';
  const dopplerConfig = config.dopplerConfig ?? 'prd';
  if (!project) return [];
  const out = execSync(
    `doppler secrets download --no-file --format json --project ${project} --config ${dopplerConfig}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const parsed = JSON.parse(out);
  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: String(value),
    path: `doppler://${project}/${dopplerConfig}`,
  }));
}

async function pushDoppler(secrets: SecretRef[], config: Config): Promise<{ count: number }> {
  const project = config.dopplerProject ?? '';
  const dopplerConfig = config.dopplerConfig ?? 'prd';
  if (!project) return { count: 0 };
  const vars = secrets.map((s) => `${s.key}=${s.value ?? ''}`).join(' ');
  execSync(`doppler secrets set ${vars} --project ${project} --config ${dopplerConfig}`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return { count: secrets.length };
}

async function pullRailway(config: Config): Promise<SecretRef[]> {
  const project = config.railwayProject ?? '';
  const env = config.railwayEnvironment ?? 'production';
  if (!project) return [];
  const out = execSync(
    `railway environment --project ${project} --environment ${env} --json`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const parsed = JSON.parse(out);
  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: String(value),
    path: `railway://${project}/${env}`,
  }));
}

async function pushRailway(secrets: SecretRef[], config: Config): Promise<{ count: number }> {
  const project = config.railwayProject ?? '';
  const env = config.railwayEnvironment ?? 'production';
  if (!project) return { count: 0 };
  for (const secret of secrets) {
    execSync(
      `railway variables set --project ${project} --environment ${env} ${secret.key}=${secret.value ?? ''}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
  }
  return { count: secrets.length };
}

async function pullGitHubSecrets(config: Config): Promise<SecretRef[]> {
  const repo = config.githubRepo ?? '';
  if (!repo) return [];
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];
  const out = execSync(
    `gh secret list --repo ${repo} --json name,updatedAt`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const secrets: { name: string }[] = JSON.parse(out);
  const result: SecretRef[] = [];
  for (const s of secrets) {
    const val = execSync(`gh secret view ${s.name} --repo ${repo}`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }).trim();
    result.push({ key: s.name, value: val, path: `github://${repo}` });
  }
  return result;
}

async function pushGitHubSecrets(secrets: SecretRef[], config: Config): Promise<{ count: number }> {
  const repo = config.githubRepo ?? '';
  if (!repo) return { count: 0 };
  for (const secret of secrets) {
    execSync(
      `echo "${secret.value ?? ''}" | gh secret set ${secret.key} --repo ${repo}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
  }
  return { count: secrets.length };
}

export default defineSecretProvider<Config>({
  id: 'secrets-envupdater',
  label: 'envupdater',
  cli: 'sh1pt',
  async connect(ctx, config) {
    ctx.log(`envupdater connect · envFile=${envFile(config)}`);
    if (config.dopplerProject) {
      if (!ctx.secret('DOPPLER_TOKEN')) ctx.log('warning: DOPPLER_TOKEN not set');
    }
    if (config.railwayProject) {
      if (!ctx.secret('RAILWAY_TOKEN')) ctx.log('warning: RAILWAY_TOKEN not set');
    }
    if (config.githubRepo) {
      if (!ctx.secret('GITHUB_TOKEN')) ctx.log('warning: GITHUB_TOKEN not set');
    }
    return { accountId: envFile(config) };
  },
  async pull(ctx, config): Promise<SecretRef[]> {
    const results: SecretRef[] = [];
    results.push(...await pullDotEnv(envFile(config)));
    if (config.dopplerProject) results.push(...await pullDoppler(config));
    if (config.railwayProject) results.push(...await pullRailway(config));
    if (config.githubRepo) results.push(...await pullGitHubSecrets(config));
    ctx.log(`envupdater pull · ${results.length} secrets from ${envFile(config)}`);
    return results;
  },
  async push(ctx, secrets, config) {
    let total = 0;
    const dotenvResult = await pushDotEnv(envFile(config), secrets);
    total += dotenvResult.count;
    ctx.log(`envupdater push .env · ${dotenvResult.count} secrets`);
    if (config.dopplerProject) {
      const r = await pushDoppler(secrets, config);
      total += r.count;
      ctx.log(`envupdater push doppler · ${r.count} secrets`);
    }
    if (config.railwayProject) {
      const r = await pushRailway(secrets, config);
      total += r.count;
      ctx.log(`envupdater push railway · ${r.count} secrets`);
    }
    if (config.githubRepo) {
      const r = await pushGitHubSecrets(secrets, config);
      total += r.count;
      ctx.log(`envupdater push github · ${r.count} secrets`);
    }
    return { count: total };
  },
  setup: manualSetup({
    label: 'envupdater CLI',
    vendorDocUrl: 'https://sh1pt.com/docs/envupdater',
    steps: [
      'Install provider CLIs: doppler, railway, gh',
      'Set tokens: sh1pt secret set DOPPLER_TOKEN <token>',
      'Set tokens: sh1pt secret set GITHUB_TOKEN <token>',
      'Set tokens: sh1pt secret set RAILWAY_TOKEN <token>',
      'Configure: add envupdater to sh1pt.config.ts with provider settings',
    ],
  }),
});
