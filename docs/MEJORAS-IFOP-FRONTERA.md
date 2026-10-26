# Mejoras de la plataforma y adaptación a Universidad IFOP, Campus Frontera

Referencia: evolución de `GESTIONCENTRO` comparada con el repositorio `belisario2217/belisaurio`. Esta adaptación mantiene la identidad de Universidad IFOP y la operación de una sola sede. No incorpora supervisión de múltiples campus ni el paquete de cambios de seguridad de la otra plataforma.

La lista distingue funciones nuevas para IFOP de funciones que IFOP ya tenía y que se conservan o mejoran. No se presentan las importaciones de alumnos realizadas en otros campus como mejoras de software ni se trasladan esos datos.

## Organización y navegación

1. **Menú dividido por actividades — adaptado.** Inicio, Control académico, Finanzas, Información y documentos, Comunicación y Administración. Cada persona ve los módulos que corresponden a los permisos que ya tenía.
2. **Reportes separados de Documentos — adaptado.** Reportes concentra consultas, listas y control del avance curricular. Documentos concentra boletas individuales o por grupo y constancias de estudios. Se mantienen las plantillas y datos institucionales de IFOP.
3. **Orden alfabético por apellidos — ampliado.** El directorio de alumnos se ordena por apellido paterno, apellido materno y nombres. Las listas de grupos, calificaciones, cobros y exportaciones mantienen su agrupación académica y aplican ese orden dentro de cada grupo.
4. **Orden en catálogos y selectores — adaptado.** Los nombres se presentan en orden alfabético español, sin confundir la ñ con la n. Los selectores también consideran números para facilitar la lectura de nombres como Grupo 2 y Grupo 10. Los reportes académicos mantienen el orden de periodos y los rankings su orden por resultado.
5. **Búsqueda rápida de alumnos — adaptado.** Botón de búsqueda en la cabecera y atajo Ctrl+K o Cmd+K para encontrar un alumno por nombre o matrícula y abrir directamente su expediente.
6. **Inicio según el perfil — adaptado.** Administración y control escolar tienen indicadores y accesos a sus tareas; los docentes tienen su ficha y asignaciones; los alumnos continúan entrando a Mi avance.

## Diseño, colores, gráficas y animaciones

7. **Color por área de trabajo — adaptado.** Azul para el entorno general, violeta para lo académico, verde para finanzas y acentos cálidos para comunicación.
8. **Tarjetas e indicadores más claros — adaptado.** Fondos suaves, bordes redondeados, sombras discretas, iconos e indicadores distinguen alumnos, grupos, docentes, avances y resultados financieros.
9. **Transiciones y animaciones — adaptado.** Las tarjetas y controles responden al pasar el cursor, abrir secciones y cargar información. Se respeta la preferencia del dispositivo de reducir el movimiento.
10. **Carga y estados vacíos — ampliado.** Las nuevas vistas muestran mensajes de carga y esqueletos visuales. También explican cuándo faltan asignaciones, expedientes, movimientos o registros de nómina.
11. **Gráficas con colores consistentes — adaptado.** Las gráficas académicas utilizan la misma familia de colores del resto de la plataforma. Balance agrega una comparación de ingresos, egresos y resultado mensual.
12. **Diseño para celular y escritorio — ampliado.** Los controles se acomodan al ancho disponible. Las tablas conservan desplazamiento horizontal dentro de su sección; las acciones de cobros se reorganizan para evitar que salgan de la pantalla.

## Alumnos y avance curricular

