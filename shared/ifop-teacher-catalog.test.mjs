import assert from 'node:assert/strict';
import {test} from 'vitest';
import C from './teacher-payroll-core.mjs';
import Catalog from './ifop-teacher-catalog.mjs';
const copy = value => structuredClone(value);
const initial = () => Catalog.createState(C);
const configure = (teacher, from = '2026-11-02', rateCents = 10000) => {
  teacher.start = from;
  teacher.revisions[0].from = from;
  teacher.revisions[0].rateCents = rateCents;
  return teacher;
};
const legacyTeacher = (id = 'legacy', name = 'Docente anterior') => ({
  id, name, role: 'Materia previa', start: '2026-01-01', end: '', notes: 'Conservar',
  revisions: [{ from: '2026-01-01', rateCents: 10000, schedule: [240, 240, 240, 240, 240, 120, 120] }]
});
const legacyState = () => ({
  schemaVersion: 1,
  settings: { currency: 'MXN', weekdays: [0, 1, 2, 3, 4], organization: 'Centro previo', demo: false },
  teachers: [legacyTeacher()], rules: [],
  attendance: [{ teacherId: 'legacy', date: '2026-11-02', status: 'partial', minutes: 180, note: 'Falta de una hora' }],
  payments: [{ id: 'legacy-payment', teacherId: 'legacy', date: '2026-11-02', from: '2026-11-02', to: '2026-11-02', amountCents: 10000, allocations: [{ date: '2026-11-02', cents: 10000 }], method: 'Transferencia', note: 'Pago previo' }]
});
const block = (start, end, day = 0) => ({ day, start, end, subject: 'Materia', group: '1A', modality: 'Escolarizado' });

test('Las cuatro docentes tienen los nombres literales de las imágenes', () => {
  assert.deepEqual(Catalog.teachers.map(t => t.name), [
    'Alondra Scarlet Valencia Figuera',
    'Vanesa del C. Gómez Contreras',
    'Ariana Stephania Pérez Peralta',
    'Nelly Sherlyn Rodríguez Méndez'
  ]);
});

test('Totales diarios: Alondra 3/0/0/4/0/4/2, Vanesa 4/4/4/4/0/0/2, Ariana 3/4/4/4/0/4/2, Nelly 2/4/4/0/0/0/3', () => {
  const hours = [[3, 0, 0, 4, 0, 4, 2], [4, 4, 4, 4, 0, 0, 2], [3, 4, 4, 4, 0, 4, 2], [2, 4, 4, 0, 0, 0, 3]];
  Catalog.teachers.forEach((t, i) => {
    const expected = hours[i].map(n => n * 60);
    assert.deepEqual(t.revisions[0].schedule, expected);
    assert.deepEqual(C.scheduleFromBlocks(t.revisions[0].blocks), expected);
  });
});

test('Las cargas semanales suman 13, 18, 21 y 13 horas: total 65', () => {
  const totals = Catalog.teachers.map(t => C.scheduleFromBlocks(t.revisions[0].blocks).reduce((n, m) => n + m, 0));
  assert.deepEqual(totals, [13, 18, 21, 13].map(n => n * 60));
  assert.equal(totals.reduce((n, m) => n + m, 0), 65 * 60);
});

test('El catálogo contiene 37 bloques, ninguno el viernes ni durante el receso 11:00–11:30', () => {
  const blocks = Catalog.teachers.flatMap(t => t.revisions[0].blocks);
  assert.equal(blocks.length, 37);
  assert.deepEqual(Catalog.teachers.map(t => t.revisions[0].blocks.length), [7, 11, 12, 7]);
  for (const b of blocks) {
    assert.notEqual(b.day, 4);
    assert(!(b.start < 690 && b.end > 660), JSON.stringify(b));
    assert.doesNotMatch(b.subject, /receso|sin clase/i);
    assert(b.group.trim());
    assert(['Escolarizado', 'Semiescolarizado', 'Complementario'].includes(b.modality));
  }
});

