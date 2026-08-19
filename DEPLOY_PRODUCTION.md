# Radio Periquín Cloud v0.4.0 — despliegue de producción

## Arquitectura

- Render: ejecuta la API Node de Radio Periquín Cloud.
- Supabase Postgres: configuración e historial.
- Supabase Storage: imágenes.
- SonicPanel/SHOUTcast: audio.

Render ya no necesita un disco persistente cuando Supabase está activo.

## Render

Conserva el servicio existente `radioperiquin` y configura estas variables:

```text
RADIO_ADMIN_TOKEN=<tu token actual>
PUBLIC_BASE_URL=https://radioperiquin.onrender.com
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_MEDIA_BUCKET=radio-periquin-media
RADIO_ADMIN_RATE_LIMIT=120
```

No incluyas las claves reales en GitHub.

## Supabase

Ejecuta una vez `supabase/001_radio_periquin.sql` antes del primer deploy con las variables Supabase activas.

## Validación

`GET https://radioperiquin.onrender.com/health` debe devolver:

```json
{
  "ok": true,
  "version": "0.4.0",
  "persistence": {
    "mode": "supabase",
    "durable": true,
    "database": "online",
    "media": "online"
  }
}
```

## Android

No requiere cambios si ya apunta a:

`https://radioperiquin.onrender.com/api/v1/public/config`
