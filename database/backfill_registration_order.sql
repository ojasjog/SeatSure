-- ============================================================
-- Backfill: assign a registration_order to any existing student
-- who signed up before signup started auto-assigning one.
-- Safe to run any time — only touches NULL rows, ordered by
-- student_id so earlier signups get earlier turns.
-- ============================================================
USE seatsure;

SET @next := (SELECT COALESCE(MAX(registration_order), 0) FROM Student);

UPDATE Student
JOIN (
  SELECT student_id, (@next := @next + 1) AS new_order
  FROM Student
  WHERE registration_order IS NULL
  ORDER BY student_id
) AS ordered ON ordered.student_id = Student.student_id
SET Student.registration_order = ordered.new_order;