13. **Expediente individual — añadido.** Se abre al pulsar el nombre del alumno o desde su menú de acciones. Reúne datos personales, plan y grupo, avance académico y, cuando corresponde a su vista, cobros.
14. **Avance visible en porcentaje — ampliado.** El expediente muestra porcentaje, materias acreditadas y créditos obtenidos respecto al total del plan. Mi avance conserva la consulta personal del alumno.
15. **Materias pendientes, en curso y acreditadas — mejorado.** Los parciales incompletos se presentan como En curso. Una materia registrada como cursada puede formar parte del avance sin inventar una calificación numérica.
16. **Próximos a egresar — añadido.** Administración puede colocar o quitar un distintivo desde el expediente y filtrar el directorio para ver esos alumnos. Es una marca administrativa; no cambia por sí sola su estatus ni acredita materias.
17. **Carga de materias por grupo — conservado.** Las materias y el docente se asignan al grupo; la carga se vincula al alumno al inscribirlo. El control curricular permite revisar y guardar avances individuales o del grupo.
18. **Periodos del plan y periodos de evaluación — conservado.** Se distinguen la ubicación del alumno en su plan y los parciales de calificación. IFOP conserva sus semestres y calendarios; la adaptación no convierte automáticamente sus planes a cuatrimestres.
19. **Modalidad En Línea — añadida.** Puede seleccionarse al crear o editar grupos. Tiene identificación LIN y aparece en los contextos de alumnos y documentos. Las modalidades Escolarizado, Semiescolarizado y Complementario se conservan.
20. **Bachillerato como nivel — conservado.** IFOP ya incluía Bachillerato; permanece disponible junto con sus demás niveles. No se duplica el catálogo.
21. **Mensajes del alumno — conservado.** El alumno continúa consultando mensajes importantes, calificaciones y estado de cuenta desde su propio portal.

## Docentes y administración

22. **Matrícula docente permanente — añadida.** Cada ficha docente recibe un identificador DOC. Permanece estable aunque se cambie el nombre, correo o número de empleado.
23. **Usuario vinculado directamente al docente — añadido.** Desde Usuarios, el botón Vincular matrícula docente permite elegir la ficha correspondiente. Las coincidencias inequívocas existentes se conservan como una vinculación directa; los casos ambiguos requieren selección.
24. **Vista docente con sus asignaciones — añadida.** Inicio presenta la ficha docente, su matrícula y sus materias, grupos y periodos asignados, con acceso a calificaciones.
25. **Vista administrativa con indicadores reales — ampliado.** Inicio muestra alumnos, grupos y docentes activos, y el número de alumnos marcados próximos a egresar. Se conserva el panel de resultados académicos.
26. **Accesos directos a tareas — añadido.** Tarjetas para alumnos y expedientes, captura de calificaciones, documentos, reportes, importación y finanzas.

## Asistente interno para cargar documentos

27. **Reconocimiento de archivos — añadido.** El asistente interpreta Excel XLSX/XLS, CSV, tablas de Word DOCX y PDF con texto seleccionable. Los documentos escaneados necesitan una versión con texto; no se incluye OCR.
28. **Pestañas, tablas o páginas separadas — añadido.** Se elige la sección del archivo que se quiere trabajar, en lugar de asumir que todo pertenece al primer grupo o a la primera hoja.
29. **Propuesta de columnas — añadido.** Sugiere matrícula, nombres, apellidos, CURP, teléfono, programa, grupo, plan, periodo y otros campos a partir de los encabezados. La persona puede corregir el mapeo.
30. **Reglas de nombres y fechas — añadido.** Permite confirmar si los nombres o apellidos aparecen primero, cuántos apellidos hay y cómo interpretar las fechas. No inventa apellidos ausentes.
31. **Nacimiento desde CURP — añadido.** Completa una fecha vacía cuando la CURP tiene formato, fecha y dígito verificador válidos y coincide con el nombre. Los conflictos se muestran para revisión. La fecha adaptada se guarda al confirmar la importación.
32. **Normalización de datos — añadido.** Corrige espacios repetidos y escritura de CURP y teléfonos. Muestra lo que cambió y las observaciones que requieren atención.
33. **Contexto académico del grupo — añadido.** El grupo seleccionado aporta programa, turno, ciclo, plan y periodo para completar la carga. Se usan sus datos de IFOP, sin copiar grupos de la otra plataforma.
34. **Aprendizaje de formatos — añadido.** Recuerda por usuario las columnas y reglas confirmadas. La memoria del formato no guarda nombres, CURP, teléfonos ni asignaciones individuales de alumnos.
35. **Revisión antes de aplicar — añadido.** El flujo es Leer → Adaptar y revisar → Validar → Confirmar. La vista permite editar los primeros 80 registros y valida todos los registros de la tabla, hasta 2,000 por carga.
36. **Tratamiento de registros existentes — conservado e integrado.** La persona elige conservar o actualizar alumnos existentes utilizando el flujo de importación de IFOP. Se muestran los errores y se aplican únicamente las filas válidas confirmadas.
37. **Procesamiento interno — añadido.** El asistente es reconocimiento y aprendizaje de formatos dentro de la plataforma. No utiliza una API externa de IA ni modifica por sí solo el código de la aplicación.

