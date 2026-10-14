CREATE TABLE expense_concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL CHECK(category IN ('operating','payroll','other')),
  is_active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO expense_concepts(name,category) VALUES
('Renta de escuela','operating'),('Electricidad','operating'),('Agua','operating'),
('Internet y telefonía','operating'),('Material didáctico','operating'),
('Mantenimiento y limpieza','operating'),('Servicios y proveedores','operating'),
('Nómina docente','payroll'),('Nómina administrativa','payroll'),('Otros egresos','other');
ALTER TABLE operating_expenses ADD COLUMN concept_id INTEGER REFERENCES expense_concepts(id);
CREATE TABLE payroll_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('teacher','administrative')),
  teacher_id INTEGER UNIQUE REFERENCES teachers(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  position TEXT,
  rate REAL NOT NULL CHECK(rate > 0),
  weekly_hours REAL NOT NULL DEFAULT 0 CHECK(weekly_hours >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payroll_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES payroll_profiles(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('teacher','administrative')),
  rate REAL NOT NULL,
  weekly_hours REAL NOT NULL,
  weeks REAL NOT NULL,
  worked_days REAL NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  paid_at TEXT NOT NULL,
  expense_id INTEGER NOT NULL UNIQUE REFERENCES operating_expenses(id),
  notes TEXT,
  UNIQUE(profile_id, period_start, period_end)
);
