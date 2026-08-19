# Configurar persistencia de Radio Periquín con Supabase

## 1. Crear proyecto

En Supabase crea un proyecto nuevo dedicado a Radio Periquín. Para pruebas puede usarse el plan Free.

## 2. Crear las tablas y el bucket

Abre **SQL Editor → New query** y pega todo el contenido de:

`supabase/001_radio_periquin.sql`

Ejecuta la consulta completa. Esto crea:

- `rp_state`
- `rp_history`
- `rp_media`
- función transaccional `rp_publish_config`
- bucket público `radio-periquin-media`

No pongas el `RADIO_ADMIN_TOKEN` ni ninguna clave de Supabase dentro del SQL.

## 3. Obtener credenciales del backend

Necesitas dos valores:

- `SUPABASE_URL`: Project URL del proyecto.
- `SUPABASE_SECRET_KEY`: una Secret key `sb_secret_...`.

La Secret key es una credencial de backend con privilegios elevados. No debe compartirse con Studio Desktop ni incluirse en Android.

## 4. Agregar variables en Render

En `radioperiquin` → **Environment** agrega:

```text
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_MEDIA_BUCKET=radio-periquin-media
PUBLIC_BASE_URL=https://radioperiquin.onrender.com
```

Conserva también tu `RADIO_ADMIN_TOKEN` actual.

Guarda y ejecuta un redeploy.

## 5. Confirmar

Abre:

`https://radioperiquin.onrender.com/health`

Debe mostrar un bloque similar a:

```json
{
  "persistence": {
    "mode": "supabase",
    "durable": true,
    "database": "online",
    "media": "online",
    "bucket": "radio-periquin-media"
  }
}
```

Si aparece `mode: local`, Render no está viendo alguna de las variables de Supabase.

Si `database` muestra `error`, normalmente falta ejecutar el SQL o la clave no tiene privilegios adecuados.

Si `media` muestra `error`, revisa que el bucket exista.

## 6. Probar desde Studio

Abre Radio Periquín Studio v0.3.0. En Resumen aparecerá una tarjeta **PERSISTENCIA**. Debe indicar:

`SUPABASE · DB + imágenes persistentes`

Luego:

1. cambia un texto;
2. publica;
3. sube una imagen;
4. confirma que aparezca en Multimedia;
5. haz un redeploy de Render;
6. verifica que el texto, historial e imagen sigan existiendo.

Esa última prueba valida la fase completa.
