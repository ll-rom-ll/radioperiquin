# Fase v0.4.0 — Persistencia externa

Objetivo: sacar el estado crítico de Radio Periquín del filesystem efímero del Web Service.

## Implementado

- Adapter dual local/Supabase sin cambiar la API de Android.
- Postgres para configuración actual e historial.
- Supabase Storage para imágenes.
- publicación versionada mediante una función SQL transaccional.
- bootstrap inicial desde almacenamiento local cuando Supabase está vacío.
- `/health` con diagnóstico de persistencia.
- `/api/v1/admin/system` para diagnóstico administrativo.
- soporte para las nuevas Secret API Keys `sb_secret_...` y compatibilidad con `service_role` legacy.
- smoke test local y smoke test de adapter Supabase simulado.

## Compatibilidad

- Android v1.3.1: sin cambios requeridos.
- Studio Desktop v0.2.0: APIs existentes continúan funcionando.
- Studio Desktop v0.3.0: muestra visualmente el estado de persistencia.
