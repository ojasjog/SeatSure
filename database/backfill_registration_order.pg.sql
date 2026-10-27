-- Postgres version: give every student with NULL registration_order the next turn numbers.
UPDATE Student s
SET registration_order = sub.new_order
FROM (
  SELECT student_id,
         (SELECT COALESCE(MAX(registration_order), 0) FROM Student)
           + ROW_NUMBER() OVER (ORDER BY student_id) AS new_order
  FROM Student WHERE registration_order IS NULL
) sub
WHERE s.student_id = sub.student_id;
