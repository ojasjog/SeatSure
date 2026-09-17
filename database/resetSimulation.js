// ============================================================
// SeatSure - Reset FFCS Simulation
//
// Resets everything needed to re-run a live FFCS simulation from
// scratch, WITHOUT touching:
//   - Course, Professor, Slot, CourseOffering (base seeded data)
//   - StudentPreference (everyone's submitted pre-FFCS priorities)
//   - User, Student accounts
//
// Resets:
//   - Enrollment (all cleared)
//   - Waitlist (all cleared)
//   - CourseOffering.seats_remaining -> back to total_seats
//   - RegistrationProgress -> back to 'not_started' for everyone
//
// Run with: node database/resetSimulation.js
// ============================================================

const mysql = require("mysql2/promise");

async function resetSimulation() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "", // match your backend/db.js password
    database: "seatsure",
  });

  console.log("Resetting FFCS simulation state...");

  try {
    await connection.beginTransaction();

    const [enrollmentResult] = await connection.query(`DELETE FROM Enrollment`);
    console.log(`Cleared ${enrollmentResult.affectedRows} enrollment(s).`);

    const [waitlistResult] = await connection.query(`DELETE FROM Waitlist`);
    console.log(`Cleared ${waitlistResult.affectedRows} waitlist entr(ies).`);

    const [seatResult] = await connection.query(
      `UPDATE CourseOffering SET seats_remaining = total_seats`
    );
    console.log(`Restored seats on ${seatResult.affectedRows} offering(s).`);

    const [progressResult] = await connection.query(
      `UPDATE RegistrationProgress SET current_course_index = 0, status = 'not_started'`
    );
    console.log(`Reset registration progress for ${progressResult.affectedRows} student(s).`);

    await connection.commit();
    console.log("\nSimulation reset complete. Course data and submitted priorities were left untouched.");
  } catch (err) {
    await connection.rollback();
    console.error("Reset failed:", err);
  } finally {
    await connection.end();
  }
}

resetSimulation();
