-- ============================================================
-- SeatSure Database Schema — PostgreSQL / Supabase version
-- Ported from the MySQL schema.sql. Run once in the Supabase
-- SQL Editor (or via psql). NOTE: this file does NOT drop tables,
-- so it is safe against a shared database.
-- ============================================================

-- "User" is a reserved word in Postgres, so it must stay quoted.
CREATE TABLE "User" (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin'))
);

CREATE TABLE Student (
    student_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    reg_no VARCHAR(20) UNIQUE NOT NULL,
    branch VARCHAR(50),
    semester INT,
    registration_order INT UNIQUE
);

CREATE TABLE Professor (
    professor_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    department VARCHAR(50)
);

CREATE TABLE Course (
    course_id SERIAL PRIMARY KEY,
    course_code VARCHAR(20) UNIQUE NOT NULL,
    course_name VARCHAR(100) NOT NULL,
    credits INT NOT NULL
);

CREATE TABLE Slot (
    slot_id SERIAL PRIMARY KEY,
    slot_code VARCHAR(10) UNIQUE NOT NULL,
    slot_type TEXT NOT NULL CHECK (slot_type IN ('theory','lab'))
);

CREATE TABLE SlotSchedule (
    schedule_id SERIAL PRIMARY KEY,
    slot_id INT NOT NULL REFERENCES Slot(slot_id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE (slot_id, day_of_week)
);

CREATE TABLE CourseOffering (
    offering_id SERIAL PRIMARY KEY,
    course_id INT NOT NULL REFERENCES Course(course_id) ON DELETE CASCADE,
    professor_id INT NOT NULL REFERENCES Professor(professor_id) ON DELETE CASCADE,
    venue VARCHAR(20) NOT NULL,
    course_type TEXT NOT NULL CHECK (course_type IN ('theory','lab')),
    total_seats INT NOT NULL DEFAULT 60,
    seats_remaining INT NOT NULL DEFAULT 60,
    CHECK (seats_remaining >= 0 AND seats_remaining <= total_seats)
);

CREATE TABLE OfferingSlot (
    offering_id INT NOT NULL REFERENCES CourseOffering(offering_id) ON DELETE CASCADE,
    slot_id INT NOT NULL REFERENCES Slot(slot_id) ON DELETE CASCADE,
    PRIMARY KEY (offering_id, slot_id)
);

CREATE TABLE StudentPreference (
    preference_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES Student(student_id) ON DELETE CASCADE,
    course_id INT NOT NULL REFERENCES Course(course_id) ON DELETE CASCADE,
    professor_id INT NOT NULL REFERENCES Professor(professor_id) ON DELETE CASCADE,
    theory_offering_id INT REFERENCES CourseOffering(offering_id) ON DELETE SET NULL,
    lab_offering_id INT REFERENCES CourseOffering(offering_id) ON DELETE SET NULL,
    priority_rank INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
    UNIQUE (student_id, course_id, priority_rank)
);

CREATE TABLE Enrollment (
    enrollment_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES Student(student_id) ON DELETE CASCADE,
    offering_id INT NOT NULL REFERENCES CourseOffering(offering_id) ON DELETE CASCADE,
    enrollment_date TIMESTAMPTZ DEFAULT now(),
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
    completed_at TIMESTAMPTZ,  -- set when the student has finished the course; unlocks reviews
    UNIQUE (student_id, offering_id)
);

CREATE TABLE Waitlist (
    waitlist_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES Student(student_id) ON DELETE CASCADE,
    offering_id INT NOT NULL REFERENCES CourseOffering(offering_id) ON DELETE CASCADE,
    queue_position INT NOT NULL,
    date_added TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE RegistrationProgress (
    student_id INT PRIMARY KEY REFERENCES Student(student_id) ON DELETE CASCADE,
    current_course_index INT DEFAULT 0,
    status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed'))
);

-- ------------------------------------------------------------
-- Security: Supabase exposes every public table through its REST
-- API using the public anon key. Turning RLS on with NO policies
-- blocks that API completely. Our Express backend connects as the
-- postgres role, which bypasses RLS, so the app keeps working.
-- ------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE Student ENABLE ROW LEVEL SECURITY;
ALTER TABLE Professor ENABLE ROW LEVEL SECURITY;
ALTER TABLE Course ENABLE ROW LEVEL SECURITY;
ALTER TABLE Slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE SlotSchedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE CourseOffering ENABLE ROW LEVEL SECURITY;
ALTER TABLE OfferingSlot ENABLE ROW LEVEL SECURITY;
ALTER TABLE StudentPreference ENABLE ROW LEVEL SECURITY;
ALTER TABLE Enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE Waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE Review ENABLE ROW LEVEL SECURITY;
ALTER TABLE RegistrationProgress ENABLE ROW LEVEL SECURITY;
