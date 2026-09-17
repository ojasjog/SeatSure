// ============================================================
// SeatSure - Database Seed Script (v2: atomic slots)
//
// Combined slot codes like "A2+TA2" are split into their atomic
// components ("A2", "TA2"), each stored once in Slot, with all
// their real day/time occurrences in SlotSchedule. A CourseOffering
// links to its atomic slots via the OfferingSlot junction table.
// This makes clash detection accurate: two offerings clash if they
// share ANY atomic slot_id.
// ============================================================
require("dotenv").config();
const mysql = require("mysql2/promise");
const {
  DAY_THEORY,
  DAY_LAB,
  THEORY_COL_TIMES,
  LAB_COL_TIMES,
  COURSES,
} = require("./seedData");

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Build a map: slot_code -> [{ day, start, end }, ...]
// (a slot code can legitimately occur on more than one day/time)
function buildScheduleMap() {
  const map = {};

  function addOccurrence(code, day, timing) {
    if (!code || !timing) return;
    if (!map[code]) map[code] = [];
    map[code].push({ day, start: timing.start, end: timing.end });
  }

  DAYS.forEach((day) => {
    DAY_THEORY[day].forEach((code, colIndex) => {
      addOccurrence(code, day, THEORY_COL_TIMES[colIndex]);
    });
    DAY_LAB[day].forEach((code, colIndex) => {
      addOccurrence(code, day, LAB_COL_TIMES[colIndex]);
    });
  });

  return map;
}

function toMySQLTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

// Split a combined slot string like "A2+TA2" or "L3+L4+L21+L22"
// into its individual atomic components.
function splitSlotCode(slotStr) {
  return slotStr.split("+").map((s) => s.trim());
}

async function seed() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: process.env.DB_USER, // set your MySQL username here if any
    password: process.env.DB_PASSWORD, // set your MySQL password here if any
    database: "seatsure",
    multipleStatements: true,
  });

  console.log("Connected to MySQL. Starting seed (v2: atomic slots)...");

  const scheduleMap = buildScheduleMap();

  const professorCache = new Map(); // name -> professor_id
  const slotCache = new Map(); // atomic slot_code -> slot_id
  const courseCache = new Map(); // course_code -> course_id

  // ---- Helper: get or create an atomic Slot row + its schedule ----
  async function getOrCreateSlot(atomicCode) {
    if (slotCache.has(atomicCode)) return slotCache.get(atomicCode);

    const slotType = atomicCode.startsWith("L") ? "lab" : "theory";

    const [result] = await connection.execute(
      `INSERT INTO Slot (slot_code, slot_type)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE slot_id = LAST_INSERT_ID(slot_id)`,
      [atomicCode, slotType]
    );
    const slotId = result.insertId;
    slotCache.set(atomicCode, slotId);

    // Insert every real day/time occurrence for this slot code
    const occurrences = scheduleMap[atomicCode] || [];
    for (const occ of occurrences) {
      await connection.execute(
        `INSERT IGNORE INTO SlotSchedule (slot_id, day_of_week, start_time, end_time)
         VALUES (?, ?, ?, ?)`,
        [slotId, occ.day, toMySQLTime(occ.start), toMySQLTime(occ.end)]
      );
    }

    return slotId;
  }

  try {
    for (const courseKey of Object.keys(COURSES)) {
      const course = COURSES[courseKey];

      // ---- Course ----
      let courseId = courseCache.get(course.code);
      if (!courseId) {
        const [result] = await connection.execute(
          `INSERT INTO Course (course_code, course_name, credits) VALUES (?, ?, ?)`,
          [course.code, course.name, course.credits]
        );
        courseId = result.insertId;
        courseCache.set(course.code, courseId);
        console.log(`Inserted course: ${course.code} - ${course.name}`);
      }

      const allOfferings = [
        ...course.theory.map((o) => ({ ...o, type: "theory" })),
        ...course.lab.map((o) => ({ ...o, type: "lab" })),
      ];

      for (const offering of allOfferings) {
        // ---- Professor ----
        let professorId = professorCache.get(offering.f);
        if (!professorId) {
          const [profResult] = await connection.execute(
            `INSERT INTO Professor (name, department)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE professor_id = LAST_INSERT_ID(professor_id)`,
            [offering.f, "SCOPE"]
          );
          professorId = profResult.insertId;
          professorCache.set(offering.f, professorId);
        }

        // ---- CourseOffering (no slot_id here anymore) ----
        const totalSeats = 60;
        const [offeringResult] = await connection.execute(
          `INSERT INTO CourseOffering
             (course_id, professor_id, venue, course_type, total_seats, seats_remaining)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [courseId, professorId, offering.venue, offering.type, totalSeats, totalSeats]
        );
        const offeringId = offeringResult.insertId;

        // ---- Split combined slot code into atomic slots, link via junction ----
        const atomicCodes = splitSlotCode(offering.slot);
        for (const atomicCode of atomicCodes) {
          const slotId = await getOrCreateSlot(atomicCode);
          await connection.execute(
            `INSERT IGNORE INTO OfferingSlot (offering_id, slot_id) VALUES (?, ?)`,
            [offeringId, slotId]
          );
        }
      }

      console.log(`  -> ${allOfferings.length} offerings inserted for ${course.code}`);
    }

    console.log("\nSeeding complete.");
    console.log(`Total professors: ${professorCache.size}`);
    console.log(`Total atomic slots: ${slotCache.size}`);
    console.log(`Total courses: ${courseCache.size}`);
  } catch (err) {
    console.error("Seed error:", err);
  } finally {
    await connection.end();
  }
}

seed();
