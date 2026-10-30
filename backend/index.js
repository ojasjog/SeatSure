// ============================================================
// SeatSure Backend - Main Server
// ============================================================
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { generateToken, authenticateToken, requireStudent, requireAdmin } = require("./auth");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ------------------------------------------------------------
// Socket.IO — live seat counter
// Every client watching (whether or not they're mid-registration)
// gets a "seats:update" event whenever a seat is taken, so counts
// tick down in real time for everyone, not just the student who
// just registered.
// ------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || "*" } });

io.on("connection", (socket) => {
  // No per-socket state needed — this is a broadcast-only channel.
  socket.on("disconnect", () => {});
});

async function emitSeatUpdate(offeringId) {
  try {
    const [[row]] = await pool.query(
      `SELECT seats_remaining, total_seats FROM CourseOffering WHERE offering_id = ?`,
      [offeringId]
    );
    if (row) {
      io.emit("seats:update", {
        offering_id: offeringId,
        seats_remaining: row.seats_remaining,
        total_seats: row.total_seats,
      });
    }
  } catch (err) {
    console.error("emitSeatUpdate failed:", err);
  }
}

// ------------------------------------------------------------
// FFCS turn clock
// Students are released one turn group at a time, in
// registration_order (their assigned FFCS turn number), the same
// way real VIT FFCS staggers students by CGPA/seniority slot.
// FFCS_START_TIME is fixed at server boot; TURN_GAP_SECONDS
// controls how many seconds apart each turn unlocks. Both are
// overridable via .env for a faster/slower simulation.
// ------------------------------------------------------------
let FFCS_START_TIME = process.env.FFCS_START_TIME
  ? new Date(process.env.FFCS_START_TIME)
  : new Date();
const TURN_GAP_SECONDS = Number(process.env.FFCS_TURN_GAP_SECONDS || 10);

