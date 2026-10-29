-- ============================================================
-- 003: Add & Drop — course-level waitlist queue
--
-- Context: the original Waitlist row was tied to one specific
-- offering (one professor's section), created automatically when
-- a student's live-FFCS registration attempt found no seats left.
--
-- Add & Drop works differently: a student explicitly joins a
-- queue for a COURSE (any professor's section of it is acceptable,
-- as long as it doesn't clash with their real, confirmed FFCS
-- timetable), during a scheduled Pre-Add&Drop window. So the queue
-- needs to be keyed by course, not by one fixed offering.
--
-- 1. Add course_id so a queue entry represents "waiting for this
--    course", independent of any one professor's section.
-- 2. offering_id becomes optional — it's no longer required to
--    join a queue, only set historically by the old FFCS-full path.
-- 3. One queue entry per student per course (you can't queue twice
--    for the same course).
-- ============================================================

ALTER TABLE Waitlist ADD COLUMN IF NOT EXISTS course_id INT REFERENCES Course(course_id) ON DELETE CASCADE;

-- Backfill course_id for any existing rows created by the old
-- FFCS-full path, from the offering they were waitlisted on.
UPDATE Waitlist w
SET course_id = co.course_id
FROM CourseOffering co
WHERE w.offering_id = co.offering_id
  AND w.course_id IS NULL;

ALTER TABLE Waitlist ALTER COLUMN offering_id DROP NOT NULL;

ALTER TABLE Waitlist ALTER COLUMN course_id SET NOT NULL;

ALTER TABLE Waitlist ADD CONSTRAINT waitlist_student_course_unique UNIQUE (student_id, course_id);

CREATE INDEX IF NOT EXISTS idx_waitlist_course ON Waitlist(course_id);