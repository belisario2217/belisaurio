ALTER TABLE academic_plans ADD COLUMN certificate_authority TEXT NOT NULL DEFAULT 'ifop'
  CHECK(certificate_authority IN ('ifop', 'uniten'));

-- The student's plan identifies the agreement, even when both plans share a program.
UPDATE academic_plans SET certificate_authority = CASE
  WHEN UPPER(name) LIKE '%UNITEN%' THEN 'uniten'
  WHEN UPPER(name) LIKE '%IFOP%' THEN 'ifop'
  WHEN UPPER(code) LIKE '%UNITEN%' THEN 'uniten'
  WHEN UPPER(code) LIKE '%IFOP%' THEN 'ifop'
  WHEN EXISTS (SELECT 1 FROM programs p WHERE p.id=academic_plans.program_id AND UPPER(p.name) LIKE '%UNITEN%') THEN 'uniten'
  WHEN EXISTS (SELECT 1 FROM programs p WHERE p.id=academic_plans.program_id AND UPPER(p.name) LIKE '%IFOP%') THEN 'ifop'
  WHEN EXISTS (SELECT 1 FROM programs p WHERE p.id=academic_plans.program_id AND UPPER(p.code) LIKE '%UNITEN%') THEN 'uniten'
  ELSE 'ifop'
END;
