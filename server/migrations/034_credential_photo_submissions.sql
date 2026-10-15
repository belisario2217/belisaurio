CREATE TABLE credential_photo_submissions (
  id TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
  source_file TEXT NOT NULL,
  original_file TEXT NOT NULL,
  prepared_file TEXT NOT NULL,
  original_hash TEXT NOT NULL,
  prepared_hash TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  crop_x REAL NOT NULL DEFAULT 0.5 CHECK(crop_x BETWEEN 0 AND 1),
  crop_y REAL NOT NULL DEFAULT 0.5 CHECK(crop_y BETWEEN 0 AND 1),
  zoom REAL NOT NULL DEFAULT 1 CHECK(zoom BETWEEN 1 AND 3),
  processing_json TEXT NOT NULL CHECK(json_valid(processing_json)),
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  issue_id TEXT REFERENCES credential_issues(id),
  approved_variant TEXT CHECK(approved_variant IN ('original','prepared'))
);
CREATE UNIQUE INDEX idx_credential_photo_pending ON credential_photo_submissions(student_id) WHERE status='pending';
CREATE INDEX idx_credential_photo_student ON credential_photo_submissions(student_id,submitted_at DESC);
