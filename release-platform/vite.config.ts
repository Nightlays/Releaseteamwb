import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = path.resolve(__dirname, 'legacy');
const postgresRestPrefix = '/api/postgres/rest/v1/';
const postgresTables = new Set([
  'dashboard_snapshots',
  'charts_reports',
  'charts_release_metrics',
  'charts_release_snapshots',
  'charts_ml_dataset',
  'release_quarter_android',
  'release_quarter_ios',
  'learnhub_records',
  'uvu_release_reports',
  'swat_release_reports',
]);
const legacyRoutePrefix = '/legacy/';
const legacyDirs = new Set(['mascots', 'tools']);
const legacyExts = new Set(['.html', '.css', '.js', '.json', '.mjs', '.png', '.svg', '.onnx']);

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.onnx') return 'application/octet-stream';
  return 'application/octet-stream';
}

async function copyRecursive(src: string, dest: string) {
  const stat = await fsp.stat(src);
  if (stat.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
    return;
  }

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

async function copyLegacyFileWithUnicodeAlias(src: string, dest: string) {
  await copyRecursive(src, dest);
  const basename = path.basename(dest);
  const normalizedBasename = basename.normalize('NFC');
  if (normalizedBasename !== basename) {
    await copyRecursive(src, path.join(path.dirname(dest), normalizedBasename));
  }
}

async function copyLegacyAssets(outDir: string) {
  const entries = await fsp.readdir(legacyRoot, { withFileTypes: true });
  await fsp.mkdir(outDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const src = path.join(legacyRoot, entry.name);
    const dest = path.join(outDir, entry.name);

    if (entry.isDirectory()) {
      if (legacyDirs.has(entry.name)) {
        await copyRecursive(src, dest);
      }
      continue;
    }

    if (legacyExts.has(path.extname(entry.name).toLowerCase())) {
      await copyLegacyFileWithUnicodeAlias(src, dest);
    }
  }
}

function resolvePathSegment(parent: string, segment: string): string | null {
  const direct = path.join(parent, segment);
  if (fs.existsSync(direct)) return direct;

  const normalized = segment.normalize('NFC');
  try {
    const match = fs.readdirSync(parent).find(name => name.normalize('NFC') === normalized);
    return match ? path.join(parent, match) : null;
  } catch {
    return null;
  }
}

function resolveLegacyFilePath(root: string, relativePath: string): string | null {
  const parts = relativePath.split('/').filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    const next = resolvePathSegment(cursor, part);
    if (!next) return null;
    cursor = next;
  }
  return cursor;
}

function jsonResponse(res: { statusCode: number; setHeader: (key: string, value: string) => void; end: (body?: string) => void }, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function textResponse(res: { statusCode: number; setHeader: (key: string, value: string) => void; end: (body?: string) => void }, status: number, text: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function cleanIdentifier(value: string) {
  const normalized = String(value || '').trim();
  if (!/^[a-z][a-z0-9_]*$/i.test(normalized)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${normalized}"`;
}

function pgTableName(value: string) {
  const normalized = String(value || '').trim();
  if (!postgresTables.has(normalized)) throw new Error(`Postgres table is not allowed: ${normalized}`);
  return cleanIdentifier(normalized);
}

function selectColumns(value: string | null) {
  if (!value || value === '*') return '*';
  return value.split(',').map(column => column.trim()).filter(Boolean).map(cleanIdentifier).join(', ');
}

function readRequestBody(req: NodeJS.ReadableStream) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readLocalEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const index = line.indexOf('=');
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, index).trim(), value];
    }));
}

function applyFilters(params: URLSearchParams, values: unknown[]) {
  const where: string[] = [];
  params.forEach((value, key) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'or'].includes(key)) return;
    if (!value.startsWith('eq.')) return;
    values.push(value.slice(3));
    where.push(`${cleanIdentifier(key)} = $${values.length}`);
  });
  const orValue = params.get('or');
  const releaseMatches = orValue?.match(/^\((.+)\)$/)?.[1]
    ?.split(',')
    .map(item => item.match(/^([a-z0-9_]+)\.eq\.(.*)$/i))
    .filter((item): item is RegExpMatchArray => Boolean(item));
  if (releaseMatches?.length) {
    const column = releaseMatches[0][1];
    if (releaseMatches.every(item => item[1] === column)) {
      values.push(releaseMatches.map(item => item[2]));
      where.push(`${cleanIdentifier(column)} = any($${values.length}::text[])`);
    }
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}

function orderClause(value: string | null) {
  if (!value) return '';
  const [column, direction] = value.split('.');
  return ` order by ${cleanIdentifier(column)} ${direction?.toLowerCase() === 'desc' ? 'desc' : 'asc'}`;
}

function limitClause(value: string | null, values: unknown[]) {
  if (!value) return '';
  values.push(Math.max(1, Math.min(1000, Number(value) || 100)));
  return ` limit $${values.length}`;
}

function normalizeRowsPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === 'object') return [payload as Record<string, unknown>];
  return [];
}

