# Guía de uso

## Acceso y permisos

Inicia sesión con una cuenta activa. El menú muestra únicamente módulos permitidos por el
rol. En **Usuarios y roles** el administrador puede crear cuentas, desactivarlas y ajustar
permisos por módulo. Cuando el rol es **Alumno**, también debe seleccionar la matrícula
que corresponde a la cuenta.

Acceso de ejemplo del alumno: `alumno@campusfrontera.edu.mx` / `Alumno123!`.

## Preparación académica

1. Abre **Catálogos**.
2. Configura nivel, programa, turnos y ciclo escolar.
3. Crea periodos y grupos vinculados al ciclo.
4. Registra materias, docentes, criterios y escalas.
5. En **Planes académicos**, registra el plan y agrega todas sus asignaturas, indicando si
   son obligatorias u optativas, sus créditos y el periodo sugerido.
6. En **Calificaciones**, crea las asignaciones de materia, grupo, docente y periodo.

Las ponderaciones de una asignación deben sumar 100%.

## Alumnos

Usa **Nuevo alumno** para registrar identidad, contacto e inscripción. La búsqueda y los
filtros permiten localizar alumnos por programa o grupo.

Para una carga masiva:

1. Selecciona **Importar**.
2. Descarga la plantilla.
3. Carga Excel o CSV.
4. Revisa filas válidas y errores.
5. Elige ignorar o actualizar matrículas existentes.
6. Confirma la importación.

## Calificaciones

Al crear una asignación selecciona **Tres parciales**, **Criterios ponderados** o
**Calificación final**. En tres parciales, el sistema calcula el promedio con los valores
capturados y marca el resultado definitivo cuando los tres están completos. En criterios,
el resultado se calcula por ponderación.

## Portal del alumno

El rol **Alumno** entra directamente a **Mi avance**. La vista presenta sus materias,
docente, tres parciales, promedio, créditos obtenidos y porcentaje de avance curricular.
Una materia aporta sus créditos cuando la calificación definitiva es aprobatoria; el 100%
corresponde a la suma total de créditos del plan asignado a su inscripción.

**Cerrar** bloquea cambios posteriores. Cada edición conserva valor anterior, valor nuevo,
usuario, fecha y motivo. El icono de historial muestra esa bitácora.

La importación de calificaciones valida matrícula, programa, turno, grupo, materia,
periodo, rango y estado de captura antes de permitir la confirmación.

## Cobros y estados de cuenta

En **Cobros**, busca y selecciona al alumno para consultar sus pagos y saldo. En el
encabezado de la cuenta, **PDF carta** abre un estado de cuenta institucional listo para
imprimir y **Excel** descarga el mismo formato con una segunda pestaña que conserva el
historial completo de movimientos. El PDF pagina cada 10 pagos y la pestaña **Estado de Cuenta**
de Excel cada 12. Cada hoja repite encabezado, datos del alumno, totales, firma, folio y QR.

Al registrar o editar un pago, captura el **NÚMERO DE FOLIO FÍSICO** impreso en el recibo,
con al menos cuatro dígitos, desde **0001** y sin límite superior de consecutivo (por ejemplo, **1001**, **9999**, **10000**). En **Finanzas → Folios** se consultan todos los folios registrados, ordenados numéricamente de menor a mayor, y se pueden exportar en CSV. El sistema conserva por separado su identificador
interno; los estados de cuenta muestran únicamente el folio físico.

### Ingresos de caja y meses cubiertos

Cada recibo se contabiliza una sola vez en el mes de su **fecha real de ingreso a
caja**. En Cobros, captura el importe total recibido, el folio y el primer y último
mes que cubre. Por ejemplo, $6,000 recibidos en septiembre para cubrir seis meses
son un ingreso de septiembre; no vuelven a sumarse a octubre ni a los meses siguientes.
La tabla de Colegiaturas conserva los meses cubiertos, pero marcar sus casillas no
crea recibos ni asigna fechas de caja. Un mes asociado a un recibo se corrige desde
Cobros o Folios, para no borrar ingresos accidentalmente desde esa tabla.

La actualización identifica los movimientos generados por la tabla anterior con
su folio automático y fecha calculada: conserva sus datos y cobertura, pero los
clasifica como cobertura administrativa, fuera de los ingresos. La clasificación
queda registrada para auditoría. Si ese registro era la
única captura de un cobro real, registra el recibo en Cobros usando su importe y
fecha comprobados; el sistema no inventa la fecha de caja.

