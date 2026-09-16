// ============================================================
// SeatSure Backend - Main Server
// ============================================================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { generateToken, authenticateToken, requireStudent } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// ------------------------------------------------------------
// POST /api/auth/signup
// Body: { username, password, name, reg_no, branch, semester }
// ------------------------------------------------------------
app.post("/api/auth/signup", async (req, res) => {
  const { username, password, name, reg_no, branch, semester } = req.body;

  if (!username || !password || !name || !reg_no) {
    return res
      .status(400)
      .json({ error: "username, password, name and reg_no are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      `SELECT user_id FROM User WHERE username = ?`,
      [username]
    );
    if (existing.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ error: "Username already taken" });
    }

    const [existingReg] = await connection.query(
      `SELECT student_id FROM Student WHERE reg_no = ?`,
      [reg_no]
    );
    if (existingReg.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ error: "Registration number already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [userResult] = await connection.query(
      `INSERT INTO User (username, password_hash, role) VALUES (?, ?, 'student')`,
      [username, passwordHash]
    );
    const userId = userResult.insertId;

    const [studentResult] = await connection.query(
      `INSERT INTO Student (user_id, name, reg_no, branch, semester)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, name, reg_no, branch || null, semester || null]
    );

    await connection.commit();
    connection.release();

    const user = {
      user_id: userId,
      username,
      role: "student",
      student_id: studentResult.insertId,
    };
    const token = generateToken(user);

    res.status(201).json({
      token,
      student: {
        student_id: user.student_id,
        user_id: userId,
        username,
        name,
        reg_no,
        branch: branch || null,
        semester: semester || null,
      },
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ------------------------------------------------------------
// POST /api/auth/login
// ------------------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.role,
              s.student_id, s.name, s.reg_no, s.branch, s.semester
       FROM User u
       LEFT JOIN Student s ON s.user_id = u.user_id
       WHERE u.username = ?`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const account = rows[0];
    const passwordMatches = await bcrypt.compare(password, account.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = generateToken(account);

    res.json({
      token,
      student: {
        student_id: account.student_id,
        user_id: account.user_id,
        username: account.username,
        name: account.name,
        reg_no: account.reg_no,
        branch: account.branch,
        semester: account.semester,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ------------------------------------------------------------
// GET /api/auth/me
// ------------------------------------------------------------
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.student_id, s.user_id, u.username, s.name, s.reg_no, s.branch, s.semester
       FROM Student s
       JOIN User u ON u.user_id = s.user_id
       WHERE s.student_id = ?`,
      [req.user.student_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

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
app.post("/api/register", authenticateToken, requireStudent, async (req, res) => {
  const { offering_id } = req.body;
  const student_id = req.user.student_id;

  if (!offering_id) {
    return res.status(400).json({ error: "offering_id is required" });
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
app.post("/api/preferences", authenticateToken, requireStudent, async (req, res) => {
  const { preferences } = req.body;
  const student_id = req.user.student_id;
  if (!Array.isArray(preferences)) {
    return res.status(400).json({ error: "preferences[] is required" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.query(`DELETE FROM StudentPreference WHERE student_id = ?`, [student_id]);
    for (const pref of preferences) {
  await connection.query(
    `INSERT INTO StudentPreference
       (student_id, course_id, professor_id, theory_offering_id, lab_offering_id, priority_rank)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      student_id,
      pref.course_id,
      pref.professor_id,
      pref.theory_offering_id || null,
      pref.lab_offering_id || null,
      pref.priority_rank,
    ]
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
app.get("/api/preferences/:studentId", authenticateToken, async (req, res) => {
  if (
    req.user.role === "student" &&
    Number(req.params.studentId) !== req.user.student_id
  ) {
    return res.status(403).json({ error: "You can only view your own preferences" });
  }
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
app.get("/api/timetable/:studentId", authenticateToken, async (req, res) => {
  const studentId =
    req.params.studentId === "me" ? req.user.student_id : req.params.studentId;

  if (
    req.user.role === "student" &&
    Number(studentId) !== req.user.student_id
  ) {
    return res.status(403).json({ error: "You can only generate your own timetable" });
  }

    try {
    // 1. Get student's ranked preferences, grouped by course.
    // Each preference now carries the EXACT theory/lab offering ids
    // the student picked, not just a professor.
    const [prefRows] = await pool.query(
      `SELECT course_id, professor_id, theory_offering_id, lab_offering_id, priority_rank
       FROM StudentPreference
       WHERE student_id = ?
       ORDER BY course_id, priority_rank`,
      [studentId]
    );

    if (prefRows.length === 0) {
      return res.status(404).json({ error: "No preferences set for this student" });
    }

    // Group: courseId -> [{ professor_id, theory_offering_id, lab_offering_id, priority_rank }, ...]
    const courseMap = new Map();
    for (const row of prefRows) {
      if (!courseMap.has(row.course_id)) courseMap.set(row.course_id, []);
      courseMap.get(row.course_id).push({
        professor_id: row.professor_id,
        theory_offering_id: row.theory_offering_id,
        lab_offering_id: row.lab_offering_id,
        priority_rank: row.priority_rank,
      });
    }
    const courseIds = Array.from(courseMap.keys());

        // 2. For each preference, build its EXACT section using the
    // stored theory_offering_id + lab_offering_id — no more
    // substituting a different section from the same professor.
    const candidateSections = {};
    const courseProfessorNames = {};
    const courseNameCache = {};

    const allOfferingIds = [];
    for (const courseId of courseIds) {
      for (const pref of courseMap.get(courseId)) {
        if (pref.theory_offering_id) allOfferingIds.push(pref.theory_offering_id);
        if (pref.lab_offering_id) allOfferingIds.push(pref.lab_offering_id);
      }
    }

    let offeringSlotRows = [];
    if (allOfferingIds.length > 0) {
      const [rows] = await pool.query(
        `SELECT co.offering_id, co.professor_id, p.name AS professor_name,
                c.course_id, c.course_name, os.slot_id, s.slot_code
         FROM CourseOffering co
         JOIN Professor p ON co.professor_id = p.professor_id
         JOIN Course c ON co.course_id = c.course_id
         JOIN OfferingSlot os ON co.offering_id = os.offering_id
         JOIN Slot s ON os.slot_id = s.slot_id
         WHERE co.offering_id IN (${allOfferingIds.map(() => "?").join(",")})`,
        allOfferingIds
      );
      offeringSlotRows = rows;
    }

    // offeringData[offering_id] = { slotIds: Set, slotCodes: Set }
    const offeringData = {};
    for (const row of offeringSlotRows) {
      if (!offeringData[row.offering_id]) {
        offeringData[row.offering_id] = { slotIds: new Set(), slotCodes: new Set() };
      }
      offeringData[row.offering_id].slotIds.add(row.slot_id);
      offeringData[row.offering_id].slotCodes.add(row.slot_code);
      courseProfessorNames[row.course_id] = courseProfessorNames[row.course_id] || {};
      courseProfessorNames[row.course_id][row.professor_id] = row.professor_name;
      courseNameCache[row.course_id] = row.course_name;
    }

    for (const courseId of courseIds) {
      candidateSections[courseId] = {};
      for (const pref of courseMap.get(courseId)) {
        const slotIds = new Set();
        const slotCodes = new Set();
        const offeringIds = new Set();

        if (pref.theory_offering_id && offeringData[pref.theory_offering_id]) {
          offeringData[pref.theory_offering_id].slotIds.forEach((s) => slotIds.add(s));
          offeringData[pref.theory_offering_id].slotCodes.forEach((s) => slotCodes.add(s));
          offeringIds.add(pref.theory_offering_id);
        }
        if (pref.lab_offering_id && offeringData[pref.lab_offering_id]) {
          offeringData[pref.lab_offering_id].slotIds.forEach((s) => slotIds.add(s));
          offeringData[pref.lab_offering_id].slotCodes.forEach((s) => slotCodes.add(s));
          offeringIds.add(pref.lab_offering_id);
        }

        candidateSections[courseId][pref.professor_id] = [
          { offeringIds, slotIds, slotCodes },
        ];
      }
    }

    // 3. Backtracking search across courses. For each course, try
    // professors in priority order; for each professor, try each of
    // their distinct sections as an alternative.
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
      const candidates = courseMap.get(courseId); // rank-ordered professors

      for (const cand of candidates) {
        const sections = candidateSections[courseId][cand.professor_id] || [];

        for (const section of sections) {
          let clash = false;
          for (const slotId of section.slotIds) {
            if (chosenSlotIds.has(slotId)) {
              clash = true;
              break;
            }
          }
          if (clash) continue;

          const newSlotIds = new Set(chosenSlotIds);
          section.slotIds.forEach((s) => newSlotIds.add(s));

          chosen.push({
            course_id: courseId,
            professor_id: cand.professor_id,
            courseName: courseNameCache[courseId],
            professorName: courseProfessorNames[courseId][cand.professor_id],
            offeringIds: section.offeringIds,
            slotCodes: section.slotCodes,
            priority_rank: cand.priority_rank,
          });

          backtrack(index + 1, newSlotIds, chosen, rankSum + cand.priority_rank);

          chosen.pop();
        }
      }
    }

    backtrack(0, new Set(), [], 0);

    // Sort by best (lowest) total rank sum = best priority match
    results.sort((a, b) => a.rankSum - b.rankSum);

    // If nothing was found, pinpoint which pair of courses clash,
    // checking each course's top (rank 1) professor's best section.
    let diagnostic = null;
    if (results.length === 0) {
      const top = courseIds.map((courseId) => {
        const rank1Prof = courseMap.get(courseId)[0];
        const sections = candidateSections[courseId][rank1Prof.professor_id] || [];
        const bestSection = sections[0]; // just show the first section as representative
        return {
          courseId,
          courseName: courseNameCache[courseId],
          professorName: courseProfessorNames[courseId][rank1Prof.professor_id],
          slotIds: bestSection?.slotIds || new Set(),
          slotCodes: bestSection?.slotCodes || new Set(),
        };
      });

      const clashes = [];
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) {
          const shared = [...top[i].slotIds].filter((id) => top[j].slotIds.has(id));
          if (shared.length > 0) {
            const sharedCodes = [...top[i].slotCodes].filter((code) =>
              [...top[j].slotCodes].includes(code)
            );
            clashes.push({
              course_a: top[i].courseName,
              professor_a: top[i].professorName,
              course_b: top[j].courseName,
              professor_b: top[j].professorName,
              shared_slot_codes: sharedCodes,
            });
          }
        }
      }

      diagnostic = { usingTopChoiceOnly: true, clashes };
    }

    res.json({ count: results.length, timetables: results, diagnostic });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate timetable" });
  }
});

app.listen(PORT, () => {
  console.log(`SeatSure backend running on http://localhost:${PORT}`);
});
