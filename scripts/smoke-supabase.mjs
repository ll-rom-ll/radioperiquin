import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Persistence } from '../src/persistence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-supabase-smoke-'));
const secret = 'sb_secret_test_only';
let state = null;
const history = new Map();
const media = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.headers.apikey !== secret) return json(res, 401, { message: 'missing apikey' });
  if (req.headers.authorization) return json(res, 400, { message: 'sb_secret must not use Authorization Bearer' });
  const url = new URL(req.url, 'http://localhost');
  let raw = Buffer.alloc(0);
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    raw = Buffer.concat(parts);
  }
  const body = () => raw.length ? JSON.parse(raw.toString('utf8')) : null;

  if (req.method === 'GET' && url.pathname === '/rest/v1/rp_state') {
    if (!state) return json(res, 200, []);
    if (url.searchParams.get('select') === 'id') return json(res, 200, [{ id: 1 }]);
    return json(res, 200, [state]);
  }
  if (req.method === 'POST' && url.pathname === '/rest/v1/rp_state') {
    const value = body(); state = value; return json(res, 201, null);
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/rp_history') {
    const eq = url.searchParams.get('content_version');
    if (eq?.startsWith('eq.')) {
      const version = Number(eq.slice(3));
      return json(res, 200, history.has(version) ? [{ config: history.get(version).config }] : []);
    }
    return json(res, 200, [...history.values()].sort((a,b)=>b.content_version-a.content_version));
  }
  if (req.method === 'POST' && url.pathname === '/rest/v1/rp_history') {
    const value = body(); history.set(Number(value.content_version), value); return json(res, 201, null);
  }
  if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/rp_publish_config') {
    if (!state) return json(res, 400, { message: 'state missing' });
    const incoming = body().p_config;
    history.set(Number(state.content_version), { content_version: Number(state.content_version), updated_at: state.updated_at, config: state.config });
    const nextVersion = Number(state.content_version) + 1;
    const updatedAt = new Date().toISOString();
    const next = { ...incoming, contentVersion: nextVersion, updatedAt };
    state = { id: 1, content_version: nextVersion, updated_at: updatedAt, config: next };
    return json(res, 200, next);
  }
  if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/')) return json(res, 200, { Key: url.pathname });
  if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/bucket/')) return json(res, 200, { public: true });
  if (req.method === 'POST' && url.pathname === '/rest/v1/rp_media') {
    const value = body(); media.set(value.path, value); return json(res, 201, null);
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/rp_media') return json(res, 200, [...media.values()]);
  return json(res, 404, { message: `unhandled ${req.method} ${url.pathname}` });
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const persistence = new Persistence({ rootDir: root, storageRoot: storage, supabaseUrl: base, supabaseServiceRoleKey: secret, supabaseBucket: 'radio-periquin-media' });
  await persistence.init();
  if (persistence.mode !== 'supabase') throw new Error('No activó Supabase');
  const initial = await persistence.load();
  const published = await persistence.publish({ ...initial, home: { ...initial.home, currentProgram: 'Supabase Smoke' } });
  if (published.contentVersion !== initial.contentVersion + 1) throw new Error('Publicación remota no incrementó versión');
  const old = await persistence.loadVersion(initial.contentVersion);
  if (old.contentVersion !== initial.contentVersion) throw new Error('Historial remoto no funciona');
  const uploaded = await persistence.uploadMedia('smoke.png', 'image/png', Buffer.from('fake-image'), base);
  if (!uploaded.url.includes('/storage/v1/object/public/radio-periquin-media/')) throw new Error('URL pública de Storage inválida');
  const library = await persistence.listMedia(base);
  if (library.length !== 1 || library[0].storage !== 'supabase') throw new Error('Biblioteca remota no funciona');
  const status = await persistence.status();
  if (status.database !== 'online' || status.media !== 'online') throw new Error('Status Supabase inválido');
  console.log('Supabase smoke OK · seed/publicación/historial/media/status');
} finally {
  server.close();
  fs.rmSync(storage, { recursive: true, force: true });
}
