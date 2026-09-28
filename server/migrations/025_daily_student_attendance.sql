-- Monthly subject totals have no individual dates. Preserve them as read-only history.
CREATE TABLE attendance_days (
  group_id INTEGER NOT NULL REFERENCES groups(id),
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed')),
  revision INTEGER NOT NULL DEFAULT 1,
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, attendance_date)
);

CREATE TABLE daily_attendance_records (
  student_id INTEGER NOT NULL REFERENCES students(id),
  attendance_date TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  status TEXT NOT NULL CHECK(status IN ('present', 'absent')),
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(student_id, attendance_date),
  FOREIGN KEY(group_id, attendance_date) REFERENCES attendance_days(group_id, attendance_date)
);
CREATE INDEX idx_daily_attendance_group_date ON daily_attendance_records(group_id, attendance_date);
CREATE INDEX idx_daily_attendance_enrollment ON daily_attendance_records(enrollment_id);
