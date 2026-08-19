import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ConfigStore } from './config-store.mjs';
import { normalizeConfig } from './validation.mjs';

const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function errorWithStatus(message, statusCode = 500) {
  return Object.assign(new Error(message), { statusCode });
}

function safeMediaName(rawName, contentType) {
  const extFromType = IMAGE_TYPES[contentType];
  if (!extFromType) return null;
  const base = path.basename(String(rawName || 'image')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const hasKnownExt = /\.(png|jpe?g|webp|gif)$/i.test(base);
  const stem = (hasKnownExt ? base.replace(/\.(png|jpe?g|webp|gif)$/i, '') : base).replace(/^-+|-+$/g, '');
  const suffix = crypto.randomBytes(5).toString('hex');
  return `${stem || 'image'}-${Date.now()}-${suffix}${extFromType}`;
}

function contentTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[ext] || 'application/octet-stream';
}

function deepReplaceMediaUrls(value, replacements) {
  if (!value || !replacements.size) return value;
  if (typeof value === 'string') {
    for (const [filename, url] of replacements.entries()) {
      const encoded = encodeURIComponent(filename);
      if (value.endsWith(`/media/${filename}`) || value.endsWith(`/media/${encoded}`)) return url;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => deepReplaceMediaUrls(item, replacements));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplaceMediaUrls(item, replacements)]));
  }
  return value;
}

class SupabaseRest {
  constructor(url, serviceRoleKey) {
    this.url = String(url || '').trim().replace(/\/+$/, '');
    this.key = String(serviceRoleKey || '').trim();
    if (!this.url || !this.key) throw new Error('Supabase no está configurado correctamente.');
  }

