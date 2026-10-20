-- Undo only the classifications introduced by migration 037.
-- Keep all receipts, dates, amounts, coverage links and the classification audit.
UPDATE student_payments SET payment_kind='receipt'
WHERE payment_kind='coverage'
  AND id IN (SELECT payment_id FROM payment_coverage_reclassifications);
