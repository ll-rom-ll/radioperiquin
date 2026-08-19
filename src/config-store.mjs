import fs from 'node:fs';
import path from 'node:path';
import { normalizeConfig } from './validation.mjs';

function versionFromFilename(name) {
  const match = /^config-v(\d+)\.json$/i.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

export class ConfigStore {
  constructor(rootDir, storageRoot = rootDir) {
    this.rootDir = rootDir;
    this.storageRoot = storageRoot;
    this.dataDir = path.join(storageRoot, 'data');
    this.historyDir = path.join(this.dataDir, 'history');
    this.configPath = path.join(this.dataDir, 'config.json');
    this.seedConfigPath = path.join(rootDir, 'data', 'config.json');
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.ensureSeed();
  }

  ensureSeed() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.seedConfigPath)) {
      throw new Error('No existe data/config.json de fábrica para inicializar el almacenamiento.');
    }
    fs.copyFileSync(this.seedConfigPath, this.configPath);
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
      programsCount: Array.isArray(config.programs) ? config.programs.length : 0,
      storiesCount: Array.isArray(config.stories) ? config.stories.length : 0
    };
  }

  publish(input) {
    const current = this.load();
    const normalized = normalizeConfig(input, current);
    const next = {
      ...normalized,
      schemaVersion: 1,
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
}
