# Radio Periquín Cloud v0.5.0 — Realtime Push

Esta versión añade un canal público de eventos SSE en:

`GET /api/v1/public/events`

Cuando Studio publica o restaura una versión, Cloud envía inmediatamente un evento `content` a las apps conectadas. La app Android entonces consulta `/api/v1/public/config` usando su ETag, por lo que el evento no contiene contenido editable ni secretos.

## Propiedades
- Sin credenciales administrativas en Android.
- Sin clave secreta de Supabase en Android.
- Heartbeat SSE configurable (20 s por defecto).
- Reconexión automática del cliente Android.
- Polling de respaldo de baja frecuencia si el canal realtime se interrumpe.
- `/health` y `/api/v1/admin/system` exponen el estado realtime y el número de clientes conectados.

## Variables opcionales
- `RADIO_REALTIME_HEARTBEAT_SECONDS=20`
- `RADIO_REALTIME_MAX_CLIENTS=2000`

No requiere cambios de esquema en Supabase respecto a v0.4.0.
