import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../src/validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'));
const normalized = normalizeConfig(config, config);
if (normalized.radio.streamUrl !== config.radio.streamUrl) throw new Error('streamUrl inválida');
if (normalized.schemaVersion !== 2) throw new Error('El schema de contenido debe ser v2.');
if (!normalized.visibility || !Array.isArray(normalized.campaigns)) throw new Error('Falta configuración de campañas/visibilidad.');
for (const required of [
  'src/server.mjs',
  'src/realtime-hub.mjs',
  'src/persistence.mjs',
  'src/config-store.mjs',
  'public/admin/index.html',
  '.env.example',
  'supabase/001_radio_periquin.sql',
  'supabase/002_scheduled_publications.sql'
]) {
  if (!fs.existsSync(path.join(root, required))) throw new Error('Falta ' + required);
}
const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
if (!server.includes("version: '0.6.0'")) throw new Error('server.mjs no reporta v0.6.0');
if (!server.includes("'/api/v1/public/events'")) throw new Error('Falta endpoint realtime público');
if (!server.includes("'/api/v1/admin/schedules'")) throw new Error('Falta endpoint de publicaciones programadas');
if (!server.includes('processDueSchedules')) throw new Error('Falta scheduler de publicaciones');
if (!server.includes('broadcastContent')) throw new Error('Falta broadcast al publicar/restaurar/programar');
if (!server.includes('SUPABASE_SECRET_KEY')) throw new Error('Falta soporte SUPABASE_SECRET_KEY');
console.log('Radio Periquín Cloud v0.6.0: OK · schema v2 · campañas + visibilidad + publicaciones programadas preparados');
