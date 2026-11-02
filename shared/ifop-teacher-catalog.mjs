/* Horarios cotejados con las cuatro imágenes de Universidad IFOP.
 * Los bloques usan minutos desde medianoche; no incluyen recesos ni días sin clase.
 * El catálogo nunca supone una tarifa o una fecha de vigencia.
 */
const IFOPCatalog = (() => {
  'use strict';
  const id = 'ifop-frontera-2026b-2027a-v1';
  const title = 'Universidad IFOP · Campus Frontera';
  const cycle = '2026B–2027A';
  const weekdays = [0, 1, 2, 3, 5, 6];
  const notes = 'Horario transcrito y cotejado con la imagen de Universidad IFOP, Campus Frontera, ciclo 2026B–2027A. Receso de 11:00 a 11:30 excluido. Tarifa por hora confirmada por el usuario. Fechas exactas del ciclo pendientes de configurar.';
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  const teachers = freeze([
    {
      id: 'ifop-alondra', sourceKey: 'ifop-frontera-alondra-valencia-figuera',
      name: 'Alondra Scarlet Valencia Figuera', role: 'Enfermería', start: '', end: '', notes,
      weekdays: [...weekdays],
      revisions: [{ from: '', rateCents: 15000, schedule: [180, 0, 0, 240, 0, 240, 120], blocks: [
        { day: 0, start: 540, end: 600, subject: 'Teorías y modelos de enfermería', group: '1A', modality: 'Escolarizado' },
        { day: 0, start: 690, end: 810, subject: 'Farmacología y terapéutica', group: '3B', modality: 'Escolarizado' },
        { day: 3, start: 540, end: 660, subject: 'Teorías y modelos de enfermería', group: '1A', modality: 'Escolarizado' },
        { day: 3, start: 690, end: 810, subject: 'Farmacología y terapéutica', group: '3B', modality: 'Escolarizado' },
        { day: 5, start: 480, end: 600, subject: 'Salud Pública', group: '3A', modality: 'Semiescolarizado' },
        { day: 5, start: 690, end: 810, subject: 'Teorías y modelos de enfermería', group: '1A', modality: 'Semiescolarizado' },
        { day: 6, start: 690, end: 810, subject: 'Teorías y Procesos de Enfermería', group: '1A', modality: 'Complementario' }
      ] }]
    },
    {
      id: 'ifop-vanesa', sourceKey: 'ifop-frontera-vanesa-gomez-contreras',
      name: 'Vanesa del C. Gómez Contreras', role: 'Enfermería', start: '', end: '', notes,
      weekdays: [...weekdays],
      revisions: [{ from: '', rateCents: 13000, schedule: [240, 240, 240, 240, 0, 0, 120], blocks: [
        { day: 0, start: 540, end: 600, subject: 'Epidemiología', group: '3B', modality: 'Escolarizado' },
        { day: 0, start: 600, end: 660, subject: 'Ética y bioética', group: '1A', modality: 'Escolarizado' },
        { day: 0, start: 690, end: 810, subject: 'Epidemiología', group: '3A', modality: 'Escolarizado' },
        { day: 1, start: 540, end: 660, subject: 'Epidemiología', group: '3B', modality: 'Escolarizado' },
        { day: 1, start: 690, end: 810, subject: 'Ética y bioética', group: '1A', modality: 'Escolarizado' },
        { day: 2, start: 540, end: 660, subject: 'Alimentación, nutrición y dieta', group: '3A', modality: 'Escolarizado' },
        { day: 2, start: 690, end: 810, subject: 'Patología médico quirúrgica', group: '3B', modality: 'Escolarizado' },
        { day: 3, start: 540, end: 660, subject: 'Patología médico quirúrgica', group: '3B', modality: 'Escolarizado' },
        { day: 3, start: 690, end: 750, subject: 'Alimentación, nutrición y dieta', group: '3A', modality: 'Escolarizado' },
        { day: 3, start: 750, end: 810, subject: 'Epidemiología', group: '3A', modality: 'Escolarizado' },
        { day: 6, start: 480, end: 600, subject: 'Geriatría', group: '1A', modality: 'Complementario' }
      ] }]
    },
    {
      id: 'ifop-ariana', sourceKey: 'ifop-frontera-ariana-perez-peralta',
      name: 'Ariana Stephania Pérez Peralta', role: 'Enfermería', start: '', end: '', notes,
      weekdays: [...weekdays],
      revisions: [{ from: '', rateCents: 15000, schedule: [180, 240, 240, 240, 0, 240, 120], blocks: [
        { day: 0, start: 600, end: 660, subject: 'Alimentación, nutrición y dieta', group: '3B', modality: 'Escolarizado' },
        { day: 0, start: 690, end: 810, subject: 'Anatomía y fisiología humana', group: '1A', modality: 'Escolarizado' },
        { day: 1, start: 540, end: 660, subject: 'Farmacología y terapéutica', group: '3A', modality: 'Escolarizado' },
        { day: 1, start: 690, end: 810, subject: 'Alimentación, nutrición y dieta', group: '3B', modality: 'Escolarizado' },
        { day: 2, start: 540, end: 660, subject: 'Enfermería en salud pública', group: '3B', modality: 'Escolarizado' },
        { day: 2, start: 690, end: 810, subject: 'Anatomía y fisiología humana', group: '1A', modality: 'Escolarizado' },
        { day: 3, start: 540, end: 660, subject: 'Farmacología y terapéutica', group: '3A', modality: 'Escolarizado' },
        { day: 3, start: 690, end: 810, subject: 'Salud pública y sociología', group: '1A', modality: 'Escolarizado' },
        { day: 5, start: 480, end: 600, subject: 'Epistemología y paradigmas de enfermería', group: '1A', modality: 'Semiescolarizado' },
        { day: 5, start: 600, end: 660, subject: 'Epidemiología', group: '3A', modality: 'Semiescolarizado' },
        { day: 5, start: 690, end: 750, subject: 'Epidemiología', group: '3A', modality: 'Semiescolarizado' },
        { day: 6, start: 480, end: 600, subject: 'Enfermería en Urgencias', group: '1B', modality: 'Complementario' }
      ] }]
    },
    {
      id: 'ifop-nelly', sourceKey: 'ifop-frontera-nelly-rodriguez-mendez',
      name: 'Nelly Sherlyn Rodríguez Méndez', role: 'Enfermería', start: '', end: '', notes,
      weekdays: [...weekdays],
      revisions: [{ from: '', rateCents: 13000, schedule: [120, 240, 240, 0, 0, 0, 180], blocks: [
        { day: 0, start: 540, end: 660, subject: 'Enfermería en salud pública', group: '3A', modality: 'Escolarizado' },
        { day: 1, start: 540, end: 660, subject: 'Epistemología', group: '1A', modality: 'Escolarizado' },
        { day: 1, start: 690, end: 810, subject: 'Patología médico quirúrgica', group: '3A', modality: 'Escolarizado' },
        { day: 2, start: 540, end: 660, subject: 'Promoción de la salud', group: '1A', modality: 'Escolarizado' },
        { day: 2, start: 690, end: 810, subject: 'Patología médico quirúrgica', group: '3A', modality: 'Escolarizado' },
        { day: 6, start: 600, end: 660, subject: 'Farmacología Humana', group: '1A', modality: 'Complementario' },
        { day: 6, start: 690, end: 810, subject: 'Patología Médico Quirúrgica', group: '1B', modality: 'Complementario' }
      ] }]
    }
  ]);

  function merge(state, C) {
    const result = clone(state || C.empty());
    if (!Array.isArray(result.teachers)) throw new Error('No se pudo cargar el catálogo: la lista de docentes no es válida.');
    result.catalogs = Array.isArray(result.catalogs) ? result.catalogs : [];
    if (result.catalogs.includes(id)) {
      return { state: result, added: [], skipped: teachers.map(t => t.name) };
    }
    const sourceKeys = new Set(result.teachers.map(t => t.sourceKey).filter(Boolean));
    const names = new Set(result.teachers.map(t => normalize(t.name)));
    const missing = [], skipped = [];
    for (const teacher of teachers) {
      if (sourceKeys.has(teacher.sourceKey) || names.has(normalize(teacher.name))) {
        skipped.push(teacher.name);
      } else {
        missing.push(teacher);
        sourceKeys.add(teacher.sourceKey);
        names.add(normalize(teacher.name));
      }
    }
    if (result.teachers.length + missing.length > 500) {
      throw new Error('El catálogo excedería el límite de 500 docentes. No se agregaron datos.');
    }
    const wasEmpty = result.teachers.length === 0;
    const usedIds = new Set([...result.teachers, ...(result.rules || []), ...(result.payments || [])].map(t => t.id));
    const added = [];
    for (const source of missing) {
      const teacher = clone(source);
      // Conserva el ID habitual; evita colisionar con un registro ajeno que lo use.
      let suffix = 2;
      while (usedIds.has(teacher.id)) teacher.id = source.id + '-' + suffix++;
      usedIds.add(teacher.id);
      result.teachers.push(teacher);
      added.push(teacher.id);
    }
    if (wasEmpty) {
      result.settings = { ...result.settings, organization: title, cycle, weekdays: [...weekdays], demo: false };
    }
    result.catalogs.push(id);
    return { state: result, added, skipped };
  }
  function createState(C) {
    return merge(C.empty(), C).state;
  }
  return Object.freeze({ id, title, cycle, teachers, createState, merge });
})();

export { IFOPCatalog };
export default IFOPCatalog;
