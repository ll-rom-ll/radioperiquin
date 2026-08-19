# Radio Periquín Cloud v0.3.0

Esta versión extiende exclusivamente la API administrativa. La API que consume Android permanece compatible.

- `/api/v1/admin/history`
- `/api/v1/admin/history/:version`
- `/api/v1/admin/restore/:version`
- `/api/v1/admin/media` (GET)

Las restauraciones siempre incrementan `contentVersion` y guardan la publicación que estaba activa antes de restaurar.
