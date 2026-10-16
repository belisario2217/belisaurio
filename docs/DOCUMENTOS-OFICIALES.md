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
Todas las nuevas constancias de ese ciclo usan las mismas fechas, independientemente del
semestre. Los eventos sin ciclo o de otro ciclo no aportan vacaciones a una constancia.
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
**Emitir boleta**, **Emitir historial** o **Emitir constancia**. **Boletas por grupo** genera
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
