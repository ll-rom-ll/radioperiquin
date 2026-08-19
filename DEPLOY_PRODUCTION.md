# Radio Periquín Cloud v0.2.0 — despliegue de producción

## Opción recomendada para la primera puesta en línea: Render

El proyecto incluye `render.yaml` y `Dockerfile`. El Blueprint usa un servicio Starter con un disco persistente de 1 GB, porque `data/`, historial e imágenes deben sobrevivir a reinicios y despliegues.

1. Sube esta carpeta a un repositorio Git privado.
2. En Render crea **New > Blueprint** y selecciona el repositorio.
3. Render detectará `render.yaml`.
4. Cuando solicite `RADIO_ADMIN_TOKEN`, usa un secreto largo y único.
5. Despliega y espera a que `/health` muestre `ok: true`.
6. Copia la URL HTTPS asignada por Render, por ejemplo `https://radio-periquin-cloud.onrender.com`.
7. Añade en Render la variable `PUBLIC_BASE_URL` con exactamente esa URL para que las imágenes subidas tengan URLs absolutas correctas.
8. Abre `https://TU-URL/admin/`, carga contenido y publica un cambio de prueba.

## Android

En `gradle.properties` de la app pública configura:

```properties
radioContentUrl=https://TU-URL/api/v1/public/config
```

Después recompila la APK. Esa URL debe permanecer estable; desde Cloud podrás cambiar textos, imágenes y también `radio.streamUrl` sin recompilar.

## Persistencia

`RADIO_STORAGE_ROOT` permite separar los datos del código. En el Blueprint de Render se usa `/var/data/radio-periquin`; todo lo escrito bajo el disco montado persiste. No uses almacenamiento efímero para producción.

## Seguridad

- No pongas `RADIO_ADMIN_TOKEN` dentro de Android.
- La API pública es de solo lectura.
- Las rutas administrativas requieren Bearer token y tienen rate limit.
- El panel de administración funciona same-origin. Para un Studio web hospedado en otro dominio, añade ese dominio a `RADIO_ADMIN_ORIGINS`.
- Usa únicamente HTTPS en producción.
