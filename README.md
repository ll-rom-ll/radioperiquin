# Radio Periquín Cloud v0.3.0

Backend central de Radio Periquín. Mantiene compatible la API pública usada por Android y añade funciones de CMS para Studio Desktop.

## Qué controla

- URL pública del stream SHOUTcast/SonicPanel.
- Nombre y subtítulo de la estación.
- Programa actual y presentador.
- Texto de respaldo de "Ahora suena".
- Próximo programa, avisos e imagen principal.
- Programación completa.
- Cuentos e imágenes remotas.
- Mensaje de escucha segura.

## Nuevo en v0.3.0

- Historial de publicaciones en Cloud.
- Lectura de una versión histórica completa.
- Restauración segura: restaurar vN crea una **versión nueva**, no sobreescribe ni borra el estado actual.
- Listado administrativo de la biblioteca multimedia ya subida.
- Metadata de multimedia: tamaño, fecha y si la imagen está referenciada por la configuración actual.

## Seguridad

La app pública usa únicamente `GET /api/v1/public/config` y nunca recibe `RADIO_ADMIN_TOKEN`.
Todas las rutas `/api/v1/admin/*` requieren `Authorization: Bearer <RADIO_ADMIN_TOKEN>`.

## Ejecutar localmente

```powershell
npm run check
npm run smoke
npm start
```

## Endpoints

### Públicos

- `GET /health`
- `GET /api/v1/public/config`
- `GET /media/<archivo>`

### Administrativos

- `GET /api/v1/admin/config`
- `PUT /api/v1/admin/config`
- `GET /api/v1/admin/history?limit=50`
- `GET /api/v1/admin/history/<version>`
- `POST /api/v1/admin/restore/<version>`
- `GET /api/v1/admin/media`
- `POST /api/v1/admin/media?filename=...`

## Persistencia

La configuración actual, historial e imágenes usan `RADIO_STORAGE_ROOT`:

- `data/config.json`
- `data/history/`
- `media/`

**Render Free usa almacenamiento efímero.** Es adecuado para desarrollo, pero un redeploy/reinicio puede perder publicaciones e imágenes que no estén en el repositorio. Para producción usa un disco persistente o, en una fase posterior, object storage/base de datos.
