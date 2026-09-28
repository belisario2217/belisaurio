CREATE TABLE group_month_class_days (
  group_id INTEGER NOT NULL REFERENCES groups(id),
  month TEXT NOT NULL,
  class_days INTEGER NOT NULL CHECK(class_days BETWEEN 0 AND 31),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, month)
);
