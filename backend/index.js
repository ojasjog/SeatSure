// ============================================================
// SeatSure Backend - Main Server
// ============================================================
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// ------------------------------------------------------------
// GET /api/courses - list all courses (basic sanity check route)
// ------------------------------------------------------------
app.get("/api/courses", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM Course");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});

// ------------------------------------------------------------
// GET /api/offerings/:courseId - list offerings for a course
// (professor, venue, type, seats remaining)
// ------------------------------------------------------------
app.get("/api/offerings/:courseId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT co.offering_id, p.name AS professor, co.venue,
              co.course_type, co.total_seats, co.seats_remaining
       FROM CourseOffering co
       JOIN Professor p ON co.professor_id = p.professor_id
       WHERE co.course_id = ?`,
      [req.params.courseId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch offerings" });
  }
});

// ------------------------------------------------------------
// POST /api/register
// Body: { student_id, offering_id }
//
// This is the core business logic of SeatSure:
//  1. Check if this offering clashes with anything the student
//     already has confirmed (shared atomic slot).
//  2. If clear, try to lock a seat safely (transaction-safe,
//     so two students can't take the same last seat).
//  3. If seats are full, add the student to the Waitlist instead.
// ------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  const { student_id, offering_id } = req.body;

  if (!student_id || !offering_id) {
    return res.status(400).json({ error: "student_id and offering_id are required" });
  }

  const connection = await pool.getConnection();

  try {
    // ---- Step 1: Slot-clash check ----
    const [clashes] = await connection.query(
      `SELECT DISTINCT co.offering_id, c.course_name
       FROM Enrollment e
       JOIN OfferingSlot os1 ON e.offering_id = os1.offering_id
       JOIN OfferingSlot os2 ON os1.slot_id = os2.slot_id
       JOIN CourseOffering co ON os2.offering_id = co.offering_id
       JOIN Course c ON co.course_id = c.course_id
       WHERE e.student_id = ?
         AND e.status = 'confirmed'
         AND os2.offering_id = ?`,
      [student_id, offering_id]
    );

    if (clashes.length > 0) {
      connection.release();
      return res.status(409).json({
        error: "Slot clash detected",
        clashesWith: clashes,
      });
    }

    // ---- Step 2: Transaction-safe seat lock ----
    await connection.beginTransaction();

    // Lock the row so no other request can read/modify it until we commit
    const [offeringRows] = await connection.query(
      `SELECT seats_remaining FROM CourseOffering WHERE offering_id = ? FOR UPDATE`,
      [offering_id]
    );

    if (offeringRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Offering not found" });
    }

    const seatsRemaining = offeringRows[0].seats_remaining;

    if (seatsRemaining > 0) {
      // Seat available -> decrement and enroll
      await connection.query(
        `UPDATE CourseOffering SET seats_remaining = seats_remaining - 1 WHERE offering_id = ?`,
        [offering_id]
      );

      await connection.query(
        `INSERT INTO Enrollment (student_id, offering_id, status) VALUES (?, ?, 'confirmed')`,
        [student_id, offering_id]
      );

      await connection.commit();
      connection.release();

      return res.json({ status: "enrolled", message: "Seat confirmed successfully" });
    } else {
      // No seats left -> add to waitlist instead
      const [waitlistCount] = await connection.query(
        `SELECT COUNT(*) AS count FROM Waitlist WHERE offering_id = ?`,
        [offering_id]
      );
      const queuePosition = waitlistCount[0].count + 1;

      await connection.query(
        `INSERT INTO Waitlist (student_id, offering_id, queue_position) VALUES (?, ?, ?)`,
        [student_id, offering_id, queuePosition]
      );

      await connection.commit();
      connection.release();

      return res.json({
        status: "waitlisted",
        message: "Offering is full. Added to waitlist.",
        queuePosition,
      });
    }
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.listen(PORT, () => {
  console.log(`SeatSure backend running on http://localhost:${PORT}`);
});
