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
const { generateToken, authenticateToken, requireStudent } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// ------------------------------------------------------------
// Socket.IO — live seat counter
// Every client watching (whether or not they're mid-registration)
// gets a "seats:update" event whenever a seat is taken, so counts
// tick down in real time for everyone, not just the student who
// just registered.
// ------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
// RegistrationProgress.current_course_index). Options that would
// clash with an already-confirmed subject are filtered out
// automatically, exactly like the real round.
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
       ON DUPLICATE KEY UPDATE status = IF(status = 'not_started', 'in_progress', status)`,
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

    const [prefRows] = await pool.query(
      `SELECT sp.professor_id, p.name AS professor_name, sp.theory_offering_id,
              sp.lab_offering_id, sp.priority_rank
       FROM StudentPreference sp
       JOIN Professor p ON sp.professor_id = p.professor_id
       WHERE sp.student_id = ? AND sp.course_id = ? AND sp.status = 'submitted'
       ORDER BY sp.priority_rank`,
      [studentId, currentCourseId]
    );

    const options = [];
    for (const pref of prefRows) {
      const offeringIds = [pref.theory_offering_id, pref.lab_offering_id].filter(Boolean);
      if (offeringIds.length === 0) continue;

      const placeholders = offeringIds.map(() => "?").join(",");
      const [seatRows] = await pool.query(
        `SELECT co.offering_id, co.course_type, co.venue, co.seats_remaining, co.total_seats,
                s.slot_id, s.slot_code
         FROM CourseOffering co
         JOIN OfferingSlot os ON os.offering_id = co.offering_id
         JOIN Slot s ON s.slot_id = os.slot_id
         WHERE co.offering_id IN (${placeholders})`,
        offeringIds
      );

      const bySeat = new Map();
      const slotIds = new Set();
      const slotCodes = new Set();
      for (const row of seatRows) {
        slotIds.add(row.slot_id);
        slotCodes.add(row.slot_code);
        if (!bySeat.has(row.offering_id)) {
          bySeat.set(row.offering_id, {
            offering_id: row.offering_id,
            course_type: row.course_type,
            venue: row.venue,
            seats_remaining: row.seats_remaining,
            total_seats: row.total_seats,
          });
        }
      }

      // A clashing option is hidden automatically for this subject
      // onward, exactly as spec'd — not shown as an option at all.
      const clashes = [...slotIds].some((id) => lockedSlotIds.has(id));
      if (clashes) continue;

      const seats = [...bySeat.values()];
      options.push({
        priority_rank: pref.priority_rank,
        professor_id: pref.professor_id,
        professor_name: pref.professor_name,
        theory_offering_id: pref.theory_offering_id,
        lab_offering_id: pref.lab_offering_id,
        seats,
        slot_codes: [...slotCodes],
        full: seats.some((s) => s.seats_remaining <= 0),
      });
    }

    res.json({
      done: false,
      course_index: progress.current_course_index,
      total_courses: courseIds.length,
      course,
      options,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to load FFCS options" });
  }
});

// ------------------------------------------------------------
// POST /api/ffcs/confirm
// The ONE button on the live FFCS page. The client never chooses
// an offering directly — the server walks the student's priority
// list for the current subject in order, transactionally:
//   - skip a priority if it clashes with something already locked
//   - skip a priority if it's full (auto-tries the next one)
//   - lock the first one that's both clash-free and has a seat
// Then advances current_course_index (auto-advance) and broadcasts
// the new seat counts to everyone live.
// ------------------------------------------------------------
app.post("/api/ffcs/confirm", authenticateToken, requireStudent, async (req, res) => {
  const studentId = req.user.student_id;
  const connection = await pool.getConnection();

  try {
    const gate = await getTurnGate(studentId);
    if (!gate.open) {
      connection.release();
      return res.status(403).json({ error: "Your FFCS turn hasn't started yet.", unlocks_at: gate.unlocks_at });
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

    await connection.beginTransaction();

    const [prefs] = await connection.query(
      `SELECT sp.professor_id, p.name AS professor_name, sp.theory_offering_id,
              sp.lab_offering_id, sp.priority_rank
       FROM StudentPreference sp
       JOIN Professor p ON sp.professor_id = p.professor_id
       WHERE sp.student_id = ? AND sp.course_id = ? AND sp.status = 'submitted'
       ORDER BY sp.priority_rank`,
      [studentId, courseId]
    );

    const lockedSlotIds = await getLockedSlotIds(connection, studentId);

    let allocation = null;
    let touchedOfferingIds = [];

    for (const pref of prefs) {
      const offeringIds = [pref.theory_offering_id, pref.lab_offering_id].filter(Boolean);
      if (offeringIds.length === 0) continue;

      const placeholders = offeringIds.map(() => "?").join(",");

      const [slotRows] = await connection.query(
        `SELECT DISTINCT slot_id FROM OfferingSlot WHERE offering_id IN (${placeholders})`,
        offeringIds
      );
      const clashes = slotRows.some((r) => lockedSlotIds.has(r.slot_id));
      if (clashes) continue; // hidden — try next priority automatically

      // Lock every offering in this option together (theory + lab
      // must both be available, or the option doesn't count).
      const [offRows] = await connection.query(
        `SELECT offering_id, seats_remaining FROM CourseOffering WHERE offering_id IN (${placeholders}) FOR UPDATE`,
        offeringIds
      );
      const allAvailable =
        offRows.length === offeringIds.length && offRows.every((r) => r.seats_remaining > 0);
      if (!allAvailable) continue; // full — auto-tries next priority

      for (const off of offRows) {
        await connection.query(
          `UPDATE CourseOffering SET seats_remaining = seats_remaining - 1 WHERE offering_id = ?`,
          [off.offering_id]
        );
        await connection.query(
          `INSERT INTO Enrollment (student_id, offering_id, status) VALUES (?, ?, 'confirmed')`,
          [studentId, off.offering_id]
        );
      }

      touchedOfferingIds = offeringIds;
      allocation = {
        professor_id: pref.professor_id,
        professor_name: pref.professor_name,
        priority_rank: pref.priority_rank,
        offering_ids: offeringIds,
      };
      break;
    }

    const nextIndex = progress.current_course_index + 1;
    const nextStatus = nextIndex >= courseIds.length ? "completed" : "in_progress";

    await connection.query(
      `UPDATE RegistrationProgress SET current_course_index = ?, status = ? WHERE student_id = ?`,
      [nextIndex, nextStatus, studentId]
    );

    await connection.commit();
    connection.release();

    touchedOfferingIds.forEach((id) => emitSeatUpdate(id));

    const [[course]] = await pool.query(
      `SELECT course_id, course_code, course_name FROM Course WHERE course_id = ?`,
      [courseId]
    );

    res.json({
      done: nextIndex >= courseIds.length,
      course,
      allocated: !!allocation,
      allocation,
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err);
    res.status(500).json({ error: "Failed to confirm registration" });
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
              GROUP_CONCAT(DISTINCT s.slot_code SEPARATOR '+') AS slot_codes
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

server.listen(PORT, () => {
  console.log(`SeatSure backend running on http://localhost:${PORT}`);
  console.log(
    `FFCS clock: turn 1 opens now, +${TURN_GAP_SECONDS}s per registration_order after that.`
  );
});