import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../src/validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'));
const normalized = normalizeConfig(config, config);
if (normalized.radio.streamUrl !== config.radio.streamUrl) throw new Error('streamUrl inválida');
for (const required of [
  'src/server.mjs',
  'src/persistence.mjs',
  'src/config-store.mjs',
  'public/admin/index.html',
  '.env.example',
  'supabase/001_radio_periquin.sql'
]) {
  if (!fs.existsSync(path.join(root, required))) throw new Error('Falta ' + required);
}
const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
if (!server.includes("version: '0.4.0'")) throw new Error('server.mjs no reporta v0.4.0');
if (!server.includes('SUPABASE_SECRET_KEY')) throw new Error('Falta soporte SUPABASE_SECRET_KEY');
console.log('Radio Periquín Cloud v0.4.0: OK · config v' + config.contentVersion + ' · persistencia local + Supabase preparada');