async function getTurnGate(studentId) {
  const [[student]] = await pool.query(
    `SELECT registration_order FROM Student WHERE student_id = ?`,
    [studentId]
  );
  if (!student || student.registration_order == null) {
    const err = new Error("No FFCS registration turn assigned to this student.");
    err.statusCode = 400;
    throw err;
  }
  const unlocksAt = new Date(
    FFCS_START_TIME.getTime() + (student.registration_order - 1) * TURN_GAP_SECONDS * 1000
  );
  const now = new Date();
  return {
    registration_order: student.registration_order,
    unlocks_at: unlocksAt.toISOString(),
    open: now >= unlocksAt,
  };
}

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
      `SELECT user_id FROM "User" WHERE username = ?`,
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
      `INSERT INTO "User" (username, password_hash, role) VALUES (?, ?, 'student')`,
      [username, passwordHash]
    );
    const userId = userResult.insertId;

    // Assign the next FFCS turn number (mail order). This is what
    // getTurnGate() in the live FFCS engine gates entry on — without
    // it every student's registration_order stays NULL and /api/ffcs/*
    // rejects them before they ever see a subject.
    const [[orderRow]] = await connection.query(
      `SELECT COALESCE(MAX(registration_order), 0) + 1 AS next_order FROM Student`
    );

    const [studentResult] = await connection.query(
      `INSERT INTO Student (user_id, name, reg_no, branch, semester, registration_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name, reg_no, branch || null, semester || null, orderRow.next_order]
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
        registration_order: orderRow.next_order,
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
       FROM "User" u
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
       JOIN "User" u ON u.user_id = s.user_id
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

      emitSeatUpdate(offering_id);

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
// Body: { preferences: [...] }
// Saves the student's current priorities as a DRAFT (Save Progress).
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
           (student_id, course_id, professor_id, theory_offering_id, lab_offering_id, priority_rank, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
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
// POST /api/preferences/submit
// Locks in the student's CURRENTLY SAVED preferences as final,
// for use during the live FFCS simulation.
// ------------------------------------------------------------
app.post("/api/preferences/submit", authenticateToken, requireStudent, async (req, res) => {
  const student_id = req.user.student_id;

  try {
    const [result] = await pool.query(
      `UPDATE StudentPreference SET status = 'submitted' WHERE student_id = ?`,
      [student_id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: "No saved preferences to submit. Save your priorities first." });
    }

    res.json({ status: "submitted", count: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit preferences" });
  }
});

// ------------------------------------------------------------
// GET /api/preferences/me
// Restores the logged-in student's saved priorities (draft or
// submitted), grouped by course, for the frontend to rebuild
// the priority UI on login/page load.
// ------------------------------------------------------------
app.get("/api/preferences/me", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sp.course_id, c.course_name, sp.professor_id, p.name AS professor_name,
              sp.theory_offering_id, sp.lab_offering_id, sp.priority_rank, sp.status
       FROM StudentPreference sp
       JOIN Course c ON sp.course_id = c.course_id
       JOIN Professor p ON sp.professor_id = p.professor_id
       WHERE sp.student_id = ?
       ORDER BY sp.course_id, sp.priority_rank`,
      [req.user.student_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch saved preferences" });
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
              string_agg(s.slot_code, '+') AS slot_codes
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

// ============================================================
// LIVE FFCS SIMULATOR
// The "Submit for FFCS" button locks StudentPreference rows to
// status='submitted'. Everything below is the actual live-round
// engine that consumes those locked priorities.
// ============================================================

// Fixed subject order for a student = the order they ranked
// courses in when they saved preferences (earliest preference_id
// per course), not alphabetical/course_id order.
async function getStudentCourseOrder(conn, studentId) {
  const [rows] = await conn.query(
    `SELECT course_id, MIN(preference_id) AS first_pref_id
     FROM StudentPreference
     WHERE student_id = ? AND status = 'submitted'
     GROUP BY course_id
     ORDER BY first_pref_id`,
    [studentId]
  );
  return rows.map((r) => r.course_id);
}

async function getLockedSlotIds(conn, studentId) {
  const [rows] = await conn.query(
    `SELECT DISTINCT os.slot_id
     FROM Enrollment e
     JOIN OfferingSlot os ON e.offering_id = os.offering_id
     WHERE e.student_id = ? AND e.status = 'confirmed'`,
    [studentId]
  );
  return new Set(rows.map((r) => r.slot_id));
}

// ------------------------------------------------------------
// GET /api/ffcs/session
// Tells the frontend whether this student's turn has started yet,
// and when it will if not.
// ------------------------------------------------------------
app.get("/api/ffcs/session", authenticateToken, requireStudent, async (req, res) => {
  try {
    const gate = await getTurnGate(req.user.student_id);
    res.json({
      ...gate,
      ffcs_start_time: FFCS_START_TIME.toISOString(),
      turn_gap_seconds: TURN_GAP_SECONDS,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to load session" });
  }
});

// ------------------------------------------------------------
// GET /api/ffcs/options
// Read-only view of the CURRENT subject only (one-by-one, per
// RegistrationProgress.current_course_index). Returns EVERY
// faculty member teaching this course (not just the student's
// shortlist) so the frontend can render a plain pick-one list.
// Each faculty row carries priority_rank (null if the student
// never ranked them) so the client can pin/highlight their
// shortlist at the top. Faculty whose slots clash with something
// the student already locked in are filtered out automatically,
// exactly like the real round.
// ------------------------------------------------------------
app.get("/api/ffcs/options", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  try {
    const gate = await getTurnGate(studentId);
    if (!gate.open) {
      return res.status(403).json({ error: "Your FFCS turn hasn't started yet.", unlocks_at: gate.unlocks_at });
    }

    const courseIds = await getStudentCourseOrder(pool, studentId);
    if (courseIds.length === 0) {
      return res.status(400).json({ error: "No submitted priorities found. Submit for FFCS first." });
    }

    await pool.query(
      `INSERT INTO RegistrationProgress (student_id, current_course_index, status)
       VALUES (?, 0, 'in_progress')
       ON CONFLICT (student_id) DO UPDATE SET status = CASE WHEN RegistrationProgress.status = 'not_started' THEN 'in_progress' ELSE RegistrationProgress.status END`,
      [studentId]
    );

    const [[progress]] = await pool.query(
      `SELECT current_course_index, status FROM RegistrationProgress WHERE student_id = ?`,
      [studentId]
    );

    if (progress.status === "completed" || progress.current_course_index >= courseIds.length) {
      return res.json({ done: true, total_courses: courseIds.length });
    }

    const currentCourseId = courseIds[progress.current_course_index];
    const lockedSlotIds = await getLockedSlotIds(pool, studentId);

    const [[course]] = await pool.query(
      `SELECT course_id, course_code, course_name, credits FROM Course WHERE course_id = ?`,
      [currentCourseId]
    );

    // Every offering (theory/lab rows) for every professor teaching
    // this course, with each offering's slots.
    const [offeringRows] = await pool.query(
      `SELECT p.professor_id, p.name AS professor_name, co.offering_id, co.course_type,
              co.venue, s.slot_id, s.slot_code
       FROM CourseOffering co
       JOIN Professor p ON co.professor_id = p.professor_id
       JOIN OfferingSlot os ON os.offering_id = co.offering_id
       JOIN Slot s ON s.slot_id = os.slot_id
       WHERE co.course_id = ?
       ORDER BY p.name, co.course_type`,
      [currentCourseId]
    );

    // The student's own priority ranking for this course, if any
    // (submitted during the ranking step) — used only to sort/highlight.
    const [prefRows] = await pool.query(
      `SELECT professor_id, priority_rank
       FROM StudentPreference
       WHERE student_id = ? AND course_id = ? AND status = 'submitted'`,
      [studentId, currentCourseId]
    );
    const rankByProfessor = new Map(prefRows.map((r) => [r.professor_id, r.priority_rank]));

    // Group offering rows by professor.
    const byProfessor = new Map();
    for (const row of offeringRows) {
      if (!byProfessor.has(row.professor_id)) {
        byProfessor.set(row.professor_id, {
          professor_id: row.professor_id,
          professor_name: row.professor_name,
          offeringsById: new Map(),
        });
      }
      const prof = byProfessor.get(row.professor_id);
      if (!prof.offeringsById.has(row.offering_id)) {
        prof.offeringsById.set(row.offering_id, {
          offering_id: row.offering_id,
          course_type: row.course_type,
          venue: row.venue,
          slot_ids: new Set(),
          slot_codes: new Set(),
        });
      }
      const offering = prof.offeringsById.get(row.offering_id);
      offering.slot_ids.add(row.slot_id);
      offering.slot_codes.add(row.slot_code);
    }

    const faculty = [];
for (const prof of byProfessor.values()) {
  const sections = [...prof.offeringsById.values()];

  // Keep only the sections that DON'T clash with a locked slot —
  // not the whole professor, since a vendor/professor can teach
  // multiple independent sections at different times.
  const validSections = sections.filter(
    (s) => ![...s.slot_ids].some((id) => lockedSlotIds.has(id))
  );

  if (validSections.length === 0) continue; // every section clashes — hide entirely

  const combinedCodes = new Set();
  validSections.forEach((s) => s.slot_codes.forEach((c) => combinedCodes.add(c)));

  faculty.push({
    professor_id: prof.professor_id,
    professor_name: prof.professor_name,
    priority_rank: rankByProfessor.has(prof.professor_id)
      ? rankByProfessor.get(prof.professor_id)
      : null,
    slot_codes: [...combinedCodes],
    sections: validSections.map((s) => ({
      offering_id: s.offering_id,
      course_type: s.course_type,
      venue: s.venue,
      slot_codes: [...s.slot_codes],
    })),
  });
}

    res.json({
      done: false,
      course_index: progress.current_course_index,
      total_courses: courseIds.length,
      course,
      faculty,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to load FFCS options" });
  }
});

// ------------------------------------------------------------
// POST /api/ffcs/confirm
// Body: { professor_id }
// The ONE button on the live FFCS page. The student picks exactly
// one faculty member (radio button) for the current subject; the
// server tries to lock that specific choice, transactionally:
//   - reject if it clashes with something already locked
//   - reject if it's full
//   - otherwise lock every offering for that professor (theory +
//     lab together) and advance to the next subject
// A rejected pick does NOT advance the subject, so the student can
// choose someone else and confirm again.
// ------------------------------------------------------------
app.post("/api/ffcs/confirm", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const { professor_id } = req.body;
  const connection = await pool.getConnection();
 
  try {
    const gate = await getTurnGate(studentId);
    if (!gate.open) {
      connection.release();
      return res.status(403).json({ error: "Your FFCS turn hasn't started yet.", unlocks_at: gate.unlocks_at });
    }
 
    if (!professor_id) {
      connection.release();
      return res.status(400).json({ error: "Select a faculty member first." });
    }
 
    const courseIds = await getStudentCourseOrder(connection, studentId);
    if (courseIds.length === 0) {
      connection.release();
      return res.status(400).json({ error: "No submitted priorities found. Submit for FFCS first." });
    }
 
    const [[progress]] = await connection.query(
      `SELECT current_course_index, status FROM RegistrationProgress WHERE student_id = ?`,
      [studentId]
    );
 
    if (!progress || progress.status === "completed" || progress.current_course_index >= courseIds.length) {
      connection.release();
      return res.json({ done: true });
    }
 
    const courseId = courseIds[progress.current_course_index];
 
    const [[course]] = await pool.query(
      `SELECT course_id, course_code, course_name FROM Course WHERE course_id = ?`,
      [courseId]
    );
 
    await connection.beginTransaction();
 
    const [[professor]] = await connection.query(
      `SELECT professor_id, name AS professor_name FROM Professor WHERE professor_id = ?`,
      [professor_id]
    );
    if (!professor) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Faculty member not found." });
    }
 
    // ---- Fetch every offering this professor has for this course,
    // with course_type + their exact slot_ids, locking each row ----
    const [offRows] = await connection.query(
      `SELECT co.offering_id, co.course_type, co.seats_remaining
       FROM CourseOffering co
       WHERE co.course_id = ? AND co.professor_id = ?
       FOR UPDATE`,
      [courseId, professor_id]
    );
    if (offRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "That faculty member doesn't teach this subject." });
    }
 
    const offeringIds = offRows.map((r) => r.offering_id);
    const [slotRows] = await connection.query(
      `SELECT offering_id, slot_id FROM OfferingSlot WHERE offering_id IN (${offeringIds.map(() => "?").join(",")})`,
      offeringIds
    );
 
    const slotsByOffering = new Map();
    for (const row of slotRows) {
      if (!slotsByOffering.has(row.offering_id)) slotsByOffering.set(row.offering_id, new Set());
      slotsByOffering.get(row.offering_id).add(row.slot_id);
    }

        // ---- NEW: pull the student's saved preference for this course,
    // so we honor the EXACT section they picked in pre-FFCS ----
    const [[pref]] = await connection.query(
      `SELECT theory_offering_id, lab_offering_id
       FROM StudentPreference
       WHERE student_id = ? AND course_id = ? AND professor_id = ?`,
      [studentId, courseId, professor_id]
    );
    const preferredOfferingIds = new Set(
      [pref?.theory_offering_id, pref?.lab_offering_id].filter(Boolean)
    );
 
    const lockedSlotIds = await getLockedSlotIds(connection, studentId);
 
    const theoryOfferings = offRows.filter((r) => r.course_type !== "lab");
    const labOfferings = offRows.filter((r) => r.course_type === "lab");
 
    // Build every valid combination: theory+lab pair (self-clash
    // checked), or a single section if only one type exists.
    const candidates = []; // [{ offeringIds: [...], slotIds: Set }]
 
    function offeringSlots(id) {
      return slotsByOffering.get(id) || new Set();
    }
 
    if (theoryOfferings.length > 0 && labOfferings.length > 0) {
      for (const t of theoryOfferings) {
        for (const l of labOfferings) {
          const tSlots = offeringSlots(t.offering_id);
          const lSlots = offeringSlots(l.offering_id);
          const selfClash = [...tSlots].some((id) => lSlots.has(id));
          if (selfClash) continue;
          candidates.push({
            offeringIds: [t.offering_id, l.offering_id],
            slotIds: new Set([...tSlots, ...lSlots]),
            seatsOk: t.seats_remaining > 0 && l.seats_remaining > 0,
          });
        }
      }
    } else {
      for (const o of offRows) {
        candidates.push({
          offeringIds: [o.offering_id],
          slotIds: offeringSlots(o.offering_id),
          seatsOk: o.seats_remaining > 0,
        });
      }
    }
 
    // Pick the first candidate that doesn't clash with locked slots.
    const nonClashing = candidates.filter(
      (c) => ![...c.slotIds].some((id) => lockedSlotIds.has(id))
    );
 
    if (nonClashing.length === 0) {
      await connection.rollback();
      connection.release();
      return res.json({
        done: false,
        course,
        allocated: false,
        reason: "clash",
        message: `${professor.professor_name} clashes with a subject you've already locked in.`,
      });
    }
 
    const withSeats = nonClashing.filter((c) => c.seatsOk);
    if (withSeats.length === 0) {
      await connection.rollback();
      connection.release();
      return res.json({
        done: false,
        course,
        allocated: false,
        reason: "full",
        message: `${professor.professor_name}'s section just filled up. Pick another faculty member.`,
      });
    }
 
        // Prefer the candidate that matches the student's saved exact section(s).
        const preferredMatch = withSeats.find((c) =>
      c.offeringIds.length === preferredOfferingIds.size &&
      c.offeringIds.every((id) => preferredOfferingIds.has(id))
    );
    const chosen = preferredMatch || withSeats[0];
 
    for (const offeringId of chosen.offeringIds) {
      await connection.query(
        `UPDATE CourseOffering SET seats_remaining = seats_remaining - 1 WHERE offering_id = ?`,
        [offeringId]
      );
      await connection.query(
        `INSERT INTO Enrollment (student_id, offering_id, status) VALUES (?, ?, 'confirmed')`,
        [studentId, offeringId]
      );
    }
 
    const nextIndex = progress.current_course_index + 1;
    const nextStatus = nextIndex >= courseIds.length ? "completed" : "in_progress";
 
    await connection.query(
      `UPDATE RegistrationProgress SET current_course_index = ?, status = ? WHERE student_id = ?`,
      [nextIndex, nextStatus, studentId]
    );
 
    await connection.commit();
    connection.release();
 
    chosen.offeringIds.forEach((id) => emitSeatUpdate(id));
 
    res.json({
      done: nextIndex >= courseIds.length,
      course,
      allocated: true,
      allocation: {
        professor_id: professor.professor_id,
        professor_name: professor.professor_name,
        offering_ids: chosen.offeringIds,
      },
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err);
    res.status(500).json({ error: "Failed to confirm registration" });
  }
});
 

// ------------------------------------------------------------
// POST /api/ffcs/skip
// Marks the current subject as not allocated and moves on, for
// when the student doesn't want (or isn't able) to lock in any
// of the listed faculty.
// ------------------------------------------------------------
app.post("/api/ffcs/skip", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  try {
    const gate = await getTurnGate(studentId);
    if (!gate.open) {
      return res.status(403).json({ error: "Your FFCS turn hasn't started yet.", unlocks_at: gate.unlocks_at });
    }

    const courseIds = await getStudentCourseOrder(pool, studentId);
    const [[progress]] = await pool.query(
      `SELECT current_course_index, status FROM RegistrationProgress WHERE student_id = ?`,
      [studentId]
    );

    if (!progress || progress.status === "completed" || progress.current_course_index >= courseIds.length) {
      return res.json({ done: true });
    }

    const nextIndex = progress.current_course_index + 1;
    const nextStatus = nextIndex >= courseIds.length ? "completed" : "in_progress";

    await pool.query(
      `UPDATE RegistrationProgress SET current_course_index = ?, status = ? WHERE student_id = ?`,
      [nextIndex, nextStatus, studentId]
    );

    res.json({ done: nextIndex >= courseIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to skip subject" });
  }
});

// ------------------------------------------------------------
// GET /api/ffcs/summary
// Final Summary Screen data: every subject the student ranked,
// allocated or not, once their round is complete (or mid-round,
// for a live progress view).
// ------------------------------------------------------------
app.get("/api/ffcs/summary", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  try {
    const courseIds = await getStudentCourseOrder(pool, studentId);

    let courses = [];
    if (courseIds.length > 0) {
      const placeholders = courseIds.map(() => "?").join(",");
      [courses] = await pool.query(
        `SELECT course_id, course_code, course_name, credits FROM Course WHERE course_id IN (${placeholders})`,
        courseIds
      );
    }
    const courseMap = new Map(courses.map((c) => [c.course_id, c]));

    const [enrolledRows] = await pool.query(
      `SELECT co.course_id, co.course_type, co.venue, p.name AS professor_name,
              string_agg(DISTINCT s.slot_code, '+') AS slot_codes
       FROM Enrollment e
       JOIN CourseOffering co ON e.offering_id = co.offering_id
       JOIN Professor p ON co.professor_id = p.professor_id
       JOIN OfferingSlot os ON os.offering_id = co.offering_id
       JOIN Slot s ON s.slot_id = os.slot_id
       WHERE e.student_id = ? AND e.status = 'confirmed'
       GROUP BY co.course_id, co.offering_id, co.course_type, co.venue, p.name`,
      [studentId]
    );

    const byCourse = new Map();
    for (const row of enrolledRows) {
      if (!byCourse.has(row.course_id)) {
        byCourse.set(row.course_id, { professor_name: row.professor_name, sections: [] });
      }
      byCourse.get(row.course_id).sections.push({
        course_type: row.course_type,
        venue: row.venue,
        slot_codes: row.slot_codes,
      });
    }

    const [[progress]] = await pool.query(
      `SELECT current_course_index, status FROM RegistrationProgress WHERE student_id = ?`,
      [studentId]
    );

    const summary = courseIds.map((id) => {
      const course = courseMap.get(id);
      const enrolled = byCourse.get(id);
      return {
        course_id: id,
        course_code: course?.course_code,
        course_name: course?.course_name,
        allocated: !!enrolled,
        professor_name: enrolled?.professor_name || null,
        sections: enrolled?.sections || [],
      };
    });

    res.json({
      status: progress?.status || "not_started",
      allocated_count: summary.filter((s) => s.allocated).length,
      not_allocated_count: summary.filter((s) => !s.allocated).length,
      courses: summary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

// ============================================================
// REVIEWS
//
// Rule: a student may review a course (for a given professor) only if
// they have a CONFIRMED enrollment with that professor whose
// Enrollment.completed_at is set. The check is enforced here on the
// server for every write — the UI hiding the form is just a courtesy.
// Reviews are shown anonymously ("verified student"), never by name.
// ============================================================
const REVIEW_MAX_LEN = 1000;

// Professors this student is allowed to review for a course.
async function getReviewableProfessors(db, studentId, courseId) {
  const [rows] = await db.query(
    `SELECT DISTINCT p.professor_id, p.name AS professor_name
     FROM Enrollment e
     JOIN CourseOffering co ON co.offering_id = e.offering_id
     JOIN Professor p ON p.professor_id = co.professor_id
     WHERE e.student_id = ? AND co.course_id = ?
       AND e.status = 'confirmed' AND e.completed_at IS NOT NULL
     ORDER BY p.name`,
    [studentId, courseId]
  );
  return rows;
}

// Validates { rating, comment } from a request body.
function parseReviewBody(body) {
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "rating must be a whole number from 1 to 5" };
  }
  let comment = body?.comment;
  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    return { error: "comment must be text" };
  }
  comment = (comment || "").trim();
  if (comment.length > REVIEW_MAX_LEN) {
    return { error: `comment must be at most ${REVIEW_MAX_LEN} characters` };
  }
  return { rating, comment: comment || null };
}

const round1 = (n) => Math.round(n * 10) / 10;

// ------------------------------------------------------------
// GET /api/reviews/courses
// Every course with its review count + average rating, and whether
// the logged-in student has completed it (`completed`).
// ------------------------------------------------------------
app.get("/api/reviews/courses", authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.student_id || null;
    const [rows] = await pool.query(
      `SELECT c.course_id, c.course_code, c.course_name, c.credits,
              COUNT(r.review_id) AS review_count,
              ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
              EXISTS (
                SELECT 1 FROM Enrollment e
                JOIN CourseOffering co ON co.offering_id = e.offering_id
                WHERE e.student_id = ? AND co.course_id = c.course_id
                  AND e.status = 'confirmed' AND e.completed_at IS NOT NULL
              ) AS completed
       FROM Course c
       LEFT JOIN Review r ON r.course_id = c.course_id
       GROUP BY c.course_id
       ORDER BY c.course_code`,
      [studentId]
    );
    res.json(
      rows.map((r) => ({
        ...r,
        avg_rating: r.avg_rating === null ? null : Number(r.avg_rating),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load courses" });
  }
});

// ------------------------------------------------------------
// GET /api/courses/:id/reviews
// Reviews + summary for one course, plus (for students) what they're
// allowed to do: which professors they can review, and why not if none.
// ------------------------------------------------------------
app.get("/api/courses/:id/reviews", authenticateToken, async (req, res) => {
  const courseId = parseInt(req.params.id, 10);
  if (!Number.isInteger(courseId)) {
    return res.status(400).json({ error: "Invalid course id" });
  }
  const studentId = req.user.student_id || null;

  try {
    const [[course]] = await pool.query(
      `SELECT course_id, course_code, course_name, credits FROM Course WHERE course_id = ?`,
      [courseId]
    );
    if (!course) return res.status(404).json({ error: "Course not found" });

    const [rows] = await pool.query(
      `SELECT r.review_id, r.student_id, r.professor_id, p.name AS professor_name,
              r.rating, r.comment, r.created_at, r.updated_at
       FROM Review r
       JOIN Professor p ON p.professor_id = r.professor_id
       WHERE r.course_id = ?
       ORDER BY r.created_at DESC
       LIMIT 500`,
      [courseId]
    );

    // Strip student_id so reviewers stay anonymous; keep only an is_mine flag.
    const reviews = rows.map(({ student_id, ...rest }) => ({
      ...rest,
      is_mine: studentId !== null && student_id === studentId,
    }));

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byProf = new Map();
    for (const r of reviews) {
      distribution[r.rating] += 1;
      if (!byProf.has(r.professor_id)) {
        byProf.set(r.professor_id, { professor_id: r.professor_id, professor_name: r.professor_name, review_count: 0, sum: 0 });
      }
      const agg = byProf.get(r.professor_id);
      agg.review_count += 1;
      agg.sum += r.rating;
    }
    const total = reviews.reduce((sum, r) => sum + r.rating, 0);

    let eligibility = null;
    if (studentId) {
      const reviewable = await getReviewableProfessors(pool, studentId, courseId);
      const mine = new Map(reviews.filter((r) => r.is_mine).map((r) => [r.professor_id, r.review_id]));

      let reason = "completed";
      if (reviewable.length === 0) {
        const [[pending]] = await pool.query(
          `SELECT 1 AS x FROM Enrollment e
           JOIN CourseOffering co ON co.offering_id = e.offering_id
           WHERE e.student_id = ? AND co.course_id = ?
             AND e.status = 'confirmed' AND e.completed_at IS NULL
           LIMIT 1`,
          [studentId, courseId]
        );
        reason = pending ? "in_progress" : "not_enrolled";
      }

      eligibility = {
        can_review: reviewable.length > 0,
        reason,
        reviewable: reviewable.map((p) => ({ ...p, my_review_id: mine.get(p.professor_id) || null })),
      };
    }

    res.json({
      course,
      summary: {
        review_count: reviews.length,
        avg_rating: reviews.length ? round1(total / reviews.length) : null,
        distribution,
        professors: [...byProf.values()]
          .map(({ sum, ...p }) => ({ ...p, avg_rating: round1(sum / p.review_count) }))
          .sort((a, b) => a.professor_name.localeCompare(b.professor_name)),
      },
      reviews,
      eligibility,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

// ------------------------------------------------------------
// POST /api/courses/:id/reviews
// Body: { professor_id, rating, comment? }
// ------------------------------------------------------------
app.post("/api/courses/:id/reviews", authenticateToken, requireStudent, async (req, res) => {
  const courseId = parseInt(req.params.id, 10);
  const professorId = parseInt(req.body?.professor_id, 10);
  if (!Number.isInteger(courseId) || !Number.isInteger(professorId)) {
    return res.status(400).json({ error: "course id and professor_id are required" });
  }
  const parsed = parseReviewBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const studentId = req.user.student_id;
  try {
    const reviewable = await getReviewableProfessors(pool, studentId, courseId);
    if (!reviewable.some((p) => p.professor_id === professorId)) {
      return res.status(403).json({
        error: "You can only review a course and professor you have enrolled in and completed.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO Review (student_id, course_id, professor_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [studentId, courseId, professorId, parsed.rating, parsed.comment]
    );
    res.status(201).json({ review_id: result.insertId });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "You have already reviewed this professor for this course. Edit your review instead." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to post review" });
  }
});

// ------------------------------------------------------------
// PUT /api/reviews/:id — edit your own review. Body: { rating, comment? }
// ------------------------------------------------------------
app.put("/api/reviews/:id", authenticateToken, requireStudent, async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  if (!Number.isInteger(reviewId)) return res.status(400).json({ error: "Invalid review id" });
  const parsed = parseReviewBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const [result] = await pool.query(
      `UPDATE Review SET rating = ?, comment = ?, updated_at = now()
       WHERE review_id = ? AND student_id = ?`,
      [parsed.rating, parsed.comment, reviewId, req.user.student_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Review not found" });
    res.json({ review_id: reviewId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update review" });
  }
});

// ------------------------------------------------------------
// DELETE /api/reviews/:id — delete your own review (admins: any review)
// ------------------------------------------------------------
app.delete("/api/reviews/:id", authenticateToken, async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  if (!Number.isInteger(reviewId)) return res.status(400).json({ error: "Invalid review id" });

  try {
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && !req.user.student_id) {
      return res.status(403).json({ error: "Student account required" });
    }
    const [result] = isAdmin
      ? await pool.query(`DELETE FROM Review WHERE review_id = ?`, [reviewId])
      : await pool.query(`DELETE FROM Review WHERE review_id = ? AND student_id = ?`, [reviewId, req.user.student_id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Review not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

// ------------------------------------------------------------
// POST /api/admin/enrollments/complete   (admin only)
// Body: { course_id?, student_id?, all? } — marks matching confirmed
// enrollments as completed, which unlocks reviews for those students.
// At least one filter (or all: true) is required, to avoid accidents.
// ------------------------------------------------------------
app.post("/api/admin/enrollments/complete", authenticateToken, requireAdmin, async (req, res) => {
  const { course_id, student_id, all } = req.body || {};
  if (course_id == null && student_id == null && all !== true) {
    return res.status(400).json({ error: "Provide course_id and/or student_id, or all: true" });
  }

  const where = [`status = 'confirmed'`, `completed_at IS NULL`];
  const params = [];
  if (student_id != null) {
    where.push(`student_id = ?`);
    params.push(student_id);
  }
  if (course_id != null) {
    where.push(`offering_id IN (SELECT offering_id FROM CourseOffering WHERE course_id = ?)`);
    params.push(course_id);
  }

  try {
    const [result] = await pool.query(
      `UPDATE Enrollment SET completed_at = now() WHERE ${where.join(" AND ")}`,
      params
    );
    res.json({ completed: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark enrollments completed" });
  }
});

// ------------------------------------------------------------
// Add & Drop — two-phase, course-level waitlist
//
// Phase 1 — Join window (ADDDROP_START_TIME / ADDDROP_WINDOW_MINUTES):
// students join a queue for a COURSE (any professor's section is fine)
// they didn't get in FFCS. No allotment happens during this phase.
//
// Dropping a confirmed course needs no window and no queue — it's
// instant, any time, and just frees the seat.
//
// Phase 2 — Live Allotment window (ALLOT_START_TIME / ALLOT_WINDOW_MINUTES):
// the moment this window opens, every course with a queue is swept for
// already-open seats and allots them immediately. From then on, every
// drop that happens is processed live the same way. Outside this
// window, a drop still frees the seat but nobody gets allotted until
// the next time this window is open.
// ------------------------------------------------------------
const ADDDROP_START_TIME = process.env.ADDDROP_START_TIME
  ? new Date(process.env.ADDDROP_START_TIME)
  : null;
const ADDDROP_WINDOW_MINUTES = Number(process.env.ADDDROP_WINDOW_MINUTES || 30);

const ALLOT_START_TIME = process.env.ALLOT_START_TIME
  ? new Date(process.env.ALLOT_START_TIME)
  : null;
const ALLOT_WINDOW_MINUTES = Number(process.env.ALLOT_WINDOW_MINUTES || 1440);

function computeWindow(start, minutes) {
  if (!start) return { configured: false, open: false, opens_at: null, closes_at: null };
  const closesAt = new Date(start.getTime() + minutes * 60 * 1000);
  const now = new Date();
  return {
    configured: true,
    open: now >= start && now < closesAt,
    opens_at: start.toISOString(),
    closes_at: closesAt.toISOString(),
  };
}

function getJoinWindow() {
  return computeWindow(ADDDROP_START_TIME, ADDDROP_WINDOW_MINUTES);
}

function getAllotWindow() {
  return computeWindow(ALLOT_START_TIME, ALLOT_WINDOW_MINUTES);
}

// Re-numbers a course's queue to a clean 1..N sequence.
async function renumberAddDropQueue(connection, courseId) {
  const [rows] = await connection.query(
    `SELECT waitlist_id FROM Waitlist WHERE course_id = ? ORDER BY queue_position ASC`,
    [courseId]
  );
  for (let i = 0; i < rows.length; i++) {
    await connection.query(
      `UPDATE Waitlist SET queue_position = ? WHERE waitlist_id = ?`,
      [i + 1, rows[i].waitlist_id]
    );
  }
}

// Sweeps open seats across every offering of `courseId` against the
// course's queue, in position order, checking each candidate's REAL
// confirmed FFCS timetable for a clash. Only runs when the Live
// Allotment window is open — otherwise it's a no-op and seats stay
// "banked" until that window is open. If priorityOfferingId is given
// (the offering a drop just freed), that offering's unit is tried
// first, so a drop visibly hands its own seat to the next queued
// student instead of whichever offering happens to come back first
// from the DB.
//
// If the course has lab sections at all, theory and lab taught by the
// SAME professor are one "unit" — a queued student is only promoted
// when some self-clash-free theory+lab combo from one professor has a
// free seat on both sides and neither clashes with their real
// timetable, and they're enrolled into both together. A professor can
// teach more than one theory section and more than one lab section,
// so every theory×lab combo for that professor is considered (same as
// the original live-FFCS pairing), not just a single pair. This keeps
// Add/Drop from ever handing out just one half of a course.
// Returns the list of { student_id, offering_id } promotions made.
async function runCourseAllotment(connection, courseId, priorityOfferingId = null) {
  if (!getAllotWindow().open) return [];

  const [offerings] = await connection.query(
    `SELECT offering_id, professor_id, course_type, seats_remaining
     FROM CourseOffering WHERE course_id = ? AND seats_remaining > 0 FOR UPDATE`,
    [courseId]
  );
  if (offerings.length === 0) return [];

  const [typeRows] = await connection.query(
    `SELECT DISTINCT course_type FROM CourseOffering WHERE course_id = ?`,
    [courseId]
  );
  const types = new Set(typeRows.map((r) => r.course_type));
  const hasBoth = types.has("theory") && types.has("lab");

  const offeringIdsWithSeats = offerings.map((o) => o.offering_id);
  const [slotRows] = await connection.query(
    `SELECT offering_id, slot_id FROM OfferingSlot WHERE offering_id IN (${offeringIdsWithSeats
      .map(() => "?")
      .join(",")})`,
    offeringIdsWithSeats
  );
  const slotsByOffering = new Map();
  for (const row of slotRows) {
    if (!slotsByOffering.has(row.offering_id)) slotsByOffering.set(row.offering_id, new Set());
    slotsByOffering.get(row.offering_id).add(row.slot_id);
  }

  // Build allotment units: every self-clash-free {theory, lab} combo
  // per professor when the course has both, otherwise one unit per
  // individual offering.
  const units = [];
  if (hasBoth) {
    const theoryByProf = new Map();
    const labByProf = new Map();
    for (const o of offerings) {
      const bucket = o.course_type === "lab" ? labByProf : theoryByProf;
      if (!bucket.has(o.professor_id)) bucket.set(o.professor_id, []);
      bucket.get(o.professor_id).push(o);
    }
    for (const [profId, theorySections] of theoryByProf) {
      const labSections = labByProf.get(profId) || [];
      for (const t of theorySections) {
        for (const l of labSections) {
          const tSlots = slotsByOffering.get(t.offering_id) || new Set();
          const lSlots = slotsByOffering.get(l.offering_id) || new Set();
          const selfClash = [...tSlots].some((id) => lSlots.has(id));
          if (selfClash) continue;
          units.push({ offeringIds: [t.offering_id, l.offering_id] });
        }
      }
    }
  } else {
    for (const o of offerings) {
      units.push({ offeringIds: [o.offering_id] });
    }
  }
  if (units.length === 0) return [];

  if (priorityOfferingId) {
    units.sort((a, b) => {
      const aHas = a.offeringIds.includes(priorityOfferingId);
      const bHas = b.offeringIds.includes(priorityOfferingId);
      if (aHas && !bHas) return -1;
      if (bHas && !aHas) return 1;
      return 0;
    });
  }

  const [queue] = await connection.query(
    `SELECT waitlist_id, student_id FROM Waitlist WHERE course_id = ? ORDER BY queue_position ASC`,
    [courseId]
  );
  if (queue.length === 0) return [];

  const seatsRemaining = new Map(offerings.map((o) => [o.offering_id, o.seats_remaining]));
  const promotions = [];
  const promotedStudentIds = new Set();

  for (const unit of units) {
    for (const entry of queue) {
      if (promotedStudentIds.has(entry.student_id)) continue;

      const seatsOk = unit.offeringIds.every((id) => (seatsRemaining.get(id) ?? 0) > 0);
      if (!seatsOk) break; // this unit is out of seats on one side or the other -> next unit

      const placeholders = unit.offeringIds.map(() => "?").join(",");
      const [clashes] = await connection.query(
        `SELECT 1
         FROM Enrollment e
         JOIN OfferingSlot os1 ON e.offering_id = os1.offering_id
         JOIN OfferingSlot os2 ON os1.slot_id = os2.slot_id
         WHERE e.student_id = ? AND e.status = 'confirmed' AND os2.offering_id IN (${placeholders})
         LIMIT 1`,
        [entry.student_id, ...unit.offeringIds]
      );
      if (clashes.length > 0) continue; // clashes with their real timetable -> try the next person

      for (const offeringId of unit.offeringIds) {
        await connection.query(
          `UPDATE CourseOffering SET seats_remaining = seats_remaining - 1 WHERE offering_id = ?`,
          [offeringId]
        );
        // Upsert: a student who previously dropped THIS exact offering
        // already has a 'cancelled' row for (student_id, offering_id),
        // which is unique — a plain INSERT would collide with it.
        await connection.query(
          `INSERT INTO Enrollment (student_id, offering_id, status)
           VALUES (?, ?, 'confirmed')
           ON CONFLICT (student_id, offering_id)
           DO UPDATE SET status = 'confirmed', completed_at = NULL`,
          [entry.student_id, offeringId]
        );
        seatsRemaining.set(offeringId, (seatsRemaining.get(offeringId) ?? 1) - 1);
        promotions.push({ student_id: entry.student_id, offering_id: offeringId });
      }
      await connection.query(`DELETE FROM Waitlist WHERE waitlist_id = ?`, [entry.waitlist_id]);
      promotedStudentIds.add(entry.student_id);
    }
  }

  if (promotions.length > 0) {
    await renumberAddDropQueue(connection, courseId);
  }
  return promotions;
}

// Sweeps every course that currently has a non-empty queue. Used both
// right when the Live Allotment window opens and on every status
// check during it, so a seat that was already open (or freed outside
// the window) gets handed out the moment the window is live.
async function sweepAllAddDropQueues() {
  if (!getAllotWindow().open) return;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [courseRows] = await connection.query(
      `SELECT DISTINCT course_id FROM Waitlist`
    );

    const allPromotions = [];
    for (const { course_id } of courseRows) {
      const promotions = await runCourseAllotment(connection, course_id);
      allPromotions.push(...promotions);
    }

    await connection.commit();
    connection.release();

    const affectedOfferings = new Set(allPromotions.map((p) => p.offering_id));
    affectedOfferings.forEach((id) => emitSeatUpdate(id));
    allPromotions.forEach((p) =>
      io.emit("addrop:promoted", { student_id: p.student_id, offering_id: p.offering_id })
    );
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("sweepAllAddDropQueues failed:", err);
  }
}

// ------------------------------------------------------------
// GET /api/addrop/me
// ------------------------------------------------------------
app.get("/api/addrop/me", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  try {
    await sweepAllAddDropQueues();

    const [missing] = await pool.query(
      `SELECT c.course_id, c.course_code, c.course_name,
              w.waitlist_id, w.queue_position
       FROM Course c
       LEFT JOIN Waitlist w ON w.course_id = c.course_id AND w.student_id = ?
       WHERE c.course_id NOT IN (
         SELECT co.course_id FROM Enrollment e
         JOIN CourseOffering co ON e.offering_id = co.offering_id
         WHERE e.student_id = ? AND e.status = 'confirmed'
       )
       ORDER BY c.course_code`,
      [studentId, studentId]
    );

    const [enrolledRows] = await pool.query(
      `SELECT e.offering_id, c.course_id, c.course_code, c.course_name,
              p.professor_id, p.name AS professor, co.venue, co.course_type
       FROM Enrollment e
       JOIN CourseOffering co ON e.offering_id = co.offering_id
       JOIN Course c ON co.course_id = c.course_id
       JOIN Professor p ON co.professor_id = p.professor_id
       WHERE e.student_id = ? AND e.status = 'confirmed'
       ORDER BY c.course_code, co.course_type`,
      [studentId]
    );

    // Group theory + lab from the same professor into one row — they
    // drop together, so the student should see (and drop) them as one.
    const enrolledByKey = new Map();
    for (const row of enrolledRows) {
      const key = `${row.course_id}:${row.professor_id}`;
      if (!enrolledByKey.has(key)) {
        enrolledByKey.set(key, {
          offering_id: row.offering_id, // used to call the drop endpoint
          course_id: row.course_id,
          course_code: row.course_code,
          course_name: row.course_name,
          professor: row.professor,
          sections: [],
        });
      }
      enrolledByKey.get(key).sections.push({
        offering_id: row.offering_id,
        course_type: row.course_type,
        venue: row.venue,
      });
    }

    res.json({
      join_window: getJoinWindow(),
      allot_window: getAllotWindow(),
      missing: missing.map((m) => ({
        course_id: m.course_id,
        course_code: m.course_code,
        course_name: m.course_name,
        queued: m.waitlist_id != null,
        queue_position: m.queue_position,
      })),
      enrolled: Array.from(enrolledByKey.values()),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load Add & Drop status" });
  }
});

// ------------------------------------------------------------
// POST /api/addrop/queue/:courseId  — join the Add queue
// Only inside the Join window.
// ------------------------------------------------------------
app.post("/api/addrop/queue/:courseId", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const courseId = Number(req.params.courseId);

  const win = getJoinWindow();
  if (!win.open) {
    return res.status(403).json({ error: "The Be-in-queue window is not open right now.", window: win });
  }

  try {
    const [[already]] = await pool.query(
      `SELECT 1 FROM Enrollment e
       JOIN CourseOffering co ON e.offering_id = co.offering_id
       WHERE e.student_id = ? AND e.status = 'confirmed' AND co.course_id = ?`,
      [studentId, courseId]
    );
    if (already) {
      return res.status(409).json({ error: "You're already enrolled in this course." });
    }

    const [[existing]] = await pool.query(
      `SELECT waitlist_id, queue_position FROM Waitlist WHERE student_id = ? AND course_id = ?`,
      [studentId, courseId]
    );
    if (existing) {
      return res.json({ status: "already_queued", queue_position: existing.queue_position });
    }

    const [[max]] = await pool.query(
      `SELECT COALESCE(MAX(queue_position), 0) AS max_pos FROM Waitlist WHERE course_id = ?`,
      [courseId]
    );
    const position = max.max_pos + 1;

    await pool.query(
      `INSERT INTO Waitlist (student_id, course_id, queue_position) VALUES (?, ?, ?)`,
      [studentId, courseId, position]
    );

    res.json({ status: "queued", queue_position: position });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to join the queue" });
  }
});

// ------------------------------------------------------------
// DELETE /api/addrop/queue/:courseId  — leave a queue you joined
// ------------------------------------------------------------
app.delete("/api/addrop/queue/:courseId", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const courseId = Number(req.params.courseId);

  try {
    await pool.query(`DELETE FROM Waitlist WHERE student_id = ? AND course_id = ?`, [studentId, courseId]);
    await renumberAddDropQueue(pool, courseId);
    res.json({ status: "left_queue" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to leave the queue" });
  }
});

// ------------------------------------------------------------
// POST /api/addrop/drop/:offeringId  — drop a confirmed course
// Works any time, no window, no queue. Always frees the seat(s); only
// actually hands them to the next queued student if the Live Allotment
// window happens to be open right now (runCourseAllotment no-ops
// otherwise, and the seats just sit open/"banked"). Tries the unit
// just freed first, before any other already-open unit.
//
// Theory and lab taught by the SAME professor for the SAME course are
// one registration from the student's side, so dropping either one
// drops both together — never just the half that was clicked.
// ------------------------------------------------------------
app.post("/api/addrop/drop/:offeringId", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const offeringId = Number(req.params.offeringId);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[offering]] = await connection.query(
      `SELECT course_id, professor_id FROM CourseOffering WHERE offering_id = ? FOR UPDATE`,
      [offeringId]
    );
    if (!offering) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "That course offering doesn't exist." });
    }

    const [toDrop] = await connection.query(
      `SELECT e.enrollment_id, e.offering_id
       FROM Enrollment e
       JOIN CourseOffering co ON e.offering_id = co.offering_id
       WHERE e.student_id = ? AND e.status = 'confirmed'
         AND co.course_id = ? AND co.professor_id = ?
       FOR UPDATE`,
      [studentId, offering.course_id, offering.professor_id]
    );
    if (toDrop.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "You aren't confirmed in this course offering." });
    }

    for (const row of toDrop) {
      await connection.query(
        `UPDATE Enrollment SET status = 'cancelled' WHERE enrollment_id = ?`,
        [row.enrollment_id]
      );
      await connection.query(
        `UPDATE CourseOffering SET seats_remaining = seats_remaining + 1 WHERE offering_id = ?`,
        [row.offering_id]
      );
    }

    const promotions = await runCourseAllotment(connection, offering.course_id, offeringId);

    await connection.commit();
    connection.release();

    const droppedOfferingIds = toDrop.map((r) => r.offering_id);
    droppedOfferingIds.forEach((id) => emitSeatUpdate(id));
    const affectedOfferings = new Set(promotions.map((p) => p.offering_id));
    affectedOfferings.forEach((id) => emitSeatUpdate(id));
    promotions.forEach((p) =>
      io.emit("addrop:promoted", { student_id: p.student_id, offering_id: p.offering_id })
    );

    res.json({
      status: "dropped",
      dropped: droppedOfferingIds,
      promoted: promotions,
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err);
    res.status(500).json({ error: "Failed to drop this course" });
  }
});

server.listen(PORT, () => {
  console.log(`SeatSure backend running on http://localhost:${PORT}`);
});
