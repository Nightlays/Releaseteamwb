import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = path.resolve(__dirname, 'legacy');
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

export default defineConfig({
  base: './',
  plugins: [react(), legacyAssetsPlugin()],
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
});
