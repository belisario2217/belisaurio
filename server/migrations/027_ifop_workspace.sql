ALTER TABLE students ADD COLUMN near_graduation INTEGER NOT NULL DEFAULT 0 CHECK(near_graduation IN (0,1));
ALTER TABLE users ADD COLUMN teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_user_teacher_link ON users(teacher_id) WHERE teacher_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE teachers ADD COLUMN teacher_number TEXT;
UPDATE teachers SET teacher_number = printf('DOC%05d', id);
CREATE UNIQUE INDEX idx_teacher_number ON teachers(teacher_number) WHERE teacher_number IS NOT NULL;
UPDATE users SET teacher_id = (
  SELECT t.id FROM teachers t WHERE t.is_active = 1 AND t.email = users.email COLLATE NOCASE
  AND (SELECT COUNT(*) FROM teachers t2 WHERE t2.email = users.email COLLATE NOCASE AND t2.is_active = 1) = 1
) WHERE role_id IN (SELECT id FROM roles WHERE name = 'Docente') AND deleted_at IS NULL;
CREATE TABLE import_format_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('students','grades')),
  fingerprint TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 1,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,kind,fingerprint)
);
CREATE TABLE operating_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('operating','payroll','other')),
  amount REAL NOT NULL CHECK(amount > 0),
  paid_at TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
