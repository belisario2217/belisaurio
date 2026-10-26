-- Portal visits only inspect the student's pending automatic coursework.
CREATE INDEX idx_student_subjects_auto_pending
  ON student_subjects(student_id, enrollment_id, school_cycle_id, semester_number)
  WHERE status='pending' AND status_manual_override=0;
