# Listas de asistencia para descargar

En **Administración de grupos**, el bloque **Descargar listas de asistencia** aparece al
inicio de la página, también desde el celular. Está disponible para personal con permisos
`students.view` y `reports.generate`; no se modifican los permisos existentes.

1. Selecciona un **grupo activo**.
2. Elige el **semestre** curricular; se precarga el semestre configurado del grupo.
3. Selecciona una **materia** o conserva **Lista general del grupo**.
4. Descarga **PDF** para imprimir o **Excel** para editar y completar.

Las listas incluyen nombre de la escuela, logo, ciclo activo, grupo, semestre, materia,
docente asignado si existe, matrícula y nombre de cada alumno, ordenados por apellidos.
Ofrecen 16 columnas con espacios para anotar fechas y registrar asistencia, falta o
justificación. El PDF utiliza papel carta horizontal y repite encabezados al paginar;
el Excel conserva el membrete, permite editar celdas y repite encabezados al imprimir.

Se incluyen únicamente alumnos activos con inscripción activa vigente en el grupo y
semestre elegidos. El semestre se toma de su inscripción y, si falta, del grupo. El ciclo
activo del grupo tiene prioridad sobre el institucional y el ciclo original de la inscripción.
La materia se toma de la carga del alumno o de las asignaciones activas del grupo para ese
semestre y ciclo; sin carga ni asignación actual se utilizan las materias obligatorias de
su plan. Las optativas requieren carga o asignación. No se incorporan materias futuras,
evaluaciones de otros ciclos ni alumnos dados de baja. Si no hay coincidencias, se informa
antes de descargar. No es una reconstrucción de listas históricas de semestres anteriores.

La captura y consulta digital de asistencia del alumno continúan retiradas. Los registros
históricos se conservan, y la asistencia no condiciona la captura de calificaciones.
Descargar una plantilla no crea ni modifica inscripciones, materias, calificaciones ni asistencias.

API autorizada: `GET /api/group-management/:id/attendance-list?semester=3` devuelve
materias y conteo; admite `subjectId`. Las terminaciones `.pdf` y `.xlsx` descargan la lista
con los mismos filtros. Las antiguas rutas `/api/attendance` continúan deshabilitadas (410).
