# Radio Periquín Cloud v0.1.0

Backend central para que las apps públicas de Radio Periquín reciban cambios de contenido sin recompilar la APK.

## Qué controla

- URL pública de la radio (SHOUTcast/SonicPanel u otro stream HTTPS).
- Nombre y subtítulo de la estación.
- Programa actual y presentador.
- Texto de respaldo de "Ahora suena" (SonicPanel sigue teniendo prioridad).
- Próximo programa y hora.
- Avisos de portada.
- Imagen principal remota.
- Programación completa.
- Lista de cuentos e imágenes remotas.
- Mensaje de escucha segura.

## Seguridad

La app pública usa únicamente `GET /api/v1/public/config`; no recibe el token administrativo.
Las operaciones de publicación y subida de imágenes requieren `Authorization: Bearer <RADIO_ADMIN_TOKEN>`.

## Ejecutar en Windows para desarrollo

1. Instala Node.js 20 o superior.
2. Copia `.env.example` como `.env`.
3. Cambia `RADIO_ADMIN_TOKEN` por un valor largo y aleatorio.
4. En PowerShell, dentro de esta carpeta:

```powershell
npm run check
npm start
```

5. Abre `http://localhost:8787/admin/`.

> Android público exige una URL HTTPS para la configuración remota. `localhost` sirve para probar el panel y el API en la PC, pero para que teléfonos fuera de la PC lo consuman hay que desplegar este servicio detrás de HTTPS.

## Endpoints

- `GET /health`
- `GET /api/v1/public/config`
- `GET /api/v1/admin/config` (Bearer token)
- `PUT /api/v1/admin/config` (Bearer token)
- `POST /api/v1/admin/media?filename=...` (Bearer token, body binario de imagen)
- `GET /media/<archivo>`
- `GET /admin/`

## Publicación eficiente

El endpoint público devuelve `ETag: "rp-<contentVersion>"`. La app Android envía `If-None-Match` y el servidor responde `304 Not Modified` cuando no hay cambios.

## Persistencia

- Configuración actual: `data/config.json`
- Historial: `data/history/`
- Imágenes: `media/`

Para un despliegue permanente, monta `data/` y `media/` en almacenamiento persistente o migra luego las imágenes a object storage.
