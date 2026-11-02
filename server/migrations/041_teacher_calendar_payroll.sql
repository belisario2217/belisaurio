-- Calendar payroll is separate from the historical manual payroll ledger.
-- A single versioned document makes a multi-screen edit atomic and prevents lost updates.
CREATE TABLE teacher_payroll_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teacher_payroll_links (
  teacher_key TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL UNIQUE REFERENCES teachers(id) ON DELETE RESTRICT,
  profile_id INTEGER UNIQUE REFERENCES payroll_profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each recorded calendar payment has exactly one cash expense, irrespective of
-- how many dates it covers or how often a snapshot is saved/restored.
CREATE TABLE teacher_payroll_expenses (
  payment_key TEXT PRIMARY KEY,
  teacher_key TEXT NOT NULL REFERENCES teacher_payroll_links(teacher_key) ON DELETE RESTRICT,
  expense_id INTEGER NOT NULL UNIQUE REFERENCES operating_expenses(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_teacher_payroll_expenses_teacher ON teacher_payroll_expenses(teacher_key,payment_date);
