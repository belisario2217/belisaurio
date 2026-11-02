# Control docente por hora

La sección **Finanzas → Nómina → Control docente por hora** (`/nomina/docentes`)
reúne calendario, horarios, asistencias, importes devengados y abonos. Utiliza la
sesión de la plataforma y los permisos existentes `payments.view` y
`payments.manage`. La nómina manual, administrativa, los préstamos y sus pagos
históricos se conservan en `/nomina`.

## Inicio y horarios IFOP

La instalación incorpora una sola vez los cuatro horarios proporcionados del
ciclo 2026B–2027A. Se enlazan con el catálogo académico por identidad, sin
reemplazar cuentas ni asignaciones existentes.

| Docente | Horas semanales | Tarifa por hora |
| --- | ---: | ---: |
| Alondra Scarlet Valencia Figuera | 13 | $150 |
| Vanesa del C. Gómez Contreras | 18 | $130 |
| Ariana Stephania Pérez Peralta | 21 | $150 |
| Nelly Sherlyn Rodríguez Méndez | 13 | $130 |

Son 37 bloques y 65 horas semanales, con una base programada de $9,130 MXN antes
de faltas y suspensiones. El viernes, los espacios sin clase y el receso de
11:00 a 11:30 no generan horas en estos horarios. Sábados y domingos están
habilitados para las docentes que tienen clase.

Las fechas exactas del ciclo se dejan pendientes. En **Docentes y horarios**,
edita la ficha y configura la primera fecha de vigencia. Un período de un
reporte no se considera automáticamente el inicio o el fin del ciclo completo.
Se pueden guardar nuevas vigencias de horario y tarifa sin cambiar las
anteriores. Los bloques deben tener duración positiva y no superponerse para
la misma docente y el mismo día.

## Cálculo y calendario

- Las semanas van de lunes a domingo. Los meses son naturales, incluyendo años
  bisiestos. Se pueden consultar meses, semanas, años y rangos por docente.
- Una jornada hábil con horario, pero sin registro, queda **por confirmar** y no
  se incluye automáticamente en el devengado.
- El registro permite asistencia, falta completa o parcial y horas efectivas.
  Las horas adicionales se valoran a la tarifa ordinaria, sin recargos automáticos.
- Las excepciones individuales prevalecen sobre las generales. Entre reglas del
  mismo alcance gana la última guardada. Después se aplica la semana hábil del
  docente, o la semana base si no tiene una propia.
- Una suspensión sin pago excluye sus horas de la base; no genera otra falta.
  Una suspensión pagada completa hasta el horario y no duplica horas trabajadas.
- Se usan minutos y centavos enteros. Cada jornada se redondea al centavo antes
  de sumar el período.

**Ejemplo:** tres horas previstas a $150/h, con una hora de falta, producen dos
horas trabajadas y $300 devengados. El descuento informativo es $150 y ya está
reflejado en esos $300: no se vuelve a descontar al registrar un abono.

Este módulo calcula horas y pagos. No calcula impuestos ni prestaciones. Los
descuentos adicionales, préstamos y anticipos del módulo manual mantienen su
flujo existente y no se aplican por segunda vez al devengado del calendario.

## Abonos y Balance

Un abono cubre trabajo confirmado dentro de un rango y se distribuye desde la
fecha más antigua con saldo. Puede haber varios abonos parciales para un mismo
período. No se admite un anticipo superior al saldo confirmado de ese rango.

Cada abono genera exactamente un egreso en Balance, dentro de la misma
transacción que guarda el registro. Guardar o restaurar de nuevo el mismo pago
no duplica el egreso. Eliminar el abono elimina su egreso; los egresos vinculados
se administran desde Control docente y no directamente desde Balance.

El reporte docente filtra los abonos por **fechas del trabajo cubierto**. Balance
los filtra por la **fecha de salida del dinero**. Un pago que cubre dos meses
solo aparece en cada mes de trabajo por la parte aplicada a sus jornadas.

Los períodos pagados en la nómina manual se muestran como antecedentes y se
impide registrar pagos superpuestos entre los dos módulos para la misma ficha.
No se reconstruyen asistencias ni se redistribuyen pagos manuales antiguos.

Corregir horas o reglas históricas conserva los abonos y permite detectar un
pago excedente. Un excedente de una docente no reduce el saldo de otra.

## Guardado, respaldo y revisión

El estado principal se guarda en SQLite y se comparte entre sesiones
autorizadas. Cada guardado incluye una versión: si otra persona modificó la
nómina, el servidor rechaza la sobrescritura. La pantalla permite recargar y
conserva un borrador local por usuario cuando falla el guardado. El borrador se
revisa antes de recuperarlo; no sustituye automáticamente la información del servidor.

Se pueden descargar el desglose CSV, el informe para impresión y el respaldo
JSON. El respaldo general SQLite de la plataforma también incluye las nuevas
tablas. Un JSON procedente del HTML autónomo se valida con el mismo motor.

La importación muestra docentes, registros y pagos que entrarán o saldrán del
módulo. Requiere confirmar el reemplazo. No borra el catálogo académico ni la
nómina manual o administrativa. Los pagos importados concilian sus egresos en
la misma transacción y se rechazan si superan el saldo confirmado o duplican
trabajo ya pagado manualmente.

Los informes de nómina reales y los respaldos con asistencias y transacciones
pertenecen al almacenamiento privado de la plataforma; no deben añadirse al
código público del repositorio. Los registros de prueba, simulaciones y fechas
de pago dudosas se revisan antes de incorporarlos al histórico definitivo.

## Mantenimiento

La migración `041_teacher_calendar_payroll.sql` añade el documento versionado,
los enlaces a docentes/fichas de nómina y los vínculos de egresos. La
inicialización se ejecuta al arrancar y es idempotente; los `GET` no crean
registros académicos ni financieros.

El motor compartido está en `shared/teacher-payroll-core.mjs`. El cliente y el
servidor validan los mismos bloques, fechas, referencias y cálculos. Las pruebas
deben cubrir, además de la nómina existente, concurrencia, importación atómica,
permisos, bisiestos, cambios de tarifa, faltas, suspensiones y conciliación de egresos.
