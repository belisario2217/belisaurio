# Publicar Universidad IFOP en Render

1. Descomprime este archivo y sube su contenido a un repositorio de GitHub.
2. En Render selecciona **New > Blueprint**.
3. Conecta el repositorio y confirma la configuracion encontrada en `render.yaml`.
4. Render creara un servicio Node.js con un disco persistente de 1 GB.
5. Al terminar, abre la direccion `https://universidad-ifop.onrender.com` asignada al servicio.

La primera publicacion puede tardar varios minutos. El plan Starter y el disco persistente generan cargos en Render. La base SQLite y los logos se almacenan bajo `/opt/render/project/src/storage` para conservarlos entre publicaciones.

Los QR utilizan automáticamente `RENDER_EXTERNAL_URL`. Para un dominio propio, registra su
URL HTTPS en **Configuración → Institución → URL pública de la plataforma** antes de emitir.
Los respaldos SQLite incluyen los registros de validación.
Consulta [Documentos oficiales](docs/DOCUMENTOS-OFICIALES.md).
