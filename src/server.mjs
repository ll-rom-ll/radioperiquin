import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env.mjs';
import { Persistence } from './persistence.mjs';
import { RealtimeHub } from './realtime-hub.mjs';

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
const REALTIME_HEARTBEAT_SECONDS = Math.max(10, Number.parseInt(process.env.RADIO_REALTIME_HEARTBEAT_SECONDS || '20', 10));
const REALTIME_MAX_CLIENTS = Math.max(10, Number.parseInt(process.env.RADIO_REALTIME_MAX_CLIENTS || '2000', 10));
const SCHEDULE_CHECK_SECONDS = Math.max(10, Number.parseInt(process.env.RADIO_SCHEDULE_CHECK_SECONDS || '20', 10));
const SCHEDULE_MIN_LEAD_SECONDS = Math.max(1, Number.parseInt(process.env.RADIO_SCHEDULE_MIN_LEAD_SECONDS || '15', 10));
const adminDir = path.join(ROOT, 'public', 'admin');

const realtime = new RealtimeHub({ heartbeatSeconds: REALTIME_HEARTBEAT_SECONDS, maxClients: REALTIME_MAX_CLIENTS });

const persistence = new Persistence({
  rootDir: ROOT,
  storageRoot: STORAGE_ROOT,
  publicBaseUrl: PUBLIC_BASE_URL,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseBucket: process.env.SUPABASE_MEDIA_BUCKET || 'radio-periquin-media'
});

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

let processingSchedules = false;
async function processDueSchedules(trigger = 'timer') {
  if (processingSchedules) return { processed: 0 };
  processingSchedules = true;
  let processed = 0;
  try {
    const due = await persistence.claimDueSchedules(10);
    for (const job of due) {
      try {
        const published = await persistence.publish(job.config);
        await persistence.completeSchedule(job.id, published);
        const delivered = realtime.broadcastContent(published, 'scheduled-publish');
        processed += 1;
        console.log(`[RadioPeriquinCloud] publicación programada ${job.id} ejecutada como v${published.contentVersion} · realtime ${delivered} · ${trigger}`);
      } catch (error) {
        try { await persistence.failSchedule(job.id, error); } catch {}
        console.error(`[RadioPeriquinCloud] publicación programada ${job.id} falló:`, error);
      }
    }
    return { processed };
  } catch (error) {
    console.warn(`[RadioPeriquinCloud] scheduler no disponible (${trigger}):`, error.message);
    return { processed: 0, error: error.message };
  } finally {
    processingSchedules = false;
  }
}