test('Materias y grupos clave se conservan, incluidos los domingos', () => {
  const byId = new Map(Catalog.teachers.map(t => [t.id, t.revisions[0].blocks]));
  assert(byId.get('ifop-alondra').some(b => b.day === 6 && b.subject === 'Teorías y Procesos de Enfermería' && b.group === '1A'));
  assert(byId.get('ifop-vanesa').some(b => b.day === 6 && b.subject === 'Geriatría' && b.start === 480 && b.end === 600));
  assert(byId.get('ifop-ariana').some(b => b.day === 6 && b.subject === 'Enfermería en Urgencias' && b.group === '1B'));
  assert(byId.get('ifop-nelly').some(b => b.day === 6 && b.subject === 'Farmacología Humana' && b.group === '1A' && b.start === 600));
});

test('La carga inicial conserva las tarifas indicadas y no supone fechas, asistencias ni pagos', () => {
  const s = initial();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.settings.organization, Catalog.title);
  assert.equal(s.settings.cycle, '2026B–2027A');
  assert.deepEqual(s.catalogs, [Catalog.id]);
  assert.equal(s.attendance.length, 0);
  assert.equal(s.payments.length, 0);
  s.teachers.forEach((t, i) => {
    assert.equal(t.start, '');
    assert.equal(t.end, '');
    assert.equal(t.revisions.length, 1);
    assert.equal(t.revisions[0].from, '');
    assert.equal(t.revisions[0].rateCents, [15000, 13000, 15000, 13000][i]);
  });
});

test('Con la semana completa registrada, las tarifas indicadas producen $9,130 sin recesos pagados', () => {
  const s = initial();
  s.teachers.forEach(t => configure(t, '2026-11-02', t.revisions[0].rateCents));
  for (const date of C.dates('2026-11-02', '2026-11-08')) {
    for (const t of s.teachers) {
      const minutes = t.revisions[0].schedule[C.weekday(date)];
      if (minutes) s.attendance.push({ teacherId: t.id, date, status: 'present', minutes, note: '' });
    }
  }
  const report = C.engine(C.validate(s)).aggregate('2026-11-02', '2026-11-08');
  assert.deepEqual(report.rows.map(r => r.earned), [195000, 234000, 315000, 169000]);
  assert.equal(report.totals.earned, 913000);
  assert.equal(report.totals.base, 913000);
  assert.equal(report.totals.worked, 65 * 60);
  assert.equal(report.totals.pending, 0);
  assert.equal(report.totals.discount, 0);
});

test('Sin fechas no se generan horas, faltas, devengados ni pagos automáticos', () => {
  const s = C.validate(initial()), engine = C.engine(s);
  const report = engine.aggregate('2026-11-02', '2026-11-08');
  for (const field of ['planned', 'worked', 'credit', 'pending', 'missing', 'discount', 'earned', 'owed']) assert.equal(report.totals[field], 0, field);
  assert(report.rows.every(r => r.datePending));
  assert.throws(() => engine.allocate(s.teachers[0].id, '2026-11-02', '2026-11-08', 1), /vigencia|fechas|tarifas/i);
});

test('No se permite respaldar una asistencia de un docente cuya fecha sigue pendiente', () => {
  const s = initial();
  s.attendance.push({ teacherId: s.teachers[0].id, date: '2026-11-02', status: 'present', minutes: 180, note: '' });
  assert.throws(() => C.validate(s), /vigencia/i);
});

test('Con fecha y sin tarifa se conservan horas registradas como no valoradas y se bloquea el pago', () => {
  const s = initial(), t = configure(s.teachers[0], '2026-11-02', null);
  t.revisions.push({ ...copy(t.revisions[0]), from: '2026-11-05', rateCents: 10000 });
  s.attendance.push(
    { teacherId: t.id, date: '2026-11-02', status: 'present', minutes: 180, note: 'Aún sin tarifa' },
    { teacherId: t.id, date: '2026-11-05', status: 'present', minutes: 240, note: 'Tarifa posterior' }
  );
  const normalized = C.validate(s), engine = C.engine(normalized);
  const monday = engine.day(t.id, '2026-11-02');
  assert.equal(monday.worked, 180);
  assert.equal(monday.unpriced, 180);
  assert.equal(monday.priced, false);
  assert.equal(monday.earned, 0);
  assert.equal(monday.discount, 0);
  assert.equal(engine.day(t.id, '2026-11-05').earned, 40000);
  assert.throws(() => engine.allocate(t.id, '2026-11-02', '2026-11-05', 1), /tarifas|vigencia/i);
});

