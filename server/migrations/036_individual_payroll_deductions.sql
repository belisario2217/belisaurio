-- Descuentos individuales documentados; se aplican una sola vez al pago de nómina.
CREATE TABLE payroll_deductions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 profile_id INTEGER NOT NULL REFERENCES payroll_profiles(id),
 amount REAL NOT NULL CHECK(amount > 0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
 effective_date TEXT NOT NULL,
 payment_id INTEGER REFERENCES payroll_payments(id) ON DELETE SET NULL,
 created_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_payroll_deductions_profile ON payroll_deductions(profile_id,effective_date,payment_id);
CREATE INDEX idx_payroll_deductions_payment ON payroll_deductions(payment_id);