async function schedulingStatus() {
  try {
    const schedules = await persistence.listSchedules(250);
    return { enabled: true, checkSeconds: SCHEDULE_CHECK_SECONDS, pending: schedules.filter(item => item.status === 'scheduled').length };
  } catch (error) {
    return { enabled: false, checkSeconds: SCHEDULE_CHECK_SECONDS, pending: 0, error: error.message };
  }
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
      await processDueSchedules('health');
      const [config, storage, scheduling] = await Promise.all([persistence.load(), persistence.status(), schedulingStatus()]);
      return sendJson(res, 200, {
        ok: true,
        service: 'radio-periquin-cloud',
        version: '0.6.0',
        contentVersion: config.contentVersion,
        adminConfigured: Boolean(ADMIN_TOKEN),
        persistence: storage,
        realtime: realtime.status(),
        scheduling
      }, publicCorsHeaders());
    }

    if (req.method === 'GET' && pathname === '/api/v1/public/config') {
      await processDueSchedules('public-config');
      const config = await persistence.load();
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

    if (req.method === 'GET' && pathname === '/api/v1/public/events') {
      await processDueSchedules('public-events');
      const config = await persistence.load();
      if (!realtime.add(req, res, config)) {
        return sendJson(res, 503, { error: 'Límite temporal de conexiones realtime alcanzado.' }, { 'Retry-After': '5', ...publicCorsHeaders() });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/config') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      return sendJson(res, 200, await persistence.load(), { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/system') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const [config, storage] = await Promise.all([persistence.load(), persistence.status()]);
      return sendJson(res, 200, {
        cloudVersion: '0.6.0',
        contentVersion: config.contentVersion,
        updatedAt: config.updatedAt,
        persistence: storage,
        realtime: realtime.status(),
        scheduling: await schedulingStatus()
      }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/history') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const limit = url.searchParams.get('limit') || '50';
      return sendJson(res, 200, { history: await persistence.listHistory(limit) }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    const historyMatch = /^\/api\/v1\/admin\/history\/(\d+)$/.exec(pathname);
    if (req.method === 'GET' && historyMatch) {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const config = await persistence.loadVersion(historyMatch[1]);
      return sendJson(res, 200, { config }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    const restoreMatch = /^\/api\/v1\/admin\/restore\/(\d+)$/.exec(pathname);
    if (req.method === 'POST' && restoreMatch) {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const restored = await persistence.restore(restoreMatch[1]);
      const realtimeDelivered = realtime.broadcastContent(restored, 'restore');
      return sendJson(res, 200, { ok: true, restoredFromVersion: Number(restoreMatch[1]), config: restored, realtime: { deliveredClients: realtimeDelivered } }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/schedules') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      await processDueSchedules('admin-list');
      const limit = url.searchParams.get('limit') || '100';
      return sendJson(res, 200, { schedules: await persistence.listSchedules(limit) }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'POST' && pathname === '/api/v1/admin/schedules') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const body = await readBody(req, MAX_JSON_BYTES);
      let json;
      try { json = JSON.parse(body.toString('utf8')); }
      catch { return sendJson(res, 400, { error: 'JSON inválido.' }, adminCorsHeaders(req)); }
      const publishAtMs = Date.parse(String(json.publishAt || ''));
      if (!Number.isFinite(publishAtMs)) return sendJson(res, 400, { error: 'Fecha/hora de publicación inválida.' }, adminCorsHeaders(req));
      if (publishAtMs < Date.now() + SCHEDULE_MIN_LEAD_SECONDS * 1000) return sendJson(res, 400, { error: `La publicación debe programarse al menos ${SCHEDULE_MIN_LEAD_SECONDS} segundos en el futuro.` }, adminCorsHeaders(req));
      const scheduled = await persistence.createSchedule({ name: json.name || '', publishAt: new Date(publishAtMs).toISOString(), config: json.config });
      return sendJson(res, 201, { ok: true, schedule: scheduled }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    const cancelScheduleMatch = /^\/api\/v1\/admin\/schedules\/([a-zA-Z0-9-]+)\/cancel$/.exec(pathname);
    if (req.method === 'POST' && cancelScheduleMatch) {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const cancelled = await persistence.cancelSchedule(cancelScheduleMatch[1]);
      return sendJson(res, 200, { ok: true, schedule: cancelled }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname === '/api/v1/admin/media') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      return sendJson(res, 200, { media: await persistence.listMedia(requestBaseUrl(req)) }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'PUT' && pathname === '/api/v1/admin/config') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const body = await readBody(req, MAX_JSON_BYTES);
      let json;
      try { json = JSON.parse(body.toString('utf8')); }
      catch { return sendJson(res, 400, { error: 'JSON inválido.' }, adminCorsHeaders(req)); }
      const published = await persistence.publish(json);
      const realtimeDelivered = realtime.broadcastContent(published, 'publish');
      return sendJson(res, 200, { ok: true, config: published, realtime: { deliveredClients: realtimeDelivered } }, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'POST' && pathname === '/api/v1/admin/media') {
      if (adminRateLimited(req)) return sendJson(res, 429, { error: 'Demasiadas solicitudes administrativas.' }, adminCorsHeaders(req));
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'No autorizado.' }, adminCorsHeaders(req));
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const body = await readBody(req, MAX_MEDIA_BYTES);
      if (!body.length) return sendJson(res, 400, { error: 'La imagen está vacía.' }, adminCorsHeaders(req));
      const uploaded = await persistence.uploadMedia(url.searchParams.get('filename'), contentType, body, requestBaseUrl(req));
      return sendJson(res, 201, uploaded, { 'Cache-Control': 'no-store', ...adminCorsHeaders(req) });
    }

    if (req.method === 'GET' && pathname.startsWith('/media/')) {
      const filename = path.basename(pathname.slice('/media/'.length));
      const local = persistence.serveLocalMedia(filename);
      if (!local || !serveFile(res, local.filePath, local.contentType, 'public, max-age=31536000, immutable')) {
        return sendJson(res, 404, { error: 'Imagen no encontrada en almacenamiento local.' });
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
        version: '0.6.0',
        publicConfig: '/api/v1/public/config',
        publicEvents: '/api/v1/public/events',
        scheduledPublications: '/api/v1/admin/schedules',
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

await persistence.init();
await processDueSchedules('startup');
const scheduleTimer = setInterval(() => { processDueSchedules('timer').catch(error => console.error('[RadioPeriquinCloud] scheduler:', error)); }, SCHEDULE_CHECK_SECONDS * 1000);
scheduleTimer.unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Radio Periquín Cloud v0.6.0 escuchando en http://${HOST}:${PORT}`);
  console.log(`[RadioPeriquinCloud] persistencia: ${persistence.mode}`);
  if (!ADMIN_TOKEN) console.warn('ADVERTENCIA: RADIO_ADMIN_TOKEN no está configurado; las rutas administrativas están deshabilitadas.');
  if (persistence.mode !== 'supabase') console.warn('ADVERTENCIA: usando almacenamiento local. Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para persistencia externa.');
});

function shutdown(signal) {
  clearInterval(scheduleTimer);
  realtime.closeAll();
  console.log(`[RadioPeriquinCloud] ${signal}: cerrando servidor…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
