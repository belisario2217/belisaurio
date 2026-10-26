# Uso de recursos en Render

- Los cálculos de colegiaturas reutilizan el formateador de fecha de México y calculan la fecha una vez por resumen o calendario. Las búsquedas de pagos usan mapas y conjuntos, conservando el orden y los resultados anteriores, incluidos duplicados y pagos enlazados.
- Una visita al portal sincroniza únicamente las materias del alumno autenticado. Los cambios administrativos de calendario mantienen la sincronización general. El índice parcial de la migración 040 acelera la búsqueda de materias pendientes automáticas.
- Los archivos JS, CSS y fuentes con hash de compilación permiten caché de un año. El HTML se revalida para obtener las nuevas versiones. Los logotipos, las fotos y los datos académicos o financieros no reciben esa caché permanente.
- Las rutas API desconocidas devuelven un error JSON, en lugar de descargar el HTML de la aplicación.

Validación local: 50 cálculos sintéticos de cuentas de seis semestres tardaron 351.54 ms antes y 21.72 ms después. Se compararon también resúmenes y calendarios de 12 escenarios de pagos con duplicados, vínculos ausentes y colegiaturas exentas; todos coincidieron. Esta medición corresponde al cálculo local, no al tiempo total de respuesta en producción.

No se requiere aumentar el plan de Render ni agregar procesos o servicios para estos cambios.
