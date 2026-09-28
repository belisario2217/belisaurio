# Importar actas de calificaciones por materia

En **Calificaciones → Importar actas**:

1. Selecciona el grupo, uno o varios semestres y las materias que recibirán calificaciones. Solo aparecen asignaciones activas que usan tres parciales y tienen alumnos inscritos. El semestre corresponde al plan de estudios; cuando no hay materia en el plan se usa la secuencia del periodo académico existente.
2. Descarga la plantilla. Es el archivo original `ACTA DE CALIFICACIONES POR MATERIA.xlsx`, con sus encabezados, firmas y fórmulas.
3. Completa grupo en C2, ciclo en E2, semestre en C3, materia (nombre o clave) en E3 y programa en H3. Si cargas una sola asignación, puedes omitir estos datos; cualquier dato que escribas debe coincidir con la selección. Para cargar varias materias, copia la hoja del acta para cada materia y completa los encabezados. Elige una sola asignación si la misma materia tiene varios periodos de evaluación en el mismo ciclo.
4. Escribe el nombre completo en la columna B (admite nombres primero o apellidos primero) y las calificaciones en E, F y G. No se distingue entre mayúsculas y minúsculas ni acentos. Si hay nombres repetidos, escribe la matrícula en lugar del nombre. No se asignan notas por el número de lista.
5. Usa **Seleccionar archivo y validar**. Revisa alumno, matrícula, materia, semestre, parciales y promedio antes de confirmar. Las filas con error no se importan. Si hay un alumno duplicado para una misma materia, se excluyen ambas filas.
6. Elige **Ignorar existentes** o **Actualizar existentes** y confirma. La opción de actualizar conserva cualquier parcial cuya celda venga vacía. Las notas se guardan con historial en la plataforma y el alumno puede consultarlas al abrir o actualizar su portal.

**Cero es una calificación real.** La plantilla original contiene ceros de ejemplo: borra aquellos que correspondan a parciales todavía sin evaluar. Las líneas sin nombre se omiten. Las filas con nombre y todos los parciales vacíos también se omiten. Se admite decimal con punto o coma, dentro de la escala de la materia. No se admiten textos como NP ni fórmulas en los parciales. La columna H no se importa: el sistema calcula el promedio de los parciales capturados y mantiene el estado pendiente hasta completar los tres.

El formato tiene 22 alumnos por hoja. Para grupos mayores, duplica la hoja con los mismos encabezados y continúa con los alumnos restantes. También se pueden subir actas por separado.

La revisión caduca a los 15 minutos y solo puede confirmarla el usuario que la creó. La confirmación vuelve a revisar permisos, inscripción y cierre de captura. Los docentes conservan sus restricciones de asignación y elegibilidad de evaluación.

El formato anterior por matrícula continúa disponible mediante **Tabla anterior por matrícula (Excel o CSV)**. Su descarga está separada de la plantilla de acta.
