-- ============================================================
-- 002: Course reviews (only students who completed a course may post)
--
-- 1. Enrollment.completed_at marks a confirmed enrollment as finished.
--    (A separate column, not a new status, so every existing query
--    that filters on status = 'confirmed' keeps working.)
-- 2. Review is rebuilt: one review per student + course + professor.
--    The old Review table was unused (no API/UI), so dropping it is safe
--    as long as it's still empty in your shared DB.
-- ============================================================

ALTER TABLE Enrollment ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DROP TABLE IF EXISTS Review;

CREATE TABLE Review (
    review_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES Student(student_id) ON DELETE CASCADE,
    course_id INT NOT NULL REFERENCES Course(course_id) ON DELETE CASCADE,
    professor_id INT NOT NULL REFERENCES Professor(professor_id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (student_id, course_id, professor_id)
);

CREATE INDEX idx_review_course ON Review(course_id);

ALTER TABLE Review ENABLE ROW LEVEL SECURITY;
