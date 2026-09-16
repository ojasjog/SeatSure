-- ============================================================
-- SeatSure Database Schema
-- BACSE202 - Database Systems
-- Hardik Jaiswal (25BCE0812), Ojas Jog (25BCE2407)
-- ============================================================

CREATE DATABASE IF NOT EXISTS seatsure;
USE seatsure;

-- Drop tables if they exist (clean re-run during development)
DROP TABLE IF EXISTS Review;
DROP TABLE IF EXISTS Waitlist;
DROP TABLE IF EXISTS Enrollment;
DROP TABLE IF EXISTS RegistrationProgress;
DROP TABLE IF EXISTS StudentPreference;
DROP TABLE IF EXISTS OfferingSlot;
DROP TABLE IF EXISTS CourseOffering;
DROP TABLE IF EXISTS SlotSchedule;
DROP TABLE IF EXISTS Slot;
DROP TABLE IF EXISTS Course;
DROP TABLE IF EXISTS Professor;
DROP TABLE IF EXISTS Student;
DROP TABLE IF EXISTS User;

-- ============================================================
-- 1. User (login/auth)
-- ============================================================
CREATE TABLE User (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student', 'admin') NOT NULL DEFAULT 'student'
);

-- ============================================================
-- 2. Student
-- ============================================================
CREATE TABLE Student (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    reg_no VARCHAR(20) UNIQUE NOT NULL,
    branch VARCHAR(50),
    semester INT,
    registration_order INT UNIQUE, -- assigned FFCS turn number (mail order)
    FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
);

-- ============================================================
-- 3. Professor
-- ============================================================
CREATE TABLE Professor (
    professor_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(50),
    UNIQUE KEY unique_professor_name (name)
);

-- ============================================================
-- 4. Course
-- ============================================================
CREATE TABLE Course (
    course_id INT AUTO_INCREMENT PRIMARY KEY,
    course_code VARCHAR(20) UNIQUE NOT NULL,
    course_name VARCHAR(100) NOT NULL,
    credits INT NOT NULL
);

-- ============================================================
-- 5. Slot (ATOMIC slot codes only, e.g. "A1", "TA1", "L1", "L18")
-- A combined code like "A2+TA2" is represented as TWO Slot rows
-- linked to one CourseOffering via the OfferingSlot junction table.
-- ============================================================
CREATE TABLE Slot (
    slot_id INT AUTO_INCREMENT PRIMARY KEY,
    slot_code VARCHAR(10) UNIQUE NOT NULL, -- e.g. "A1", "TA1", "L18"
    slot_type ENUM('theory', 'lab') NOT NULL
);

-- ============================================================
-- 5b. SlotSchedule (1NF fix: a slot code can occur on MULTIPLE
-- day/time combinations per week, e.g. "A1" = Mon 8:00 AND Wed
-- 9:00. Storing multiple times in one Slot row would violate 1NF,
-- so each occurrence gets its own row here.)
-- ============================================================
CREATE TABLE SlotSchedule (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    slot_id INT NOT NULL,
    day_of_week ENUM('Mon','Tue','Wed','Thu','Fri','Sat','Sun') NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    FOREIGN KEY (slot_id) REFERENCES Slot(slot_id) ON DELETE CASCADE,
    UNIQUE KEY unique_slot_day (slot_id, day_of_week)
);

-- ============================================================
-- 6. CourseOffering (Course + Professor + Venue; NO direct slot
-- reference here — see OfferingSlot junction table below)
-- ============================================================
CREATE TABLE CourseOffering (
    offering_id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    professor_id INT NOT NULL,
    venue VARCHAR(20) NOT NULL,
    course_type ENUM('theory', 'lab') NOT NULL,
    total_seats INT NOT NULL DEFAULT 60,
    seats_remaining INT NOT NULL DEFAULT 60,
    FOREIGN KEY (course_id) REFERENCES Course(course_id) ON DELETE CASCADE,
    FOREIGN KEY (professor_id) REFERENCES Professor(professor_id) ON DELETE CASCADE,
    CHECK (seats_remaining >= 0 AND seats_remaining <= total_seats)
);

-- ============================================================
-- 6b. OfferingSlot (junction: M:N between CourseOffering and Slot.
-- A combined code like "A2+TA2" means this offering occupies BOTH
-- the A2 slot AND the TA2 slot. This is what makes clash detection
-- accurate: two offerings clash if they share ANY row here with
-- the same slot_id.)
-- ============================================================
CREATE TABLE OfferingSlot (
    offering_id INT NOT NULL,
    slot_id INT NOT NULL,
    PRIMARY KEY (offering_id, slot_id),
    FOREIGN KEY (offering_id) REFERENCES CourseOffering(offering_id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id) REFERENCES Slot(slot_id) ON DELETE CASCADE
);

-- ============================================================
-- 7. StudentPreference (pre-FFCS priority ranking)
-- ============================================================
CREATE TABLE StudentPreference (
    preference_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    professor_id INT NOT NULL,
    priority_rank INT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES Course(course_id) ON DELETE CASCADE,
    FOREIGN KEY (professor_id) REFERENCES Professor(professor_id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_course_rank (student_id, course_id, priority_rank)
);

-- ============================================================
-- 8. Enrollment
-- ============================================================
CREATE TABLE Enrollment (
    enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    offering_id INT NOT NULL,
    enrollment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('confirmed', 'cancelled') DEFAULT 'confirmed',
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE,
    FOREIGN KEY (offering_id) REFERENCES CourseOffering(offering_id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_offering (student_id, offering_id)
);

-- ============================================================
-- 9. Waitlist
-- ============================================================
CREATE TABLE Waitlist (
    waitlist_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    offering_id INT NOT NULL,
    queue_position INT NOT NULL,
    date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE,
    FOREIGN KEY (offering_id) REFERENCES CourseOffering(offering_id) ON DELETE CASCADE
);

-- ============================================================
-- 10. Review (only valid if linked to a completed Enrollment)
-- ============================================================
CREATE TABLE Review (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id INT NOT NULL UNIQUE,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    review_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES Enrollment(enrollment_id) ON DELETE CASCADE
);

-- ============================================================
-- 11. RegistrationProgress (live FFCS flow tracker)
-- ============================================================
CREATE TABLE RegistrationProgress (
    student_id INT PRIMARY KEY,
    current_course_index INT DEFAULT 0,
    status ENUM('not_started', 'in_progress', 'completed') DEFAULT 'not_started',
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE
);
