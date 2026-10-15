# Credenciales estudiantiles

## Emisión administrativa

1. Abre **Credenciales** en Información y documentos. El permiso `credentials.manage`
   corresponde inicialmente a Administrador, Control escolar y Coordinador académico.
2. Busca al alumno por nombre o matrícula en el padrón. El nombre, la matrícula, el
   programa, el grupo y el ciclo se completan desde su inscripción; no se capturan otra vez.
3. Carga una fotografía JPG, PNG o WebP de hasta 10 MB y 40 megapíxeles. Se recomienda
   fotografía tipo infantil, de frente y con fondo blanco. El sistema conserva el archivo
   original y sus dimensiones, respeta su orientación y permite ajustar posición y zoom.
4. Revisa el frente y el reverso. **Prueba de impresión** produce un PDF marcado como
   vista previa, sin activar la credencial ni habilitar una descarga al alumno.
5. Usa **Activar y publicar**. Se necesita fotografía e inscripción activa, y la fecha
   actual debe estar dentro del calendario del ciclo activo. El alumno ya puede descargar
   el PDF autorizado desde **Mi credencial**.

Cambiar la fotografía o guardar un nuevo encuadre desactiva la emisión anterior. Es
necesario volver a activar la credencial. **Desactivar credencial** retira inmediatamente
la descarga y la validez del QR, incluso si existe una copia previamente descargada.

## Fotografía enviada desde el portal del alumno

En **Mi credencial**, el alumno puede abrir **Tomar o cargar mi fotografía** y
elegir su galería o la cámara frontal. La guía ilustrada muestra el fondo totalmente
blanco y uniforme, el uniforme escolar, la cámara a la altura de los ojos y el rostro
centrado. La cámara en vivo presenta un óvalo y referencias para ojos y centro;
la guía se excluye de la captura. Si el navegador no ofrece cámara, niega el permiso
o no responde, está disponible **Abrir cámara del dispositivo** y la galería.
Al cerrar o abandonar la captura se detienen las pistas de cámara, incluso si el
permiso se concede después de haber cancelado. El micrófono no se solicita.

El alumno confirma los requisitos y ajusta el mismo encuadre circular utilizado
por la credencial y el PDF. Se aceptan imágenes de 320 × 320 píxeles como mínimo,
hasta 10 MB y 40 megapíxeles; se recomienda más resolución. Las fotos HEIC/HEIF
se convierten a JPEG a resolución completa cuando el navegador puede abrirlas;
si no, se indica usar JPG o la cámara. Se respeta la orientación.

El aclarado opcional actúa únicamente sobre tonos claros y neutros conectados al
borde de la imagen y protege el área central destinada al rostro. No sustituye un fondo de color ni comprueba automáticamente
el uniforme. Se conserva el archivo enviado y se preparan versiones sin metadatos
de ubicación a resolución original para comparar. Administración comprueba el
resultado y puede elegir la versión sin aclarado o la preparada.

Los envíos aparecen en **Credenciales → Fotos por revisar**. Antes de
**Aprobar foto y publicar credencial**, el administrativo comprueba la imagen,
ajusta el encuadre y confirma los requisitos. La creación de PDF se completa antes
de sustituir la credencial publicada; foto, encuadre, emisión y revisión se guardan
en una sola transacción. El alumno y el sistema descargan exactamente la misma
versión aprobada. La vigencia sigue limitada por el ciclo activo y seis meses.

**Solicitar otra fotografía** requiere un motivo que aparece al alumno. Reenviar
una foto reemplaza el envío pendiente y exige otra revisión. Subir o rechazar una
propuesta conserva la credencial publicada, su QR y sus descargas. Solo la
aprobación y publicación de la nueva versión sustituyen la emisión anterior.
No se pueden aprobar envíos rechazados, reemplazados o ya revisados; las
actualizaciones simultáneas y los cambios durante la generación de PDF se detectan.

