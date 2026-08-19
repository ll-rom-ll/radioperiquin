# Actualizar Render a Radio Periquín Cloud v0.3.0

1. Conserva el mismo servicio `radioperiquin` y el mismo `RADIO_ADMIN_TOKEN`.
2. Reemplaza/actualiza en tu repositorio los archivos de este paquete.
3. Haz commit y push a la rama que Render despliega (normalmente `main`).
4. Render hará Auto-Deploy; si lo tienes desactivado usa **Manual Deploy → Deploy latest commit**.
5. Comprueba:
   - `https://radioperiquin.onrender.com/health` → `version: "0.3.0"`
   - Abre Radio Periquín Studio v0.2.0 y entra en **Historial** o **Multimedia**.

No necesitas cambiar `RADIO_ADMIN_TOKEN` ni recompilar la app Android.

## Importante si sigues en Render Free

El sistema de archivos es efímero. Antes de un redeploy, cualquier configuración o imagen creada solo dentro del contenedor puede desaparecer. Para pruebas está bien; para producción usaremos almacenamiento persistente/object storage en una fase posterior.
