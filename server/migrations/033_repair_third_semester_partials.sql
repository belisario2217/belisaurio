-- Older curricular edits copied one mark into all three partials. For students
-- currently in semester three, that captured mark belongs to the first partial.
-- Repair only copies whose latest history entry proves they came from that path.
-- Keep the original grade and curricular rows for an auditable recovery.
CREATE TABLE IF NOT EXISTS grade_partial_repairs (
  grade_id INTEGER PRIMARY KEY,
  original_grade_json TEXT NOT NULL CHECK(json_valid(original_grade_json)),
  original_subjects_json TEXT NOT NULL CHECK(json_valid(original_subjects_json)),
  repaired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO grade_partial_repairs(grade_id, original_grade_json, original_subjects_json)
SELECT gr.id,
  json_object('id',gr.id,'partial_1',gr.partial_1,'partial_2',gr.partial_2,'partial_3',gr.partial_3,
    'final_score',gr.final_score,'status',gr.status,'updated_at',gr.updated_at),
  (SELECT json_group_array(json_object('id',ss.id,'status',ss.status,'final_score',ss.final_score,'updated_at',ss.updated_at))
   FROM student_subjects ss WHERE ss.enrollment_id=e.id AND ss.subject_id=a.subject_id
     AND ss.semester_number=3 AND (ss.school_cycle_id IN (ap.cycle_id,e.cycle_id) OR ss.school_cycle_id IS NULL))
FROM grades gr
JOIN enrollments e ON e.id=gr.enrollment_id AND e.is_active=1
JOIN students st ON st.id=e.student_id AND st.is_active=1
JOIN groups g ON g.id=e.group_id
JOIN institution_settings i ON i.id=1
JOIN curricular_periods cp ON cp.id=COALESCE(e.curricular_period_id,g.curricular_period_id) AND cp.sequence=3
JOIN subject_assignments a ON a.id=gr.assignment_id AND a.group_id=e.group_id AND a.is_active=1 AND a.evaluation_mode='partials'
JOIN academic_periods ap ON ap.id=a.period_id AND ap.cycle_id=COALESCE(g.active_cycle_id,i.active_cycle_id,e.cycle_id)
WHERE gr.final_score IS NOT NULL AND gr.partial_1=gr.final_score
  AND gr.partial_2=gr.final_score AND gr.partial_3=gr.final_score
  AND EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.enrollment_id=e.id
    AND ss.subject_id=a.subject_id AND ss.semester_number=3
    AND (ss.school_cycle_id IN (ap.cycle_id,e.cycle_id) OR ss.school_cycle_id IS NULL))
  AND (SELECT h.reason FROM grade_history h WHERE h.grade_id=gr.id ORDER BY h.id DESC LIMIT 1)
      ='Sincronizacion desde trayectoria curricular';

UPDATE grades SET partial_2=NULL,partial_3=NULL,status='pending',updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT grade_id FROM grade_partial_repairs);

UPDATE student_subjects SET final_score=NULL,status='in_progress',updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT json_extract(item.value,'$.id') FROM grade_partial_repairs r, json_each(r.original_subjects_json) item);

INSERT INTO grade_history(grade_id,old_score,new_score,reason,changed_by)
SELECT gr.id,gr.final_score,gr.final_score,'Corrección de copia automática: primer parcial de tercer semestre',
  (SELECT h.changed_by FROM grade_history h WHERE h.grade_id=gr.id ORDER BY h.id DESC LIMIT 1)
FROM grades gr JOIN grade_partial_repairs r ON r.grade_id=gr.id;
