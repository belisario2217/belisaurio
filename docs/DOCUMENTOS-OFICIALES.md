# Documentos oficiales y validación por QR

## Nombre del programa

Los documentos, sus consultas de validación y las listas exportadas presentan el
programa como **Licenciatura en Enfermería**, sin añadir IFOP ni UNITEN al nombre
del grado. Se conservan los nombres internos de los catálogos y de los planes.
La constancia mantiene la autoridad, el RVOE y la clave institucional que le
correspondan: esta presentación no modifica el convenio UNITEN ni el RVOE propio
de IFOP. Los registros y las huellas de documentos ya emitidos no se reescriben.

## Contenido de cada documento

| Documento | Contenido |
| --- | --- |
| Boleta | Solo el semestre actual, con parciales, calificación final y espacios de firma. |
| Historial académico | Materias cursadas de semestres anteriores y la carga actual. Excluye semestres futuros y materias anteriores nunca cursadas. |
| Constancia | Inscripción, programa, RVOE, modalidad, horario, semestre y calendario del ciclo activo. |
| Estado de cuenta | Alumno, pagos, folios físicos y total pagado, en PDF carta o Excel. |

Por ejemplo, un alumno en tercero recibe una **boleta de tercero** y un **historial de
primero, segundo y tercero**, según su avance registrado. Pertenecer a un plan de seis
semestres no incorpora materias futuras. La carga efectiva tiene prioridad sobre el plan.
Sin carga registrada, se utilizan las materias obligatorias del semestre; una optativa
necesita inscripción o evaluación. Los parciales incompletos no constituyen una nota final.
Las evaluaciones de otro ciclo no se arrastran a la boleta actual.

## Ciclo escolar y semestre

El **semestre** representa el avance curricular. Se toma de la inscripción del alumno o,
en su ausencia, del semestre de su grupo. No se deduce del número de parciales ni de la
duración del plan. Sin semestre configurado, se solicita corregirlo antes de emitir.

El **ciclo escolar**, por ejemplo **2026B – 2027A**, representa un periodo de tiempo y puede
reunir grupos de distintos semestres. Se utiliza el ciclo activo del grupo y, en su ausencia,
el institucional. La inscripción sirve de respaldo para datos antiguos. El ciclo de
formación del grupo no sustituye al activo.

En **Configuración → Calendario académico → Calendario del ciclo escolar**, selecciona el
ciclo y guarda su inicio, fin y vacaciones. Por ejemplo: actividades del 10 de agosto de
2026 al 23 de enero de 2027 y vacaciones del 18 de diciembre al 4 de enero. Las fechas deben
ser reales, estar en orden y las vacaciones no pueden superponerse ni salir del ciclo.
Las nuevas constancias precargan esas fechas, independientemente del semestre. El personal
autorizado puede ajustar las fechas de una emisión en el editor de constancias. Los eventos sin ciclo o de otro ciclo no aportan vacaciones a una constancia.
Editar el inicio académico conserva el inicio de cobro previamente utilizado por los alumnos.

## Institución del plan: IFOP y UNITEN

En **Planes académicos → Editar → Institución del plan**, configura quién reconoce el
plan, independientemente del nombre del programa o del ciclo escolar:

| Institución del plan | Texto de la constancia | CCT |
| --- | --- | --- |
| IFOP · RVOE propio | RVOE propio del plan IFOP, sin mencionar UNITEN ni convenio con otra escuela. | 27MSU0108N |
| UNITEN · Convenio de colaboración | Convenio de colaboración con Centro Universitario Tecnológico de Enfermería (UNITEN) y RVOE de ese plan. | 18PSU0074C |

La **CCT** y el **RVOE** son datos distintos. Se conserva el número de RVOE registrado
en cada plan; cambiar la institución no inventa ni sustituye ese número. Las constancias
UNITEN no imprimen la CCT de IFOP. El QR muestra la misma institución, CCT y RVOE que el PDF.

La migración 032 clasifica los planes existentes por su nombre y clave, dando prioridad
al plan frente al programa; reconoce UNITEN y mantiene los demás como IFOP. La selección
queda guardada y puede corregirse en el editor. Cambiar después el nombre del plan no
cambia su institución automáticamente. La inscripción del alumno tiene prioridad sobre
el plan del grupo. Si el programa tiene planes de ambas instituciones y no hay un plan
asignado al alumno ni al grupo, se solicita asignarlo antes de emitir la constancia.

Los documentos ya emitidos conservan sus datos originales. Para corregir una constancia
anterior, revócala desde Documentos emitidos y emite una nueva con el plan correcto.

## Emisión y validación

En **Documentos**, selecciona al alumno, revisa el semestre y ciclo mostrados y pulsa
**Emitir boleta**, **Emitir historial** o **Revisar y emitir constancia**. **Boletas por grupo** genera
un documento y folio por alumno. Los estados de cuenta se descargan desde **Cobros**.

El QR abre `/verificar-documento/<código>` sin iniciar sesión. Muestra institución, tipo,
validez, alumno, matrícula, programa, semestre, ciclo, folio y fecha de emisión en horario de
Ciudad de México. También muestra materias, calificaciones, calendario o pagos para
cotejarlos con el impreso. El estado de cuenta imprime la misma huella SHA-256 del registro.

