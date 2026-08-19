import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeConfig } from './validation.mjs';

function versionFromFilename(name) {
  const match = /^config-v(\d+)\.json$/i.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

function safeIso(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) throw Object.assign(new Error('publishAt debe ser una fecha/hora válida.'), { statusCode: 400 });
  return new Date(parsed).toISOString();
}

export class ConfigStore {
  constructor(rootDir, storageRoot = rootDir) {
    this.rootDir = rootDir;
    this.storageRoot = storageRoot;
    this.dataDir = path.join(storageRoot, 'data');
    this.historyDir = path.join(this.dataDir, 'history');
    this.configPath = path.join(this.dataDir, 'config.json');
    this.schedulesPath = path.join(this.dataDir, 'schedules.json');
    this.seedConfigPath = path.join(rootDir, 'data', 'config.json');
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.ensureSeed();
    this.ensureSchedules();
  }

  ensureSeed() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.seedConfigPath)) {
      throw new Error('No existe data/config.json de fábrica para inicializar el almacenamiento.');
    }
    fs.copyFileSync(this.seedConfigPath, this.configPath);
  }

  ensureSchedules() {
    if (!fs.existsSync(this.schedulesPath)) fs.writeFileSync(this.schedulesPath, '[]\n', 'utf8');
  }

  readSchedules() {
    this.ensureSchedules();
    const value = JSON.parse(fs.readFileSync(this.schedulesPath, 'utf8'));
    return Array.isArray(value) ? value : [];
  }

  writeSchedules(items) {
    const temp = `${this.schedulesPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(items, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, this.schedulesPath);
  }

  load() {
    const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    return normalizeConfig(raw, raw);
  }

  loadVersion(version) {
    const n = Number.parseInt(String(version), 10);
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('Versión inválida.'), { statusCode: 400 });
    const current = this.load();
    if (Number(current.contentVersion) === n) return current;
    const target = path.join(this.historyDir, `config-v${n}.json`);
    if (!fs.existsSync(target)) throw Object.assign(new Error(`No existe la versión v${n}.`), { statusCode: 404 });
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    return normalizeConfig(raw, raw);
  }

  listHistory(limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 50));
    const current = this.load();
    const versions = fs.readdirSync(this.historyDir)
      .map(versionFromFilename)
      .filter(Number.isFinite)
      .sort((a, b) => b - a)
      .slice(0, safeLimit);

    const previous = versions.map(version => {
      try {
        const config = this.loadVersion(version);
        return this.summary(config, false);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return [this.summary(current, true), ...previous]
      .sort((a, b) => b.contentVersion - a.contentVersion)
      .slice(0, safeLimit);
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
      campaignsCount: Array.isArray(config.campaigns) ? config.campaigns.length : 0,
      programsCount: Array.isArray(config.programs) ? config.programs.length : 0,
      storiesCount: Array.isArray(config.stories) ? config.stories.length : 0
    };
  }

  publish(input) {
    const current = this.load();
    const normalized = normalizeConfig(input, current);
    const next = {
      ...normalized,
      schemaVersion: 2,
      contentVersion: Number(current.contentVersion || 0) + 1,
      updatedAt: new Date().toISOString()
    };

    const historyPath = path.join(this.historyDir, `config-v${current.contentVersion || 0}.json`);
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    }

    const tempPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, this.configPath);
    return next;
  }

  restore(version) {
    const snapshot = this.loadVersion(version);
    return this.publish(snapshot);
  }

  listSchedules(limit = 100) {
    const safeLimit = Math.min(250, Math.max(1, Number.parseInt(String(limit), 10) || 100));
    return this.readSchedules()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, safeLimit);
  }

  createSchedule({ name = '', publishAt, config }) {
    const current = this.load();
    const normalized = normalizeConfig(config, current);
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      name: String(name || '').trim().slice(0, 120) || `Publicación v${Number(current.contentVersion || 0) + 1}`,
      status: 'scheduled',
      publishAt: safeIso(publishAt),
      createdAt: now,
      updatedAt: now,
      publishedAt: '',
      publishedVersion: null,
      error: '',
      baseContentVersion: Number(current.contentVersion || 0),
      config: normalized
    };
    const items = this.readSchedules();
    items.push(item);
    this.writeSchedules(items);
    return item;
  }

  claimDueSchedules(limit = 10) {
    const now = Date.now();
    const items = this.readSchedules();
    const due = [];
    for (const item of items.sort((a, b) => Date.parse(a.publishAt || 0) - Date.parse(b.publishAt || 0))) {
      if (due.length >= limit) break;
      if (item.status !== 'scheduled') continue;
      if (!Number.isFinite(Date.parse(item.publishAt)) || Date.parse(item.publishAt) > now) continue;
      item.status = 'processing';
      item.updatedAt = new Date().toISOString();
      due.push(structuredClone(item));
    }
    if (due.length) this.writeSchedules(items);
    return due;
  }

  completeSchedule(id, published) {
    const items = this.readSchedules();
    const item = items.find(entry => entry.id === id);
    if (!item) return null;
    item.status = 'published';
    item.updatedAt = new Date().toISOString();
    item.publishedAt = published.updatedAt || item.updatedAt;
    item.publishedVersion = Number(published.contentVersion || 0);
    item.error = '';
    this.writeSchedules(items);
    return item;
  }

  failSchedule(id, error) {
    const items = this.readSchedules();
    const item = items.find(entry => entry.id === id);
    if (!item) return null;
    item.status = 'failed';
    item.updatedAt = new Date().toISOString();
    item.error = String(error?.message || error || 'Error desconocido').slice(0, 500);
    this.writeSchedules(items);
    return item;
  }

  cancelSchedule(id) {
    const items = this.readSchedules();
    const item = items.find(entry => entry.id === id);
    if (!item) throw Object.assign(new Error('Publicación programada no encontrada.'), { statusCode: 404 });
    if (item.status !== 'scheduled') throw Object.assign(new Error('Solo se pueden cancelar publicaciones pendientes.'), { statusCode: 409 });
    item.status = 'cancelled';
    item.updatedAt = new Date().toISOString();
    this.writeSchedules(items);
    return item;
  }
}