  async request(route, options = {}) {
    const response = await fetch(`${this.url}${route}`, {
      ...options,
      headers: {
        apikey: this.key,
        ...(this.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${this.key}` }),
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const detail = data?.message || data?.error_description || data?.error || (typeof data === 'string' ? data : '') || `HTTP ${response.status}`;
      throw errorWithStatus(`Supabase: ${detail}`, response.status >= 400 && response.status < 500 ? response.status : 502);
    }
    return data;
  }
}

export class Persistence {
  constructor({ rootDir, storageRoot, publicBaseUrl = '', supabaseUrl = '', supabaseServiceRoleKey = '', supabaseBucket = 'radio-periquin-media' }) {
    this.rootDir = rootDir;
    this.storageRoot = storageRoot;
    this.publicBaseUrl = String(publicBaseUrl || '').replace(/\/$/, '');
    this.local = new ConfigStore(rootDir, storageRoot);
    this.localMediaDir = path.join(storageRoot, 'media');
    fs.mkdirSync(this.localMediaDir, { recursive: true });
    this.supabaseUrl = String(supabaseUrl || '').trim().replace(/\/+$/, '');
    this.supabaseServiceRoleKey = String(supabaseServiceRoleKey || '').trim();
    this.supabaseBucket = String(supabaseBucket || 'radio-periquin-media').trim() || 'radio-periquin-media';
    this.mode = this.supabaseUrl && this.supabaseServiceRoleKey ? 'supabase' : 'local';
    this.remote = this.mode === 'supabase' ? new SupabaseRest(this.supabaseUrl, this.supabaseServiceRoleKey) : null;
    this.bootstrapped = false;
  }

  async init() {
    if (this.mode !== 'supabase') {
      this.bootstrapped = true;
      return;
    }
    const rows = await this.remote.request('/rest/v1/rp_state?id=eq.1&select=id,content_version,updated_at,config&limit=1');
    if (Array.isArray(rows) && rows.length) {
      this.bootstrapped = true;
      return;
    }
    await this.bootstrapRemoteFromLocal();
    this.bootstrapped = true;
  }

  async bootstrapRemoteFromLocal() {
    const replacements = new Map();
    if (fs.existsSync(this.localMediaDir)) {
      const files = fs.readdirSync(this.localMediaDir).filter(name => name !== '.gitkeep');
      for (const filename of files) {
        const filePath = path.join(this.localMediaDir, filename);
        let stat;
        try { stat = fs.statSync(filePath); } catch { continue; }
        if (!stat.isFile()) continue;
        const contentType = contentTypeFromFilename(filename);
        if (!IMAGE_TYPES[contentType]) continue;
        try {
          const uploaded = await this.uploadRemoteMedia(filename, contentType, fs.readFileSync(filePath), { preserveName: true });
          replacements.set(filename, uploaded.url);
        } catch (error) {
          console.warn('[RadioPeriquinCloud] No se pudo migrar media local:', filename, error.message);
        }
      }
    }

    const currentRaw = this.local.load();
    const current = deepReplaceMediaUrls(currentRaw, replacements);
    const history = this.local.listHistory(200)
      .filter(item => !item.isCurrent)
      .map(item => {
        try { return deepReplaceMediaUrls(this.local.loadVersion(item.contentVersion), replacements); }
        catch { return null; }
      })
      .filter(Boolean);

    for (const config of history) {
      await this.remote.request('/rest/v1/rp_history?on_conflict=content_version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ content_version: Number(config.contentVersion || 0), updated_at: config.updatedAt || new Date().toISOString(), config })
      });
    }

    await this.remote.request('/rest/v1/rp_state?on_conflict=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: 1, content_version: Number(current.contentVersion || 1), updated_at: current.updatedAt || new Date().toISOString(), config: current })
    });
  }

  async load() {
    if (this.mode === 'local') return this.local.load();
    const rows = await this.remote.request('/rest/v1/rp_state?id=eq.1&select=id,content_version,updated_at,config&limit=1');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.config) throw errorWithStatus('Supabase no tiene configuración inicial de Radio Periquín.', 503);
    return normalizeConfig(row.config, row.config);
  }

  async loadVersion(version) {
    const n = Number.parseInt(String(version), 10);
    if (!Number.isFinite(n) || n < 0) throw errorWithStatus('Versión inválida.', 400);
    if (this.mode === 'local') return this.local.loadVersion(n);
    const current = await this.load();
    if (Number(current.contentVersion) === n) return current;
    const rows = await this.remote.request(`/rest/v1/rp_history?content_version=eq.${n}&select=config&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.config) throw errorWithStatus(`No existe la versión v${n}.`, 404);
    return normalizeConfig(row.config, row.config);
  }

  summary(config, isCurrent = false) {
    return {
      contentVersion: Number(config.contentVersion || 0),
      updatedAt: config.updatedAt || '',
      isCurrent,
      stationName: config.station?.name || '',
      currentProgram: config.home?.currentProgram || '',
      host: config.home?.host || '',
      announcement: config.home?.announcement || '',
      heroImageUrl: config.home?.heroImageUrl || '',
      programsCount: Array.isArray(config.programs) ? config.programs.length : 0,
      storiesCount: Array.isArray(config.stories) ? config.stories.length : 0
    };
  }

  async listHistory(limit = 50) {
    if (this.mode === 'local') return this.local.listHistory(limit);
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 50));
    const current = await this.load();
    const rows = await this.remote.request(`/rest/v1/rp_history?select=content_version,updated_at,config&order=content_version.desc&limit=${safeLimit}`);
    const previous = (Array.isArray(rows) ? rows : []).map(row => this.summary(row.config || {}, false));
    return [this.summary(current, true), ...previous]
      .sort((a, b) => b.contentVersion - a.contentVersion)
      .slice(0, safeLimit);
  }

  async publish(input) {
    const current = await this.load();
    const normalized = normalizeConfig(input, current);
    if (this.mode === 'local') return this.local.publish(normalized);
    const result = await this.remote.request('/rest/v1/rpc/rp_publish_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_config: normalized })
    });
    const config = result && typeof result === 'object' && !Array.isArray(result) ? result : null;
    if (!config) throw errorWithStatus('Supabase no devolvió la configuración publicada.', 502);
    return normalizeConfig(config, config);
  }

  async restore(version) {
    const snapshot = await this.loadVersion(version);
    return this.publish(snapshot);
  }

  async listSchedules(limit = 100) {
    if (this.mode === 'local') return this.local.listSchedules(limit);
    const safeLimit = Math.min(250, Math.max(1, Number.parseInt(String(limit), 10) || 100));
    const rows = await this.remote.request(`/rest/v1/rp_scheduled_publications?select=id,name,status,publish_at,created_at,updated_at,published_at,published_version,error,base_content_version,config&order=created_at.desc&limit=${safeLimit}`);
    return (Array.isArray(rows) ? rows : []).map(row => ({
      id: row.id,
      name: row.name || '',
      status: row.status || 'scheduled',
      publishAt: row.publish_at || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      publishedAt: row.published_at || '',
      publishedVersion: row.published_version == null ? null : Number(row.published_version),
      error: row.error || '',
      baseContentVersion: Number(row.base_content_version || 0),
      config: row.config || null
    }));
  }

