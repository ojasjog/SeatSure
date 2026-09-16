// ============================================================
// SeatSure - Database Seed Script
// Reads seedData.js (real VIT course/slot/faculty data) and
// inserts it into MySQL via mysql2.
//
// This script demonstrates:
//  - Phase 6 (DML): structured, programmatic data population
//  - Phase 9 (Database Connectivity): Node.js <-> MySQL via mysql2
// ============================================================

const mysql = require("mysql2/promise");
const { GRID_COLS, DAY_THEORY, COURSES } = require("./seedData");

// ------------------------------------------------------------
// Derive day + start/end time for every theory slot code from
// the grid definition (GRID_COLS + DAY_THEORY). Lab slot codes
// (e.g. "L3+L4") are approximated using the lab column times,
// since exact lab day mapping isn't required for this project's
// clash-detection scope.
// ------------------------------------------------------------
function buildSlotTimeMap() {
  const map = {}; // slotCode -> { days: Set, start, end }

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  DAYS.forEach((day) => {
    DAY_THEORY[day].forEach((slotCode, colIndex) => {
      if (!slotCode) return;
      const col = GRID_COLS[colIndex];
      if (!map[slotCode]) map[slotCode] = { days: new Set(), start: col.time };
      map[slotCode].days.add(day);
    });
  });

  return map;
}

// Convert "8:00" / "14:00" style time strings to MySQL TIME format
function toMySQLTime(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

// For a given slot string like "A1+TA1" or "L3+L4", extract the
// FIRST component's day/time info if available. If not found in
// the theory grid (e.g. pure lab codes), fall back to a generic
// placeholder time — still unique enough for clash detection by
// slot_code identity, which is this project's agreed approach.
function resolveSlotTiming(slotCode, slotTimeMap) {
  const parts = slotCode.split("+");
  for (const part of parts) {
    if (slotTimeMap[part]) {
      const info = slotTimeMap[part];
      const days = Array.from(info.days).join(",");
      const start = toMySQLTime(info.start);
      // default 1-hour block for theory, 2-hour for lab pairs
      const isLab = slotCode.startsWith("L");
      const durationHours = isLab ? 2 : 1;
      const [h, m] = start.split(":").map(Number);
      const endH = (h + durationHours) % 24;
      const end = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
      return { days, start, end };
    }
  }
  // fallback if no match found in grid
  return { days: "Mon", start: "08:00:00", end: "09:00:00" };
}

async function seed() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root", // change if using a different MySQL user
    password: "", // set your MySQL password here if any
    database: "seatsure",
    multipleStatements: true,
  });

  console.log("Connected to MySQL. Starting seed...");

  const slotTimeMap = buildSlotTimeMap();

  // Caches to avoid duplicate inserts
  const professorCache = new Map(); // name -> professor_id
  const slotCache = new Map(); // slot_code -> slot_id
  const courseCache = new Map(); // course_code -> course_id

  try {
    for (const courseKey of Object.keys(COURSES)) {
      const course = COURSES[courseKey];

      // ---- Insert Course ----
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

      // ---- Insert offerings (theory + lab) ----
      const allOfferings = [
        ...course.theory.map((o) => ({ ...o, type: "theory" })),
        ...course.lab.map((o) => ({ ...o, type: "lab" })),
      ];

      for (const offering of allOfferings) {
        // Professor
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

        // Slot
        let slotId = slotCache.get(offering.slot);
        if (!slotId) {
          const timing = resolveSlotTiming(offering.slot, slotTimeMap);
          const [slotResult] = await connection.execute(
            `INSERT INTO Slot (slot_code, day_pattern, start_time, end_time)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE slot_id = LAST_INSERT_ID(slot_id)`,
            [offering.slot, timing.days, timing.start, timing.end]
          );
          slotId = slotResult.insertId;
          slotCache.set(offering.slot, slotId);
        }

        // CourseOffering
        const totalSeats = 60; // reasonable sample capacity
        await connection.execute(
          `INSERT INTO CourseOffering
             (course_id, professor_id, slot_id, venue, course_type, total_seats, seats_remaining)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [courseId, professorId, slotId, offering.venue, offering.type, totalSeats, totalSeats]
        );
      }

      console.log(`  -> ${allOfferings.length} offerings inserted for ${course.code}`);
    }

    console.log("\nSeeding complete.");
    console.log(`Total professors: ${professorCache.size}`);
    console.log(`Total unique slots: ${slotCache.size}`);
    console.log(`Total courses: ${courseCache.size}`);
  } catch (err) {
    console.error("Seed error:", err);
  } finally {
    await connection.end();
  }
}

seed();