En **Folios**, puedes aplicar **Desde el folio**, exportar CSV o **Descargar PDF**.
**PDF desde 0460** descarga directamente todos los registros desde el 0460 inclusive,
en orden numérico ascendente. No se inventan folios faltantes. El PDF indica la fecha
de ingreso y los meses cubiertos, y distingue registros manuales sin ingreso vinculado.

En **Finanzas → Folios**, el personal con permiso para administrar cobros puede
usar **Eliminar** en el registro que necesita corregir. Revisa el alumno, importe,
fecha y concepto y confirma **Eliminar registro**. Se elimina únicamente ese cobro
y se actualizan el estado de cuenta, el portal del alumno, los ingresos y el balance.
Si existe otro pago válido del mismo mes o inscripción, se conserva; si era el único,
la colegiatura o inscripción vuelve a quedar pendiente. Los registros manuales de
inscripción sin pago asociado también pueden eliminarse. La acción queda en bitácora.
Los estados de cuenta emitidos anteriormente conservan su información de emisión;
descarga uno nuevo para consultar los importes corregidos.

## Asistencia y autorización para evaluar

La sección **Asistencia** muestra al docente únicamente sus materias y grupos. El correo de su
usuario debe coincidir con el correo capturado en el catálogo de docentes. Para cada mes se
captura el total de clases impartidas y el número de asistencias de cada alumno; puede guardarse
como borrador y posteriormente confirmarse.

El alumno consulta los meses confirmados desde **Mi avance**. Para que un docente pueda capturar
su evaluación, el alumno debe acumular al menos **80% de asistencia confirmada** en la materia y
tener un pago identificado como **Inscripción** o **Reinscripción** dentro del periodo académico.
El estado de reinscripción también aparece en Alumnos y Cobros.

## Promoción al semestre siguiente

En **Administración de grupos**, cada alumno muestra sus mensualidades vencidas, el monto del
adeudo, la reinscripción del semestre destino y el resultado de la validación. La promoción solo
se habilita cuando están cubiertas las dos mensualidades exigibles más recientes, el alumno no
acumula más de dos mensualidades vencidas y existe un pago de inscripción o reinscripción
identificado específicamente para el siguiente semestre.

Al registrar una inscripción o reinscripción en **Cobros**, selecciona obligatoriamente el campo
**Semestre que ampara**. Por ejemplo, para promover de segundo a tercer semestre debe existir una
reinscripción marcada como **3.er semestre**; una reinscripción anterior no autoriza el avance.
Los pagos históricos que contienen el semestre en su concepto se identifican automáticamente.

### Correcciones manuales desde Alumnos

En **Alumnos**, abre el menú de acciones del estudiante y selecciona **Modificar reinscripción**. El administrador puede marcarla como pagada o pendiente y definir el semestre promovido. Cuando está pagada se solicitan obligatoriamente el folio físico, el monto y la fecha; el movimiento también queda registrado en el historial de pagos.

Si el cálculo automático no corresponde al expediente real, usa **Marcar cuenta regularizada**. La excepción es reversible, queda en auditoría y permite aplicar las reglas académicas sin mostrar un saldo de adeudo en las pantallas.

En **Administración de grupos** se configura el semestre vigente del grupo junto con el ciclo y el plan. La sincronización aplica los tres datos a todos sus alumnos. Para casos excepcionales, **Forzar** permite promover individualmente aunque no cumpla la validación automática.

Las colegiaturas se vuelven exigibles el día 10 de cada mes. El calendario comienza en la fecha de inicio de cobro del alumno o, si no existe una fecha individual, en el inicio del ciclo de formación; por ejemplo, una generación iniciada en agosto de 2025 se calcula desde ese mes hasta el mes actualmente exigible.

## Calendario académico y estado de materias

En **Configuración > Calendario académico** registra fechas de inicio de clases, evaluaciones parciales, inscripción, reinscripción, vacaciones, reanudación, fin de ciclo u otros eventos. Cada fecha puede vincularse a un ciclo escolar y contener un rango y una descripción.

Activa **Al llegar esta fecha, cambiar materias pendientes del semestre actual a “En curso”** en el inicio o reanudación de clases. La plataforma actualizará únicamente materias pendientes del semestre que cada alumno cursa; no cambia materias cursadas, calificaciones ni semestres futuros. Si el ciclo no tiene una fecha automática configurada, se utiliza su fecha oficial de inicio.

