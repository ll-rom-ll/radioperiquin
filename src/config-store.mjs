import fs from 'node:fs';
import path from 'node:path';
import { normalizeConfig } from './validation.mjs';

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
}