test('Una suspensión pagada sin tarifa también queda sin valorar y bloquea pagos', () => {
  const s = initial(), t = configure(s.teachers[0], '2026-11-02', null);
  s.rules.push({ id: 'paid-no-rate', teacherId: t.id, from: '2026-11-02', to: '2026-11-02', kind: 'paid', reason: 'Permiso pagado' });
  const engine = C.engine(C.validate(s)), d = engine.day(t.id, '2026-11-02');
  assert.equal(d.credit, 180);
  assert.equal(d.unpriced, 180);
  assert.equal(d.earned, 0);
  assert.throws(() => engine.allocate(t.id, '2026-11-02', '2026-11-02', 1), /tarifas|vigencia/i);
});

test('La tarifa explícita de cero se distingue de una tarifa desconocida', () => {
  const s = initial(), t = configure(s.teachers[0], '2026-11-02', 0);
  s.attendance.push({ teacherId: t.id, date: '2026-11-02', status: 'present', minutes: 180, note: '' });
  const d = C.engine(C.validate(s)).day(t.id, '2026-11-02');
  assert.equal(d.priced, true);
  assert.equal(d.unpriced, 0);
  assert.equal(d.pendingRateMinutes, 0);
  assert.equal(d.earned, 0);
});

test('La semana IFOP abre sábado y domingo sin alterar la semana histórica de otros docentes', () => {
  const before = C.validate(legacyState()), result = Catalog.merge(before, C);
  assert.deepEqual(result.state.settings, before.settings);
  const imported = result.state.teachers.find(t => t.id === 'ifop-alondra');
  configure(imported);
  const engine = C.engine(C.validate(result.state));
  assert.equal(engine.day('ifop-alondra', '2026-11-07').planned, 240);
  assert.equal(engine.day('ifop-alondra', '2026-11-08').planned, 120);
  assert.equal(engine.day('ifop-alondra', '2026-11-06').planned, 0);
  assert.equal(engine.day('legacy', '2026-11-07').planned, 0);
  assert.equal(engine.day('legacy', '2026-11-06').planned, 240);
});

test('Excepciones generales e individuales prevalecen sobre la semana hábil del docente', () => {
  const s = initial(), t = configure(s.teachers[0]);
  s.rules.push({ id: 'global-sat-closed', teacherId: null, from: '2026-11-07', to: '2026-11-07', kind: 'closed', reason: 'Cierre' });
  assert.equal(C.engine(s).day(t.id, '2026-11-07').planned, 0);
  s.rules.push({ id: 'teacher-sat-open', teacherId: t.id, from: '2026-11-07', to: '2026-11-07', kind: 'open', reason: 'Excepción' });
  assert.equal(C.engine(s).day(t.id, '2026-11-07').planned, 240);
});

test('La migración v1 a v2 conserva tarifas, asistencias, descuentos, pagos y saldo', () => {
  const old = legacyState(), before = C.engine(old).aggregate('2026-11-02', '2026-11-02');
  const migrated = C.validate(copy(old)), after = C.engine(migrated).aggregate('2026-11-02', '2026-11-02');
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.teachers, old.teachers);
  assert.deepEqual(migrated.attendance, old.attendance);
  assert.deepEqual(migrated.payments, old.payments);
  assert.deepEqual(after.totals, before.totals);
  assert.equal(after.totals.earned, 30000);
  assert.equal(after.totals.discount, 10000);
  assert.equal(after.totals.paid, 10000);
  assert.equal(after.totals.balance, 20000);
});

test('El respaldo v2 conserva bloques, sourceKey, días hábiles, catálogo y campos pendientes', () => {
  const source = initial();
  const restored = C.validate(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(restored, source);
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(restored))), restored);
});

