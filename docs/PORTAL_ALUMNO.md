# Portal del alumno

- **Mi avance** conserva el resumen de trayectoria y los accesos a las secciones.
- **Mis calificaciones**, **Mis pagos** y **Mi asistencia** tienen rutas y entradas propias en el menú, al igual que Mensajes importantes y Mi credencial.
- La tabla de calificaciones y la boleta descargable comparten la misma carga activa: semestre del alumno (o de su grupo), ciclo escolar activo y materias cargadas. No se publican pendientes, materias futuras ni materias del plan sin cargar. Una materia activa puede estar todavía sin calificación.
- Un parcial incompleto no aporta calificación final, aprobación, créditos obtenidos ni promedio final. Las importaciones con una nota única en una asignación de parciales se guardan en el parcial correspondiente.
- El ciclo activo no sustituye la fecha inicial de facturación ni se utiliza como número de semestre.

## Boleta del alumno

La descarga `/api/portal/report-card.pdf` usa exclusivamente el alumno de la sesión. Incluye membrete, materias activas, parciales y QR; no incorpora firma, sello, nombre de dirección ni espacios para firmar. Tanto el PDF como la verificación pública indican **«No tiene valor para trámites»**.

Se conserva un registro inmutable con propósito `student_copy`, folio `BA`, alumno, fecha y calificaciones de emisión. La validación comprueba la integridad y permite cotejar esos datos; no presenta la copia como un documento oficial para trámites. Las boletas oficiales administrativas conservan su formato de firma y sello.

## Corrección de datos anteriores

La migración 033 recupera notas de primer parcial de alumnos actualmente en tercer semestre cuando hay prueba de la antigua copia automática en los tres parciales: notas idénticas, materia ubicada en tercer semestre del ciclo activo y última entrada de historial procedente de la sincronización curricular. Conserva las filas originales en `grade_partial_repairs` y registra la corrección. No cambia parciales capturados por separado ni documentos ya emitidos.

La sincronización curricular deja de inventar parciales al registrar una nota final. La captura de parciales conserva el promedio provisional en el registro de evaluación, pero solo consolida una nota final en la trayectoria cuando están presentes los tres parciales.
