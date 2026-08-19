# Actualizar Render a Radio Periquín Cloud v0.6.0

1. Antes de desplegar, abre Supabase → SQL Editor.
2. Ejecuta completo `supabase/002_scheduled_publications.sql`.
3. Sube Cloud v0.6.0 al mismo repositorio que usa Render.
4. Conserva las variables existentes: `RADIO_ADMIN_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_MEDIA_BUCKET` y `PUBLIC_BASE_URL`.
5. Render hará redeploy. Abre `https://radioperiquin.onrender.com/health`.
6. Verifica `version: "0.6.0"` y `scheduling.enabled: true`.

No hace falta cambiar la URL pública ni regenerar `RADIO_ADMIN_TOKEN`.
