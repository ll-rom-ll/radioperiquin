import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env.mjs';
import { ConfigStore } from './config-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const ADMIN_TOKEN = process.env.RADIO_ADMIN_TOKEN || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const STORAGE_ROOT = path.resolve(process.env.RADIO_STORAGE_ROOT || ROOT);
const ADMIN_ORIGINS = new Set((process.env.RADIO_ADMIN_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean));
const ADMIN_RATE_LIMIT = Math.max(10, Number.parseInt(process.env.RADIO_ADMIN_RATE_LIMIT || '120', 10));
const MAX_JSON_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const store = new ConfigStore(ROOT, STORAGE_ROOT);
const mediaDir = path.join(STORAGE_ROOT, 'media');
const adminDir = path.join(ROOT, 'public', 'admin');
fs.mkdirSync(mediaDir, { recursive: true });

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2) + '\n';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(text);
}

function securityHeaders() {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

function publicCorsHeaders() {
  return {
    ...securityHeaders(),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'If-None-Match'
  };
}

function adminCorsHeaders(req) {
  const origin = String(req.headers.origin || '');
  const sameOrigin = !origin;
  const allowed = sameOrigin || ADMIN_ORIGINS.has(origin);
  return {
    ...securityHeaders(),
    ...(allowed && origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-None-Match'
  };
}

const adminWindows = new Map();
function adminRateLimited(req) {
  const now = Date.now();
  const key = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const current = adminWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    adminWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > ADMIN_RATE_LIMIT;
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const provided = Buffer.from(auth.slice(7));
  const expected = Buffer.from(ADMIN_TOKEN);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Payload demasiado grande.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requestBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

function safeMediaName(rawName, contentType) {
  const base = path.basename(String(rawName || 'image')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const extFromType = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif'
  }[contentType];
  if (!extFromType) return null;
  const hasKnownExt = /\.(png|jpe?g|webp|gif)$/i.test(base);
  const stem = hasKnownExt ? base.replace(/\.(png|jpe?g|webp|gif)$/i, '') : base;
  const suffix = crypto.randomBytes(5).toString('hex');
  return `${stem || 'image'}-${Date.now()}-${suffix}${extFromType}`;
}

function serveFile(res, filePath, contentType, cacheControl = 'no-cache') {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    const headers = pathname.startsWith('/api/v1/admin/') ? adminCorsHeaders(req) : publicCorsHeaders();
    res.writeHead(204, headers);
    return res.end();
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      const config = store.load();
      return sendJson(res, 200, {
        ok: true,
        service: 'radio-periquin-cloud',
        version: '0.2.0',
        contentVersion: config.contentVersion,
        adminConfigured: Boolean(ADMIN_TOKEN),
        storageRoot: STORAGE_ROOT,
        persistentStorageExpected: STORAGE_ROOT !== ROOT
      }, publicCorsHeaders());
    }

    if (req.method === 'GET' && pathname === '/api/v1/public/config') {
      const config = store.load();
      const etag = `"rp-${config.contentVersion}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', ...publicCorsHeaders() });
        return res.end();
      }
      return sendJson(res, 200, config, {
        ETag: etag,
        'Cache-Control': 'no-cache',
        ...publicCorsHeaders()
      });
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/config') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      return sendJson(res, 200, store.load(), { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'PUT' && pathname === '/api/v1/admin/config') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const body = await readBody(req, MAX_JSON_BYTES);
      let json;
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'JSON inválido.' }, adminCorsHeaders(req));
      }
      const published = store.publish(json);
      return sendJson(res, 200, { ok: true, config: published }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'POST' && pathname === '/api/v1/admin/media') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const filename = safeMediaName(url.searchParams.get('filename'), contentType);
      if (!filename) return sendJson(res, 415, { error: 'Formato permitido: PNG, JPG, WEBP o GIF.' }, adminCorsHeaders(req));
      const body = await readBody(req, MAX_MEDIA_BYTES);
      if (!body.length) return sendJson(res, 400, { error: 'La imagen está vacía.' }, adminCorsHeaders(req));
      const target = path.join(mediaDir, filename);
      fs.writeFileSync(target, body);
      const mediaUrl = `${requestBaseUrl(req)}/media/${encodeURIComponent(filename)}`;
      return sendJson(res, 201, { ok: true, url: mediaUrl, filename }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname.startsWith('/media/')) {
      const filename = path.basename(pathname.slice('/media/'.length));
      const filePath = path.join(mediaDir, filename);
      const ext = path.extname(filename).toLowerCase();
      const contentType = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
      }[ext] || 'application/octet-stream';
      if (!serveFile(res, filePath, contentType, 'public, max-age=31536000, immutable')) {
        return sendJson(res, 404, { error: 'Imagen no encontrada.' });
      }
      return;
    }

    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      const html = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf8');
      return sendText(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' && pathname === '/') {
      return sendJson(res, 200, {
        service: 'Radio Periquín Cloud',
        publicConfig: '/api/v1/public/config',
        admin: '/admin/',
        health: '/health'
      });
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error('[RadioPeriquinCloud]', error);
    return sendJson(res, status, { error: status === 500 ? 'Error interno del servidor.' : error.message }, pathname.startsWith('/api/v1/admin/') ? adminCorsHeaders(req) : publicCorsHeaders());
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Radio Periquín Cloud v0.2.0 escuchando en http://${HOST}:${PORT}`);
  if (!ADMIN_TOKEN) console.warn('ADVERTENCIA: RADIO_ADMIN_TOKEN no está configurado; las rutas administrativas están deshabilitadas.');
});

function shutdown(signal) {
  console.log(`[RadioPeriquinCloud] ${signal}: cerrando servidor…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
