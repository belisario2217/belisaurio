-- Retire attendance access without deleting historical academic or payment data.
DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions WHERE code IN ('attendance.view', 'attendance.manage')
);
DELETE FROM permissions WHERE code IN ('attendance.view', 'attendance.manage');
