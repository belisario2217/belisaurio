ALTER TABLE institution_settings ADD COLUMN public_app_url TEXT;

-- Editing academic dates must not move an existing generation's billing start.
CREATE TRIGGER preserve_cycle_billing_start
BEFORE UPDATE OF start_date ON school_cycles WHEN NEW.start_date <> OLD.start_date
BEGIN
  UPDATE enrollments SET tuition_start_date = OLD.start_date
  WHERE cycle_id = OLD.id AND tuition_start_date IS NULL;
END;

CREATE TRIGGER sync_cycle_calendar_boundaries
AFTER UPDATE OF start_date, end_date ON school_cycles
BEGIN
  UPDATE academic_calendar_events SET start_date = NEW.start_date, end_date = NEW.start_date
  WHERE school_cycle_id = NEW.id AND event_type = 'class_start' AND is_active = 1;
  UPDATE academic_calendar_events SET start_date = NEW.end_date, end_date = NEW.end_date
  WHERE school_cycle_id = NEW.id AND event_type = 'cycle_end' AND is_active = 1;
END;

-- The cycle dates are the official activity dates, independently of semester.
UPDATE school_cycles SET start_date = COALESCE((
  SELECT start_date FROM academic_calendar_events
  WHERE school_cycle_id = school_cycles.id AND event_type = 'class_start' AND is_active = 1
  ORDER BY updated_at DESC, id DESC LIMIT 1
), start_date), end_date = COALESCE((
  SELECT end_date FROM academic_calendar_events
  WHERE school_cycle_id = school_cycles.id AND event_type = 'cycle_end' AND is_active = 1
  ORDER BY updated_at DESC, id DESC LIMIT 1
), end_date);

CREATE TABLE issued_documents (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  folio TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL CHECK(document_type IN ('report_card', 'academic_history', 'study_certificate', 'account_statement')),
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
);

CREATE INDEX idx_issued_documents_student ON issued_documents(student_id, issued_at DESC);

-- Corrections require a new issuance. The original printed data stay verifiable.
CREATE TRIGGER issued_documents_immutable
BEFORE UPDATE OF token, folio, document_type, issued_at, snapshot_json, snapshot_hash, verification_url ON issued_documents
BEGIN
  SELECT RAISE(ABORT, 'Los datos de un documento emitido son inmutables.');
END;
