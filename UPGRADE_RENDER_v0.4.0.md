# Actualizar Render a Radio Periquín Cloud v0.4.0

1. Crea el proyecto de Supabase.
2. Ejecuta `supabase/001_radio_periquin.sql`.
3. En Render agrega `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_MEDIA_BUCKET`.
4. Conserva el mismo `RADIO_ADMIN_TOKEN`.
5. Sube v0.4.0 al mismo repositorio y haz deploy.
6. Abre `/health` y confirma `version: 0.4.0` y `persistence.mode: supabase`.
7. Abre Studio Desktop v0.3.0 y confirma que la tarjeta **PERSISTENCIA** indique Supabase.
8. Publica un cambio y sube una imagen.
9. Haz un redeploy de Render y confirma que ambos siguen presentes.

La app Android no necesita recompilarse para esta actualización de backend.