  async createSchedule({ name = '', publishAt, config }) {
    const current = await this.load();
    const normalized = normalizeConfig(config, current);
    const parsed = Date.parse(String(publishAt || ''));
    if (!Number.isFinite(parsed)) throw errorWithStatus('publishAt debe ser una fecha/hora válida.', 400);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      name: String(name || '').trim().slice(0, 120) || `Publicación v${Number(current.contentVersion || 0) + 1}`,
      status: 'scheduled',
      publish_at: new Date(parsed).toISOString(),
      created_at: now,
      updated_at: now,
      base_content_version: Number(current.contentVersion || 0),
      config: normalized
    };
    if (this.mode === 'local') return this.local.createSchedule({ name: record.name, publishAt: record.publish_at, config: normalized });
    const rows = await this.remote.request('/rest/v1/rp_scheduled_publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(record)
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw errorWithStatus('Supabase no devolvió la publicación programada.', 502);
    return {
      id: row.id, name: row.name || record.name, status: row.status || 'scheduled', publishAt: row.publish_at || record.publish_at,
      createdAt: row.created_at || now, updatedAt: row.updated_at || now, publishedAt: row.published_at || '',
      publishedVersion: row.published_version == null ? null : Number(row.published_version), error: row.error || '',
      baseContentVersion: Number(row.base_content_version || record.base_content_version), config: row.config || normalized
    };
  }

