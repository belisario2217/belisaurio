# Uso de recursos en Render

- Los cálculos de colegiaturas reutilizan el formateador de fecha de México y calculan la fecha una vez por resumen o calendario. Las búsquedas de pagos usan mapas y conjuntos, conservando el orden y los resultados anteriores, incluidos duplicados y pagos enlazados.
- Una visita al portal sincroniza únicamente las materias del alumno autenticado. Los cambios administrativos de calendario mantienen la sincronización general. El índice parcial de la migración 040 acelera la búsqueda de materias pendientes automáticas.
- Los archivos JS, CSS y fuentes con hash de compilación permiten caché de un año. El HTML se revalida para obtener las nuevas versiones. Los logotipos, las fotos y los datos académicos o financieros no reciben esa caché permanente.
- Las rutas API desconocidas devuelven un error JSON, en lugar de descargar el HTML de la aplicación.

Validación local: 50 cálculos sintéticos de cuentas de seis semestres tardaron 351.54 ms antes y 21.72 ms después. Se compararon también resúmenes y calendarios de 12 escenarios de pagos con duplicados, vínculos ausentes y colegiaturas exentas; todos coincidieron. Esta medición corresponde al cálculo local, no al tiempo total de respuesta en producción.

No se requiere aumentar el plan de Render ni agregar procesos o servicios para estos cambios.

## Arranque y documentos

- La vinculación de cuentas de alumnos solo escribe cuando cambian el nombre, correo, rol, activación o datos temporales necesarios. Repetir el arranque con cuentas sincronizadas no modifica registros ni contraseñas; las cuentas eliminadas permanecen eliminadas.
- ExcelJS se carga al generar una hoja de cálculo, en lugar de cargarlo al arrancar el servidor o consultar el portal. Los formatos y membretes se conservan.
- El lector de PDF mantiene un procesador activo y hasta dos cargas esperando. Cada lectura conserva el límite de 15 segundos y libera el procesador antes de empezar la siguiente, incluso ante errores. Si la capacidad está ocupada, responde 503 solicitando reintentar. La cola no retiene el resultado del último PDF.
- Los anchos de columnas se calculan sin crear arreglos intermedios ni expandir todas las filas como argumentos de una función; al alcanzar el ancho máximo se detiene esa búsqueda.

Las pruebas cubren arranques repetidos sin escrituras, actualización de cuentas, lectura en orden, errores y tiempos de espera, además de los archivos Excel y PDF existentes.
