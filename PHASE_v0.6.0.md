# Radio Periquín Cloud v0.6.0 — Campaigns & Scheduled Publishing

Esta fase añade dos capacidades sin romper `GET /api/v1/public/config` ni el canal SSE existente:

- esquema de contenido v2 con `visibility` y `campaigns`;
- publicaciones programadas persistentes en local o Supabase;
- ejecución automática de publicaciones vencidas;
- recuperación/catch-up después de reinicios;
- evento Realtime `scheduled-publish` cuando una programación se ejecuta.

## Migración Supabase obligatoria

Si Cloud usa Supabase, ejecuta una sola vez en **Supabase → SQL Editor**:

`supabase/002_scheduled_publications.sql`

No vuelvas a ejecutar `001_radio_periquin.sql` si ya lo instalaste.

## API administrativa nueva

- `GET /api/v1/admin/schedules`
- `POST /api/v1/admin/schedules`
- `POST /api/v1/admin/schedules/:id/cancel`

Crear una programación usa:

```json
{
  "name": "Especial del sábado",
  "publishAt": "2026-08-22T20:00:00.000Z",
  "config": { "...": "snapshot completo del CMS" }
}
```

Cloud guarda una copia del borrador. Cambiarlo después en Studio no altera la copia ya programada.

## Scheduler

Por defecto Cloud comprueba la cola cada 20 segundos. Además procesa publicaciones vencidas antes de responder a `/health`, `/api/v1/public/config`, `/api/v1/public/events` y al listado administrativo. Esto permite recuperar una programación que venció mientras Render estaba reiniciándose o dormido.

Variables opcionales:

```env
RADIO_SCHEDULE_CHECK_SECONDS=20
RADIO_SCHEDULE_MIN_LEAD_SECONDS=15
```