  async claimDueSchedules(limit = 10) {
    if (this.mode === 'local') return this.local.claimDueSchedules(limit);
    const safeLimit = Math.min(25, Math.max(1, Number.parseInt(String(limit), 10) || 10));
    const nowIso = new Date().toISOString();
    const rows = await this.remote.request(`/rest/v1/rp_scheduled_publications?status=eq.scheduled&publish_at=lte.${encodeURIComponent(nowIso)}&select=id,name,status,publish_at,created_at,updated_at,published_at,published_version,error,base_content_version,config&order=publish_at.asc&limit=${safeLimit}`);
    const claimed = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const result = await this.remote.request(`/rest/v1/rp_scheduled_publications?id=eq.${encodeURIComponent(row.id)}&status=eq.scheduled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'processing', updated_at: new Date().toISOString() })
      });
      const claimedRow = Array.isArray(result) ? result[0] : null;
      if (claimedRow) claimed.push({
        id: claimedRow.id, name: claimedRow.name || '', status: claimedRow.status || 'processing', publishAt: claimedRow.publish_at || '',
        createdAt: claimedRow.created_at || '', updatedAt: claimedRow.updated_at || '', publishedAt: claimedRow.published_at || '',
        publishedVersion: claimedRow.published_version == null ? null : Number(claimedRow.published_version), error: claimedRow.error || '',
        baseContentVersion: Number(claimedRow.base_content_version || 0), config: claimedRow.config || {}
      });
    }
    return claimed;
  }

  async completeSchedule(id, published) {
    if (this.mode === 'local') return this.local.completeSchedule(id, published);
    const rows = await this.remote.request(`/rest/v1/rp_scheduled_publications?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'published', updated_at: new Date().toISOString(), published_at: published.updatedAt || new Date().toISOString(), published_version: Number(published.contentVersion || 0), error: '' })
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async failSchedule(id, error) {
    if (this.mode === 'local') return this.local.failSchedule(id, error);
    const rows = await this.remote.request(`/rest/v1/rp_scheduled_publications?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'failed', updated_at: new Date().toISOString(), error: String(error?.message || error || 'Error desconocido').slice(0, 500) })
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async cancelSchedule(id) {
    if (this.mode === 'local') return this.local.cancelSchedule(id);
    const rows = await this.remote.request(`/rest/v1/rp_scheduled_publications?id=eq.${encodeURIComponent(id)}&status=eq.scheduled`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw errorWithStatus('La publicación no existe o ya no está pendiente.', 409);
    return row;
  }

  localMediaList(baseUrl) {
    const currentText = JSON.stringify(this.local.load());
    return fs.readdirSync(this.localMediaDir)
      .filter(name => name !== '.gitkeep')
      .map(filename => {
        const filePath = path.join(this.localMediaDir, filename);
        let stat;
        try { stat = fs.statSync(filePath); } catch { return null; }
        if (!stat.isFile()) return null;
        return {
          filename,
          url: `${baseUrl}/media/${encodeURIComponent(filename)}`,
          bytes: stat.size,
          contentType: contentTypeFromFilename(filename),
          uploadedAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
          usedInCurrent: currentText.includes(filename),
          storage: 'local'
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  }

  async listMedia(baseUrl) {
    if (this.mode === 'local') return this.localMediaList(baseUrl);
    const currentText = JSON.stringify(await this.load());
    const rows = await this.remote.request('/rest/v1/rp_media?select=path,filename,url,bytes,content_type,uploaded_at&order=uploaded_at.desc&limit=500');
    return (Array.isArray(rows) ? rows : []).map(row => ({
      filename: row.filename || path.basename(row.path || ''),
      url: row.url || this.publicMediaUrl(row.path),
      bytes: Number(row.bytes || 0),
      contentType: row.content_type || contentTypeFromFilename(row.filename || row.path || ''),
      uploadedAt: row.uploaded_at || '',
      modifiedAt: row.uploaded_at || '',
      usedInCurrent: currentText.includes(row.url || row.path || ''),
      storage: 'supabase'
    }));
  }

  publicMediaUrl(objectPath) {
    const encodedPath = String(objectPath || '').split('/').map(encodeURIComponent).join('/');
    return `${this.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(this.supabaseBucket)}/${encodedPath}`;
  }

  async uploadRemoteMedia(rawName, contentType, body, options = {}) {
    const filename = options.preserveName ? path.basename(String(rawName || 'image')).replace(/[^a-zA-Z0-9._-]/g, '-') : safeMediaName(rawName, contentType);
    if (!filename || !IMAGE_TYPES[contentType]) throw errorWithStatus('Formato permitido: PNG, JPG, WEBP o GIF.', 415);
    const objectPath = `uploads/${filename}`;
    const encodedBucket = encodeURIComponent(this.supabaseBucket);
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    await this.remote.request(`/storage/v1/object/${encodedBucket}/${encodedPath}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': options.preserveName ? 'true' : 'false' },
      body
    });
    const url = this.publicMediaUrl(objectPath);
    await this.remote.request('/rest/v1/rp_media?on_conflict=path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ path: objectPath, filename, url, bytes: body.length, content_type: contentType, uploaded_at: new Date().toISOString() })
    });
    return { ok: true, url, filename, path: objectPath, storage: 'supabase' };
  }

  async uploadMedia(rawName, contentType, body, baseUrl) {
    if (!IMAGE_TYPES[contentType]) throw errorWithStatus('Formato permitido: PNG, JPG, WEBP o GIF.', 415);
    if (this.mode === 'supabase') return this.uploadRemoteMedia(rawName, contentType, body);
    const filename = safeMediaName(rawName, contentType);
    if (!filename) throw errorWithStatus('Formato permitido: PNG, JPG, WEBP o GIF.', 415);
    fs.writeFileSync(path.join(this.localMediaDir, filename), body);
    return { ok: true, url: `${baseUrl}/media/${encodeURIComponent(filename)}`, filename, storage: 'local' };
  }

  serveLocalMedia(filename) {
    if (this.mode !== 'local') return null;
    const safe = path.basename(String(filename || ''));
    const filePath = path.join(this.localMediaDir, safe);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return { filePath, contentType: contentTypeFromFilename(safe) };
  }

  async status() {
    if (this.mode === 'local') {
      return {
        mode: 'local',
        durable: this.storageRoot !== this.rootDir,
        database: 'filesystem',
        media: 'filesystem',
        storageRoot: this.storageRoot
      };
    }
    let databaseOk = false;
    let storageOk = false;
    try {
      const rows = await this.remote.request('/rest/v1/rp_state?id=eq.1&select=id&limit=1');
      databaseOk = Array.isArray(rows) && rows.length === 1;
    } catch {}
    try {
      await this.remote.request(`/storage/v1/bucket/${encodeURIComponent(this.supabaseBucket)}`, { method: 'GET' });
      storageOk = true;
    } catch {}
    return {
      mode: 'supabase',
      durable: true,
      database: databaseOk ? 'online' : 'error',
      media: storageOk ? 'online' : 'error',
      bucket: this.supabaseBucket,
      projectUrl: this.supabaseUrl
    };
  }
}