La migración `034_credential_photo_submissions.sql` añade la revisión y su historial.
Los originales y las propuestas permanecen en el almacén privado de credenciales;
el alumno solo accede a sus propios envíos y únicamente el personal con
`credentials.manage` puede revisar, aprobar o rechazar.

## Ciclo y vigencia

La vigencia se calcula automáticamente: termina en la primera de estas dos fechas,
el cierre del ciclo escolar activo o seis meses naturales después de la emisión. Los
meses se ajustan al último día disponible; por ejemplo, seis meses después del 31 de
agosto de 2026 es el 28 de febrero de 2027. La credencial es válida hasta el final de
ese día, según la fecha de Ciudad de México.

El ciclo se toma del ciclo activo del grupo y, si no está definido, del ciclo activo
institucional, con la inscripción como respaldo. El semestre curricular no determina
la vigencia. Revisa las fechas del calendario en Configuración antes de emitir.

El QR abre una consulta pública en línea con estado actual, foto autorizada, nombre,
matrícula, programa, grupo, ciclo, fecha de emisión, inicio de vigencia, vencimiento y
folio. No requiere sesión. Una credencial vencida, desactivada, con datos de identidad
modificados o sin inscripción activa no se muestra como vigente y no se puede descargar.
Cambiar de ciclo o corregir sus fechas requiere una nueva autorización; nunca extiende
silenciosamente la vigencia de un PDF emitido.

## Personalización e impresión

En **Personalizar diseño** puedes cambiar colores, franja lateral, textos, campus,
contactos, nombre y cargo de quien autoriza, y cargar una firma autorizada opcional.
Sin firma digital se mantiene el espacio para firma y sello. El logo se configura en
Configuración institucional. Los nombres y demás textos se ajustan en áreas fijas;
un nombre largo se centra y reduce su tamaño sin invadir la fotografía ni el QR.

El formato inicial reproduce las proporciones del PDF de referencia: dos páginas de
50 × 75 mm. También se ofrece un formato vertical de 54 × 85.6 mm. El PDF utiliza
texto y ornamentos vectoriales, QR vectorial y fotografía a resolución original.
La versión para hoja carta incluye ambas caras a tamaño real y guías de corte;
imprime al 100%, sin ajustar a la página. La calidad final de la foto depende del
archivo elegido, la impresora y el material.

Cada activación archiva los dos PDF definitivos. Los cambios posteriores al diseño
afectan las próximas activaciones; no modifican credenciales ya aprobadas. El alumno
descarga exactamente los mismos bytes que el administrativo y solo de su propia cuenta.

El logo, la fotografía y la firma se incrustan directamente en PDF 1.7, con recortes
nativos, para evitar que visores como el del iPhone los oculten al interpretar máscaras
SVG de transparencia. Las descargas de emisiones anteriores reciben una copia de
presentación compatible, creada a partir de sus datos y foto autorizados. Conserva el
folio, QR, fecha, vigencia y aprobación originales, y no requiere otra activación. Los
archivos originalmente archivados se conservan. Una credencial desactivada o vencida
sigue sin poder descargarse.

## Operación y almacenamiento

La migración `031_student_credentials.sql` añade tablas y permisos sin sustituir datos
existentes. Las imágenes y los PDF se guardan en la carpeta privada `credentials/`,
junto a `DATABASE_PATH`, fuera de `/uploads`. En Render permanece dentro del disco
persistente `storage/`. Incluye esta carpeta al respaldar o mover la instalación;
la descarga de respaldo de base de datos contiene solamente SQLite, no los archivos.

La URL pública del QR utiliza la configuración institucional de URL pública, después
`PUBLIC_APP_URL`, `RENDER_EXTERNAL_URL` o `APP_ORIGIN`. En producción debe ser una URL
HTTPS accesible desde los teléfonos. Las emisiones conservan esa URL original.

No se crean credenciales activadas automáticamente al instalar la función. Las fotos
y las firmas se validan por su contenido y se conservan en almacenamiento privado.
Las modificaciones y activaciones quedan registradas en la bitácora administrativa.
