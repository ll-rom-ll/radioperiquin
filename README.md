# Radio Periquín Cloud v0.5.0

Backend central de configuración y contenido para Radio Periquín.

La API pública usada por Android se mantiene compatible (`GET /api/v1/public/config`). v0.5.0 conserva la persistencia Supabase de v0.4.0 y añade un canal realtime SSE (`GET /api/v1/public/events`) para avisar inmediatamente a las apps abiertas cuando Studio publica o restaura contenido.

## Modos de almacenamiento

### Desarrollo local
Sin variables de Supabase, Cloud sigue usando:

- `data/config.json`
- `data/history/`
- `media/`

### Producción recomendada
Con `SUPABASE_URL` + `SUPABASE_SECRET_KEY`:

- configuración actual → Postgres (`rp_state`)
- historial → Postgres (`rp_history`)
- metadata de imágenes → Postgres (`rp_media`)
- archivos de imágenes → Supabase Storage (`radio-periquin-media`)

La app Android **no se conecta a Supabase directamente**. Solo habla con Radio Periquín Cloud en Render.

## Seguridad

- `RADIO_ADMIN_TOKEN`: protege las APIs administrativas de Radio Periquín Cloud.
- `SUPABASE_SECRET_KEY`: solo existe en el backend/Render. Nunca debe entrar en Android, Studio Desktop o GitHub.
- Las tablas administrativas tienen RLS y permisos de `anon`/`authenticated` revocados.
- El bucket multimedia es público únicamente para lectura de los assets que la app necesita mostrar; subir/modificar sigue siendo una operación del backend.

## Preparar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**.
3. Ejecuta `supabase/001_radio_periquin.sql`.
4. Copia la Project URL.
5. Crea/copia una **Secret key** (`sb_secret_...`) para el backend.
6. Configura en Render:

```text
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_MEDIA_BUCKET=radio-periquin-media
```

Consulta `SETUP_SUPABASE_v0.4.0.md` para el procedimiento completo.

## Ejecutar localmente

```powershell
npm run check
npm run smoke
npm run smoke:supabase
npm start
```

Los smoke tests no necesitan una cuenta real de Supabase: `smoke:supabase` usa un servidor simulado para comprobar el adapter remoto.

## Endpoints públicos

- `GET /health`
- `GET /api/v1/public/config`
- `GET /api/v1/public/events` — canal SSE de actualizaciones realtime
- `GET /media/<archivo>` (solo modo local/legacy)

## Endpoints administrativos

- `GET /api/v1/admin/config`
- `PUT /api/v1/admin/config`
- `GET /api/v1/admin/system`
- `GET /api/v1/admin/history?limit=50`
- `GET /api/v1/admin/history/<version>`
- `POST /api/v1/admin/restore/<version>`
- `GET /api/v1/admin/media`
- `POST /api/v1/admin/media?filename=...`

## Migración automática inicial

Si Supabase está vacío al arrancar v0.4.0, Cloud intenta usar el contenido local existente como semilla. Si encuentra imágenes locales, intenta subirlas al bucket y sustituir sus URLs antes de crear el estado remoto.

Después de que `rp_state` exista en Supabase, Supabase pasa a ser la fuente de verdad y los redeploys de Render no reinicializan el contenido.

## Realtime v0.5.0

Las apps Android v1.4.0 mantienen una conexión SSE mientras están abiertas. Al publicar/restaurar, Cloud emite un evento pequeño con `contentVersion`; Android vuelve a consultar el JSON público con ETag. Si SSE se corta, la app reconecta automáticamente y conserva un polling de respaldo de baja frecuencia. No hace falta ejecutar SQL adicional en Supabase para pasar de v0.4.0 a v0.5.0.