function insertSql(table: string, rows: Record<string, unknown>[], conflictColumns: string[], returning: boolean) {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  if (!columns.length) throw new Error('Empty insert payload');
  const values: unknown[] = [];
  const placeholders = rows.map(row => `(${columns.map(column => {
    values.push(row[column] ?? null);
    return `$${values.length}`;
  }).join(', ')})`);
  const updateColumns = columns.filter(column => !conflictColumns.includes(column));
  const conflict = conflictColumns.length
    ? ` on conflict (${conflictColumns.map(cleanIdentifier).join(', ')}) do update set ${updateColumns.map(column => `${cleanIdentifier(column)} = excluded.${cleanIdentifier(column)}`).join(', ')}`
    : '';
  return {
    sql: `insert into ${table} (${columns.map(cleanIdentifier).join(', ')}) values ${placeholders.join(', ')}${conflict}${returning ? ' returning *' : ''}`,
    values,
  };
}

function postgresRestPlugin(env: Record<string, string>): Plugin {
  let pool: pg.Pool | null = null;
  const getPool = () => {
    if (!pool) {
      pool = new pg.Pool({
        host: env.PGHOST,
        port: Number(env.PGPORT || 5432),
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        ssl: env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
        max: 8,
      });
    }
    return pool;
  };

  return {
    name: 'release-platform-postgres-rest',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use('/api/postgres/rest/v1', async (req, res, next) => {
        const rawUrl = req.url || '';
        const rawPath = rawUrl.split('?')[0];
        const requestedTable = rawPath.startsWith(postgresRestPrefix)
          ? rawPath.slice(postgresRestPrefix.length)
          : rawPath.replace(/^\/+/, '');
        if (!requestedTable) return next();

        try {
          if (!env.PGHOST || !env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) {
            throw new Error('Postgres env is not configured. Fill PGHOST, PGDATABASE, PGUSER and PGPASSWORD.');
          }

          const url = new URL(rawUrl, 'http://localhost');
          const table = pgTableName(decodeURIComponent(requestedTable));

          if (req.method === 'GET') {
            const values: unknown[] = [];
            const sql = [
              `select ${selectColumns(url.searchParams.get('select'))} from ${table}`,
              applyFilters(url.searchParams, values),
              orderClause(url.searchParams.get('order')),
              limitClause(url.searchParams.get('limit'), values),
            ].join('');
            const result = await getPool().query(sql, values);
            jsonResponse(res, 200, result.rows);
            return;
          }

          if (req.method === 'POST') {
            const prefer = String(req.headers.prefer || '');
            const body = await readRequestBody(req);
            const rows = normalizeRowsPayload(body ? JSON.parse(body) : null);
            if (!rows.length) {
              jsonResponse(res, 200, []);
              return;
            }
            const conflictColumns = String(url.searchParams.get('on_conflict') || '')
              .split(',').map(item => item.trim()).filter(Boolean);
            const returning = prefer.includes('return=representation');
            const statement = insertSql(table, rows, prefer.includes('resolution=merge-duplicates') ? conflictColumns : [], returning);
            const result = await getPool().query(statement.sql, statement.values);
            jsonResponse(res, returning ? 201 : 200, returning ? result.rows : []);
            return;
          }

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          textResponse(res, 405, `Unsupported method: ${req.method}`);
        } catch (error) {
          jsonResponse(res, 500, { error: (error as Error).message || 'Postgres REST error' });
        }
      });
    },
    async closeBundle() {
      await pool?.end().catch(() => {});
      pool = null;
    },
  };
}

function legacyAssetsPlugin(): Plugin {
  return {
    name: 'legacy-assets-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawPath = (req.url || '').split('?')[0];
        if (!rawPath.startsWith(legacyRoutePrefix)) return next();

        const relativePath = decodeURIComponent(rawPath.slice(legacyRoutePrefix.length));
        const filePath = resolveLegacyFilePath(legacyRoot, relativePath);

        if (!filePath || !filePath.startsWith(legacyRoot)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`Legacy asset not found: ${relativePath}`);
          return;
        }

        fs.stat(filePath, (error, stat) => {
          if (error || !stat.isFile()) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(`Legacy asset not found: ${relativePath}`);
            return;
          }
          res.setHeader('Content-Type', getMimeType(filePath));
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
    async closeBundle() {
      const outDir = path.resolve(__dirname, 'dist', 'legacy');
      await fsp.rm(outDir, { recursive: true, force: true });
      await copyLegacyAssets(outDir);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ''),
    ...readLocalEnvFile(path.resolve(process.cwd(), '.env.local')),
    ...process.env,
  } as Record<string, string>;
  return {
    base: './',
    plugins: [react(), postgresRestPlugin(env), legacyAssetsPlugin()],
    server: {
      port: 5173,
      fs: {
        allow: [repoRoot],
      },
    },
    optimizeDeps: {
      entries: ['index.html'],
      exclude: ['onnxruntime-web'],
    },
  };
});
