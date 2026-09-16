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

// ------------------------------------------------------------
// POST /api/preferences
// Body: { student_id, preferences: [{ course_id, professor_id, priority_rank }, ...] }
// Saves a student's ranked professor preferences for pre-FFCS.
// ------------------------------------------------------------
app.post("/api/preferences", async (req, res) => {
  const { student_id, preferences } = req.body;
  if (!student_id || !Array.isArray(preferences)) {
    return res.status(400).json({ error: "student_id and preferences[] are required" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.query(`DELETE FROM StudentPreference WHERE student_id = ?`, [student_id]);
    for (const pref of preferences) {
      await connection.query(
        `INSERT INTO StudentPreference (student_id, course_id, professor_id, priority_rank)
         VALUES (?, ?, ?, ?)`,
        [student_id, pref.course_id, pref.professor_id, pref.priority_rank]
      );
    }
    res.json({ status: "saved", count: preferences.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save preferences" });
  } finally {
    connection.release();
  }
});

// ------------------------------------------------------------
// GET /api/preferences/:studentId
// Returns a student's saved preferences, grouped by course,
// each with the list of candidate professors + their offerings.
// ------------------------------------------------------------
app.get("/api/preferences/:studentId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sp.course_id, c.course_name, sp.professor_id, p.name AS professor_name,
              sp.priority_rank
       FROM StudentPreference sp
       JOIN Course c ON sp.course_id = c.course_id
       JOIN Professor p ON sp.professor_id = p.professor_id
       WHERE sp.student_id = ?
       ORDER BY sp.course_id, sp.priority_rank`,
      [req.params.studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// ------------------------------------------------------------
// GET /api/courses/:id/professors
// For a course, list each professor teaching it with their
// combined offering_ids (theory + lab) and slot codes — used
// by the frontend to build the priority-ranking UI.
// ------------------------------------------------------------
app.get("/api/courses/:id/professors", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.professor_id, p.name, co.offering_id, co.course_type, co.venue,
              GROUP_CONCAT(s.slot_code SEPARATOR '+') AS slot_codes
       FROM CourseOffering co
       JOIN Professor p ON co.professor_id = p.professor_id
       JOIN OfferingSlot os ON co.offering_id = os.offering_id
       JOIN Slot s ON os.slot_id = s.slot_id
       WHERE co.course_id = ?
       GROUP BY co.offering_id, p.professor_id, p.name, co.course_type, co.venue
       ORDER BY p.name, co.course_type`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch professors" });
  }
});

// ------------------------------------------------------------
// GET /api/timetable/:studentId
// Generates clash-free timetable combinations from the student's
// ranked preferences, using backtracking. For each course, tries
// professors in priority order; a professor's FULL set of offerings
// (theory + lab) must be added together and must not share any
// atomic slot with anything already chosen.
// ------------------------------------------------------------
app.get("/api/timetable/:studentId", async (req, res) => {
  const studentId = req.params.studentId;

  try {
    // 1. Get student's ranked preferences, grouped by course
    const [prefRows] = await pool.query(
      `SELECT course_id, professor_id, priority_rank
       FROM StudentPreference
       WHERE student_id = ?
       ORDER BY course_id, priority_rank`,
      [studentId]
    );

    if (prefRows.length === 0) {
      return res.status(404).json({ error: "No preferences set for this student" });
    }

    // Group: courseId -> [{ professor_id, priority_rank }, ...] (already rank-ordered)
    const courseMap = new Map();
    for (const row of prefRows) {
      if (!courseMap.has(row.course_id)) courseMap.set(row.course_id, []);
      courseMap.get(row.course_id).push({
        professor_id: row.professor_id,
        priority_rank: row.priority_rank,
      });
    }
    const courseIds = Array.from(courseMap.keys());

    // 2. For each (course, professor), fetch their offerings + slot_ids
    // candidateData[courseId][professorId] = { offeringIds: [], slotIds: Set, slotCodes: Set, courseName, professorName }
    const candidateData = {};
    for (const courseId of courseIds) {
      candidateData[courseId] = {};
      const professorIds = courseMap.get(courseId).map((p) => p.professor_id);

      const [offRows] = await pool.query(
        `SELECT co.offering_id, co.professor_id, p.name AS professor_name,
                c.course_name, os.slot_id, s.slot_code
         FROM CourseOffering co
         JOIN Professor p ON co.professor_id = p.professor_id
         JOIN Course c ON co.course_id = c.course_id
         JOIN OfferingSlot os ON co.offering_id = os.offering_id
         JOIN Slot s ON os.slot_id = s.slot_id
         WHERE co.course_id = ? AND co.professor_id IN (${professorIds.map(() => "?").join(",")})`,
        [courseId, ...professorIds]
      );

      for (const row of offRows) {
        if (!candidateData[courseId][row.professor_id]) {
          candidateData[courseId][row.professor_id] = {
            offeringIds: new Set(),
            slotIds: new Set(),
            slotCodes: new Set(),
            courseName: row.course_name,
            professorName: row.professor_name,
          };
        }
        candidateData[courseId][row.professor_id].offeringIds.add(row.offering_id);
        candidateData[courseId][row.professor_id].slotIds.add(row.slot_id);
        candidateData[courseId][row.professor_id].slotCodes.add(row.slot_code);
      }
    }

    // 3. Backtracking search across courses
    const results = [];
    const MAX_RESULTS = 10;

    function backtrack(index, chosenSlotIds, chosen, rankSum) {
      if (results.length >= MAX_RESULTS) return;

      if (index === courseIds.length) {
        results.push({
          rankSum,
          selections: chosen.map((c) => ({
            course_id: c.course_id,
            course_name: c.courseName,
            professor_id: c.professor_id,
            professor_name: c.professorName,
            offering_ids: Array.from(c.offeringIds),
            slot_codes: Array.from(c.slotCodes),
            priority_rank: c.priority_rank,
          })),
        });
        return;
      }

      const courseId = courseIds[index];
      const candidates = courseMap.get(courseId); // rank-ordered

      for (const cand of candidates) {
        const data = candidateData[courseId][cand.professor_id];
        if (!data) continue; // no offerings found for this professor

        // Check clash: does any slot of this professor's offerings
        // already exist in chosenSlotIds?
        let clash = false;
        for (const slotId of data.slotIds) {
          if (chosenSlotIds.has(slotId)) {
            clash = true;
            break;
          }
        }
        if (clash) continue;

        // No clash -> choose this professor, recurse
        const newSlotIds = new Set(chosenSlotIds);
        data.slotIds.forEach((s) => newSlotIds.add(s));

        chosen.push({
          course_id: courseId,
          professor_id: cand.professor_id,
          courseName: data.courseName,
          professorName: data.professorName,
          offeringIds: data.offeringIds,
          slotCodes: data.slotCodes,
          priority_rank: cand.priority_rank,
        });

        backtrack(index + 1, newSlotIds, chosen, rankSum + cand.priority_rank);

        chosen.pop();
      }
    }

    backtrack(0, new Set(), [], 0);

    // Sort by best (lowest) total rank sum = best priority match
    results.sort((a, b) => a.rankSum - b.rankSum);

    res.json({ count: results.length, timetables: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate timetable" });
  }
});

app.listen(PORT, () => {
  console.log(`SeatSure backend running on http://localhost:${PORT}`);
});