test('La normalización rechaza horas diarias inconsistentes con los bloques de clase', () => {
  const s = initial();
  s.teachers[0].revisions[0].schedule[0] += 60;
  assert.throws(() => C.validate(s), /horas.*bloques/i);
});

test('La normalización rechaza clases superpuestas para una docente en un mismo día', () => {
  const s = initial(), r = s.teachers[0].revisions[0];
  r.blocks.push({ ...r.blocks[0], start: 570, end: 630 });
  assert.throws(() => C.validate(s), /superponen/i);
});

test('La normalización permite bloques adyacentes y horarios simultáneos en días distintos', () => {
  const blocks = [block(600, 660), block(540, 600), block(540, 600, 1)];
  const normalized = C.normalizeBlocks(blocks);
  assert.equal(normalized.length, 3);
  assert.deepEqual(C.scheduleFromBlocks(normalized), [120, 60, 0, 0, 0, 0, 0]);
  assert.equal(normalized[0].start, 540);
  assert.deepEqual(blocks.map(b => b.start), [600, 540, 540]);
});

test('Bloques: límites del día, intervalos positivos, días válidos y minutos enteros', () => {
  assert.deepEqual(C.scheduleFromBlocks([block(0, 1440)]), [1440, 0, 0, 0, 0, 0, 0]);
  assert.equal(C.normalizeBlocks([block(1439, 1440)])[0].end, 1440);
  for (const invalid of [block(-1, 60), block(1439, 1441), block(60, 60), block(60, 59), block(60, 120, 7), block(60, 120, -1), block(60.5, 120), block(60, 120.5), { ...block(60, 120), subject: '  ' }]) {
    assert.throws(() => C.normalizeBlocks([invalid]), undefined, JSON.stringify(invalid));
  }
  assert.throws(() => C.normalizeBlocks(null));
  assert.throws(() => C.normalizeBlocks(Array.from({ length: 501 }, (_, i) => block(i, i + 1))));
});

test('La carga puede aplicarse dos veces sin duplicar ni modificar el estado previo', () => {
  const original = C.validate(legacyState()), snapshot = copy(original);
  const once = Catalog.merge(original, C);
  const twice = Catalog.merge(C.validate(once.state), C);
  assert.deepEqual(original, snapshot);
  assert.equal(once.added.length, 4);
  assert.equal(once.state.teachers.length, 5);
  assert.equal(twice.added.length, 0);
  assert.deepEqual(twice.state, C.validate(once.state));
  assert.deepEqual(twice.state.teachers.find(t => t.id === 'legacy'), original.teachers[0]);
  assert.deepEqual(twice.state.payments, original.payments);
  assert.deepEqual(twice.state.attendance, original.attendance);
  assert.deepEqual(twice.state.settings, original.settings);
});

test('Borrar una docente no la resucita al volver a aplicar la misma carga', () => {
  const s = initial();
  s.teachers = s.teachers.filter(t => t.id !== 'ifop-ariana');
  const restored = C.validate(JSON.parse(JSON.stringify(s)));
  const merged = Catalog.merge(restored, C);
  assert.equal(merged.added.length, 0);
  assert.equal(merged.state.teachers.length, 3);
  assert(!merged.state.teachers.some(t => t.id === 'ifop-ariana'));
});

test('Un nombre normalizado coincidente evita duplicar y conserva la tarifa y el historial existentes', () => {
  const s = C.validate(legacyState());
  const existing = legacyTeacher('existing-vanesa', '  VANESA   DEL C. GOMEZ CONTRERAS  ');
  existing.revisions[0].rateCents = 23456;
  s.teachers.push(existing);
  const merged = Catalog.merge(s, C);
  assert.equal(merged.added.length, 3);
  assert(merged.skipped.includes('Vanesa del C. Gómez Contreras'));
  assert.deepEqual(merged.state.teachers.find(t => t.id === existing.id), existing);
  assert.equal(merged.state.teachers.filter(t => /vanesa/i.test(t.name)).length, 1);
  assert.deepEqual(merged.state.payments, s.payments);
});