En **Reportes y documentos > Materias asignadas al grupo**, selecciona grupo, ciclo, semestre y estado. El botón **Aplicar estado al grupo** permite cambiar todos los registros filtrados a Pendiente, En curso o Cursada. Usa Cursada únicamente cuando el grupo haya terminado realmente las materias.

En **Colegiaturas mensuales**, al marcar un mes como pagado el concepto se genera con el
mes y el año correspondientes, por ejemplo **Colegiatura agosto 2026**.

Ambos documentos toman automáticamente la matrícula, nombre, programa, turno, periodo,
ciclo, pagos y total pagado. También incorporan el logo y responsable definidos en
**Configuración**, la fecha y hora de emisión, el lugar **Frontera, Centla, Tab.** y un
código de verificación SHA-256.

## Boletas y reportes

En **Documentos** selecciona al alumno para generar una boleta del semestre actual, un historial
acumulado hasta ese semestre o una constancia con las fechas del ciclo activo. La opción de
grupo genera una boleta por alumno. Todos incluyen folio y QR para cotejar los datos sin sesión.
Consulta [Documentos oficiales y validación por QR](DOCUMENTOS-OFICIALES.md) para configurar las
fechas del ciclo, el dominio público y la revocación de emisiones.

Los formatos operativos incluyen:

- Lista de alumnos
- Lista de asistencia
- Concentrado de calificaciones
- Reporte por materia
- Reporte por docente
- Alumnos reprobados
- Alumnos destacados

## Configuración institucional

En **Configuración** define nombre, dirección, contacto, responsable, ciclo activo, escala,
logo, colores y pie de página. Estos valores se aplican a boletas y documentos.

La pestaña **Actividad** muestra acciones administrativas recientes.

## Edición y eliminación

En **Planes académicos** usa **Editar** para modificar el programa, versión, datos generales
y la lista completa de asignaturas. **Eliminar** borra definitivamente el plan y desvincula
las inscripciones que lo utilizaban.

En alumnos y catálogos, el menú de acciones mantiene **Desactivar** y añade **Eliminar
definitivamente**. El borrado permanente de un alumno incluye inscripciones, calificaciones
y su cuenta vinculada. Para otros catálogos, el sistema bloquea la operación si el registro
todavía tiene dependencias que deben reasignarse.

Al activar **Forzar borrado**, el sistema elimina también las dependencias del registro,
como grupos, inscripciones, asignaciones y calificaciones. La advertencia y el botón cambian
antes de confirmar para distinguir claramente esta operación irreversible.

## Actualización de vistas, archivos y finanzas

La lista descriptiva y las instrucciones de los módulos nuevos están en [Mejoras IFOP Frontera](MEJORAS-IFOP-FRONTERA.md).

En **Finanzas → Nómina** se configuran docentes con horas semanales y tarifa por hora, y personal administrativo con tarifa diaria. Para cada pago se captura el periodo, semanas o días trabajados y fecha de pago. Primero se revisa el cálculo; al registrarlo se genera un egreso visible en **Finanzas → Balance**.

En **Balance → Nuevo egreso** se registran renta, servicios, materiales y otros conceptos de la escuela. Los ingresos se toman de los cobros registrados; solo los egresos pagados se restan. Los filtros mensuales y los reportes CSV permiten revisar el detalle.

En **Alumnos**, pulsa el nombre para abrir el expediente y consultar su avance. Desde ahí puedes marcar Próximo a egresar. **Reportes** y **Documentos** tienen entradas diferentes en el menú. El **Asistente de archivos** lee hojas, tablas o páginas, propone las columnas y aprende las reglas que confirmes.

## Membrete en PDF y Excel

Los documentos generados utilizan el logo y el nombre de la escuela configurados en **Configuración**, con Campus Frontera y los datos de contacto disponibles. Los reportes PDF repiten el membrete en cada página; las hojas Excel incluyen logo, encabezado institucional, fecha de emisión y encabezados de impresión. Las constancias, listas de asistencia, boletas y estados de cuenta conservan sus formatos institucionales.

Las plantillas Excel también incluyen membrete. Sus columnas, celdas de captura y fórmulas siguen funcionando para volver a importar el archivo. Puedes actualizar el logo o los datos de la escuela desde Configuración; los cambios se reflejan en las nuevas descargas.