Las emisiones conservan una copia inmutable de sus datos y una huella SHA-256. Cambiar al
alumno, las notas o el calendario no altera documentos anteriores. Los códigos aleatorios
no caducan. La consulta omite CURP, teléfono, correo, domicilio personal y contraseñas.
Desde **Documentos emitidos**, el personal autorizado puede verificar o **Revocar** una
emisión indicando el motivo. Su QR mostrará que perdió validez. Para corregir, revoca el
documento anterior y emite otro.

## Dominio público y conservación

En **Configuración → Institución → URL pública de la plataforma**, registra su dominio
HTTPS, por ejemplo `https://escuela.edu.mx`, sin rutas de archivos o API. Debe abrir la
aplicación desde un teléfono. Si queda vacío, se usa `PUBLIC_APP_URL`, después
`RENDER_EXTERNAL_URL` y después `APP_ORIGIN`. Render proporciona su URL automáticamente.
En desarrollo se admite `http://localhost:4173`; producción requiere una URL configurada.
Los encabezados de una solicitud no pueden modificar el destino del QR.

Conserva el dominio y los respaldos SQLite, que incluyen las emisiones. La consulta depende
de que la plataforma y su base estén disponibles. Los documentos antiguos sin QR se pueden
emitir nuevamente. La migración `030_official_documents.sql` se aplica automáticamente al
iniciar y no requiere restablecer la base. Reiniciar no restaura vacaciones eliminadas.

La emisión académica y revocación requieren `reports.generate`; los estados de cuenta,
`payments.export`. `/api/documents/verify/:token` es público, limita la frecuencia y evita
caché. Los archivos mantienen sus rutas de descarga autorizadas.

## Constancias editables y Word

En **Documentos → Alumno → Revisar y emitir constancia**, o desde **Alumnos → Generar
constancia**, se abre una revisión previa con los datos actuales. Puedes editar el nombre
de los estudios, RVOE, descripción del semestre, modalidad, horario, ciclo, inicio y fin de
actividades, vacaciones, fecha indicada, lugar de expedición, encabezado del temario y
asignaturas (nombre y tipo). También puedes añadir o quitar vacaciones y asignaturas.
**Restablecer datos** recupera los valores precargados. Cancelar no emite ningún folio.

Selecciona **PDF para imprimir** o **Word editable (.docx)** y pulsa **Emitir y descargar**.
Cada emisión tiene su folio y QR. Los ajustes no actualizan planes, materias, inscripciones,
calificaciones ni calendarios generales. El nombre del alumno, matrícula y autoridad del
plan se conservan; IFOP mantiene su CCT y UNITEN su convenio y clave correspondiente.
El programa se precarga sin sufijos institucionales, pero un nombre personalizado se
conserva literalmente en esta constancia y su QR.

Las fechas deben ser reales y estar ordenadas; las vacaciones quedan dentro del periodo
de actividades y no se superponen. Se admiten hasta 12 vacaciones y 80 asignaturas.
La fecha indicada en la constancia es editable; la fecha y hora **real** de emisión
registradas por la plataforma permanecen automáticas. La consulta pública muestra ambas.

El Word incluye membrete, logo, temario, firma de Control Escolar y QR. El QR coteja los
datos registrados al emitir, tanto en PDF como en Word. **Editar el Word después de
la descarga no modifica el registro de validación**: para registrar una corrección,
emite una nueva constancia y revoca la anterior. Una nueva descarga desde el editor
es una nueva emisión y genera otro folio.

API administrativa (`reports.generate`): `GET /api/reports/study-certificate/draft?studentId=…`
precarga sin emitir; `POST /api/reports/study-certificate.pdf` y `.docx` reciben
`{ studentId, draft }`. El GET anterior de PDF sigue disponible con valores predeterminados.
El generador Word se importa únicamente cuando se solicita ese formato.

## Estados de cuenta por grupo o de todos los alumnos

En **Cobros → Descargar estados de cuenta por grupo o de todos los alumnos** elige
**Todos los alumnos activos** o un grupo y el mes límite de pagos. Pulsa
**Descargar estados de cuenta PDF**. La selección es independiente del buscador de
alumnos y del reporte mensual de ingresos. Se incluyen todas las cuentas elegibles,
sin el límite de 20 resultados del buscador, incluso alumnos sin pagos.

Se genera un solo PDF con el formato de cada estado individual: membrete, movimientos,
folios físicos, total pagado, firma y QR propio. Los alumnos se ordenan por grupo y
apellidos; cada uno comienza en una hoja nueva y conserva la paginación de sus movimientos.
El mes elegido incluye pagos hasta ese mes y todos los anteriores. No cambia las reglas
de contabilización de pagos ni los saldos del sistema. Las descargas individuales PDF y
Excel siguen disponibles al seleccionar un alumno.

Se consideran alumnos activos con inscripción activa; cuando existen varias, se utiliza
la última, por lo que un alumno aparece una sola vez y en su grupo vigente. El selector
muestra los grupos con alumnos elegibles y su cantidad. Cada emisión genera un folio y
registro de validación por alumno con exactamente sus movimientos y total impreso.

La plataforma prepara un alumno a la vez y un solo lote a la vez. El PDF se escribe en
un archivo temporal privado y se descarga únicamente cuando está completo. Se elimina
tras el envío o si se cancela la conexión. Una segunda preparación simultánea solicita
esperar y reintentar; las demás operaciones de la plataforma continúan disponibles.

Permiso: `payments.export`. `GET /api/payments/statement-options` devuelve grupos y
cantidades sin depender del permiso de catálogos. `GET /api/payments/statements.pdf`
recibe `throughMonth=AAAA-MM` y opcionalmente `groupId`.