test('Una sourceKey existente impide duplicar aunque cambie el nombre visible', () => {
  const s = C.empty(), existing = legacyTeacher('existing-alondra', 'Nombre corregido por el usuario');
  existing.sourceKey = Catalog.teachers[0].sourceKey;
  s.teachers.push(existing);
  const merged = Catalog.merge(s, C);
  assert.equal(merged.added.length, 3);
  assert.deepEqual(merged.state.teachers.find(t => t.id === existing.id), existing);
});

test('Una colisión de ID no cambia referencias a docentes ni pagos anteriores', () => {
  const s = C.validate(legacyState());
  s.teachers[0].id = 'ifop-alondra';
  s.attendance[0].teacherId = 'ifop-alondra';
  s.payments[0].teacherId = 'ifop-alondra';
  const merged = Catalog.merge(s, C), normalized = C.validate(merged.state);
  assert.equal(merged.added.length, 4);
  assert(merged.added.includes('ifop-alondra-2'));
  assert.equal(normalized.payments[0].teacherId, 'ifop-alondra');
  assert.equal(normalized.teachers.find(t => t.id === 'ifop-alondra').name, 'Docente anterior');
  assert.equal(normalized.teachers.find(t => t.id === 'ifop-alondra-2').name, 'Alondra Scarlet Valencia Figuera');
});

test('El límite de 500 docentes se respeta y una carga rechazada no modifica la fuente', () => {
  const s = C.empty();
  s.teachers = Array.from({ length: 497 }, (_, i) => legacyTeacher('existing-' + i, 'Docente ' + i));
  const snapshot = copy(s);
  assert.throws(() => Catalog.merge(s, C), /500/);
  assert.deepEqual(s, snapshot);
  s.teachers.pop();
  const merged = Catalog.merge(s, C);
  assert.equal(merged.state.teachers.length, 500);
  assert.equal(C.validate(merged.state).teachers.length, 500);
});

test('Plantilla global inmutable: editar una carga no altera la siguiente', () => {
  const first = initial();
  first.teachers[0].name = 'Cambio local';
  first.teachers[0].revisions[0].blocks[0].subject = 'Cambio local';
  first.teachers[0].revisions[0].schedule[0] = 0;
  const second = initial();
  assert.equal(second.teachers[0].name, 'Alondra Scarlet Valencia Figuera');
  assert.equal(second.teachers[0].revisions[0].blocks[0].subject, 'Teorías y modelos de enfermería');
  assert.equal(second.teachers[0].revisions[0].schedule[0], 180);
});

test('Un importe con tarifa desconocida sigue siendo desconocido, distinto de una tarifa explícita cero', () => {
  assert.equal(C.amount(60, null), null);
  assert.equal(C.amount(0, null), null);
  assert.equal(C.amount(60, undefined), null);
  assert.equal(C.amount(60, 0), 0);
  assert.equal(C.amount(90, 15000), 22500);
});

test('Los IDs del catálogo evitan también colisiones con reglas y pagos existentes', () => {
  const s = C.validate(legacyState());
  s.rules.push({ id: 'ifop-alondra', teacherId: null, from: '2026-11-02', to: '2026-11-02', kind: 'closed', reason: 'Regla anterior' });
  s.payments[0].id = 'ifop-vanesa';
  const snapshot = copy(s);
  const merged = Catalog.merge(C.validate(s), C);
  const normalized = C.validate(merged.state);
  assert.deepEqual(s, snapshot);
  assert.equal(merged.added.length, 4);
  assert(merged.added.includes('ifop-alondra-2'));
  assert(merged.added.includes('ifop-vanesa-2'));
  assert.deepEqual(normalized.rules, snapshot.rules);
  assert.deepEqual(normalized.payments, snapshot.payments);
  assert.equal(normalized.teachers.find(t => t.id === 'ifop-alondra-2').name, 'Alondra Scarlet Valencia Figuera');
  assert.equal(normalized.teachers.find(t => t.id === 'ifop-vanesa-2').name, 'Vanesa del C. Gómez Contreras');
});

