INSERT OR IGNORE INTO permissions(code, name, module)
VALUES ('credentials.manage', 'Diseñar y activar credenciales de estudiantes', 'credentials');
INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('Administrador', 'Control escolar', 'Coordinador académico', 'Coordinador acadÃ©mico')
AND p.code = 'credentials.manage';

CREATE TABLE credential_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  version INTEGER NOT NULL DEFAULT 1,
  template_json TEXT NOT NULL CHECK(json_valid(template_json)),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE student_credentials (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  photo_file TEXT NOT NULL,
  photo_width INTEGER NOT NULL,
  photo_height INTEGER NOT NULL,
  photo_hash TEXT NOT NULL,
  crop_x REAL NOT NULL DEFAULT 0.5 CHECK(crop_x BETWEEN 0 AND 1),
  crop_y REAL NOT NULL DEFAULT 0.5 CHECK(crop_y BETWEEN 0 AND 1),
  zoom REAL NOT NULL DEFAULT 1 CHECK(zoom BETWEEN 1 AND 3),
  valid_until TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE credential_issues (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  folio TEXT NOT NULL UNIQUE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  photo_file TEXT NOT NULL,
  card_file TEXT NOT NULL,
  print_file TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
);
CREATE INDEX idx_credential_issues_student ON credential_issues(student_id, issued_at DESC);
CREATE UNIQUE INDEX idx_credential_issues_current ON credential_issues(student_id) WHERE revoked_at IS NULL;
CREATE TRIGGER credential_issues_immutable
BEFORE UPDATE OF token, folio, photo_file, card_file, print_file, snapshot_json, snapshot_hash, verification_url, issued_at ON credential_issues
BEGIN
  SELECT RAISE(ABORT, 'El contenido de una credencial activada es inmutable.');
END;
