# Asistencia diaria por alumno

En **Asistencia**, selecciona un grupo y una fecha. Marca **Presente** o **Falta** para cada alumno, o usa **Todos presentes** y modifica las faltas. Puedes guardar un borrador; **Confirmar día** exige que todos los alumnos tengan una marca.

Cada alumno tiene como máximo un registro por fecha, incluso si cambia de grupo. Una misma lista sirve para todas sus materias: ya no se captura asistencia por asignatura ni se escribe un total mensual de clases.

En **Días de clase del grupo**, captura el total real del mes de la fecha seleccionada y pulsa **Guardar días de clase**. Cada grupo y mes conserva su propio total. El porcentaje mensual es **días presentes confirmados / días de clase × 100**: 8 asistencias de 20 días equivalen a 40%. El total también se usa en el portal y para evaluación. Se permite cero si no hubo clases; no se permite un total menor que los días ya confirmados ni mayor que los días del calendario del mes. Para confirmar más días, primero aumenta el total.

Mientras no se configure un total, se mantiene el cálculo anterior basado en días confirmados. Los borradores y los días sin lista no crean faltas automáticamente, pero tampoco suman asistencias al total mensual configurado. Para evaluación se usa la asistencia del alumno en su ciclo escolar, común a todas sus asignaciones. Continúan vigentes el mínimo de 80% y la validación de inscripción/reinscripción pagada.

El portal del alumno muestra un resumen mensual de días presentes y registrados, sin repetir cada materia. Las listas institucionales para imprimir se generan una vez por grupo, con alcance a todas las materias.

Los docentes pueden consultar y capturar sus grupos asignados; quien tiene solo permiso de consulta no puede modificar la lista. Si dos personas editan la misma fecha, la segunda debe recargar antes de guardar para evitar sobrescribir los cambios de la primera. Las modificaciones quedan registradas en la bitácora.

## Historial anterior

La migración `025_daily_student_attendance.sql` agrega las nuevas tablas sin borrar los totales mensuales anteriores. En una fecha del mes correspondiente, el apartado **Historial anterior por materia de este mes (solo consulta)** muestra esos registros.

Los totales anteriores no incluyen fechas individuales y no se convierten en días ni se suman a la nueva asistencia. A partir de esta actualización, se necesita al menos un día confirmado para calcular la asistencia de evaluación. El endpoint anterior de captura mensual responde con una indicación para recargar la sección y usar el nuevo flujo.