## Cobros, Balance, nómina y egresos

38. **Estado de cuenta del alumno — conservado y presentado en el expediente.** Se mantienen pagos, saldo, colegiaturas, inscripción y exportaciones existentes. Consultar un expediente no crea cobros nuevos.
39. **Balance mensual — añadido.** Calcula ingresos efectivamente registrados menos egresos pagados durante el mes elegido. Las colegiaturas pendientes no se suman como ingresos cobrados.
40. **Nómina docente — añadida a petición de IFOP.** Cada docente tiene su tarifa por hora y sus horas semanales. El importe es horas por semana × semanas pagadas × tarifa por hora. La carga sugerida proviene de asignaciones del ciclo activo, sin sumar otra vez los parciales de una misma materia y grupo.
41. **Nómina administrativa — añadida a petición de IFOP.** Cada trabajador tiene una ficha, puesto y tarifa diaria. El pago se calcula con los días efectivamente trabajados durante el periodo × tarifa diaria.
42. **Revisión del cálculo antes del pago — añadida.** Primero se muestran fórmula e importe. Registrar el pago crea exactamente un egreso y lo descuenta del Balance; no hay pagos automáticos por abrir una vista.
43. **Historial de nómina — añadido.** Cada pago conserva persona, periodo, tarifa, horas, semanas o días e importe utilizado. Cambiar una tarifa posteriormente no recalcula pagos anteriores. No se permite repetir ni superponer un periodo pagado a la misma persona.
44. **Renta y otros conceptos de egreso — añadido.** Incluye renta de escuela, electricidad, agua, internet y telefonía, material didáctico, mantenimiento, limpieza, proveedores y otros egresos. Pueden añadirse conceptos propios y registrar descripción, importe, fecha y notas del pago.
45. **Desglose y reportes financieros — añadido.** Balance muestra egresos agrupados por concepto y el detalle de movimientos. Nómina muestra pagos por mes y tipo. Ambos permiten descargar reportes CSV.

## Documentos institucionales

46. **Identidad IFOP en constancias — mejorado.** Las constancias conservan Universidad IFOP y añaden Campus Frontera bajo el nombre de la institución, también en páginas de continuación.
47. **Redacción según CURP — mejorado.** La constancia utiliza el alumno o la alumna y ajusta inscrito/inscrita y el/la estudiante cuando la CURP permite identificar el sexo; si el dato no es reconocible, utiliza la persona estudiante.
48. **Exportaciones y listas personalizadas — conservado y ordenado.** Se mantienen formatos de alumnos, calificaciones, listas y documentos de IFOP. Las listas personalizadas permiten elegir campos y conservan el filtro de grupo.

## Otras mejoras históricas de la plataforma de referencia

La plataforma GESTIONCENTRO también añadió doble programa para alumnos híbridos, matrícula HYB, selección independiente de carga académica y financiera por programa, plantillas académicas editables en Excel, historial de copias de estados de cuenta y avisos de espacio de trabajo. Esas funciones se registran aquí como parte del inventario histórico; no se presentan como funcionalidades nuevas ya activadas en IFOP por esta entrega. La adaptación concreta de esta entrega es la descrita en los 48 puntos anteriores.

## Dónde encontrar las funciones nuevas

- Inicio: indicadores y tareas por perfil; para docentes, matrícula y asignaciones.
- Alumnos: pulsar el nombre → expediente → avance; ahí se marca Próximo a egresar.
- Información y documentos → Documentos o Reportes.
- Información y documentos → Asistente de archivos.
- Finanzas → Balance.
- Finanzas → Nómina → Nómina docente o Nómina administrativa.
- Usuarios → botón Vincular matrícula docente.

## Ejemplos de nómina

- Docente: 10 horas semanales × 4 semanas × $125 por hora = $5,000.
- Administrativo: 22 días trabajados × $300 diarios = $6,600.
- Con una renta pagada de $8,000, esos tres egresos suman $19,600 y se restan de los ingresos registrados del mes.

Las nóminas comienzan sin tarifas ni pagos reales precargados. Administración debe configurar cada persona y registrar los pagos efectivamente realizados.
