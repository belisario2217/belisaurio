-- Anticipos y préstamos: la entrega genera salida de caja y el descuento se recupera en nómina.
ALTER TABLE payroll_payments ADD COLUMN gross_amount REAL NOT NULL DEFAULT 0 CHECK(gross_amount >= 0);
ALTER TABLE payroll_payments ADD COLUMN manual_deduction REAL NOT NULL DEFAULT 0 CHECK(manual_deduction >= 0);
ALTER TABLE payroll_payments ADD COLUMN deduction_reason TEXT NOT NULL DEFAULT '';
UPDATE payroll_payments SET gross_amount=amount WHERE gross_amount=0;

CREATE TABLE payroll_loans (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 profile_id INTEGER NOT NULL REFERENCES payroll_profiles(id),
 kind TEXT NOT NULL CHECK(kind IN ('advance','loan')),
 principal REAL NOT NULL CHECK(principal > 0),
 issued_at TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 expense_id INTEGER NOT NULL UNIQUE REFERENCES operating_expenses(id),
 created_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_payroll_loans_profile ON payroll_loans(profile_id,issued_at);
CREATE TABLE payroll_loan_repayments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 loan_id INTEGER NOT NULL REFERENCES payroll_loans(id),
 payment_id INTEGER NOT NULL REFERENCES payroll_payments(id) ON DELETE CASCADE,
 amount REAL NOT NULL CHECK(amount > 0),
 UNIQUE(loan_id,payment_id)
);
CREATE INDEX idx_payroll_loan_repayments_loan ON payroll_loan_repayments(loan_id);

INSERT OR IGNORE INTO expense_concepts(name,category)
VALUES ('Adelanto de sueldo','payroll'),('Préstamo al personal','payroll');