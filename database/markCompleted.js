// ============================================================
// SeatSure - Mark enrollments as completed (unlocks course reviews)
//
// There's no real semester lifecycle in the simulator, so this is how
// you "finish" a course for testing / demos. Only CONFIRMED enrollments
// are affected.
//
//   node database/markCompleted.js --all
//   node database/markCompleted.js --course CSE1001
//   node database/markCompleted.js --reg 21BCE0001
//   node database/markCompleted.js --course CSE1001 --reg 21BCE0001
//   node database/markCompleted.js --undo --all     # re-lock reviews
// ============================================================
const pool = require("../backend/db");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const course = arg("course");
  const reg = arg("reg");
  const undo = has("undo");

  if (!course && !reg && !has("all")) {
    console.error("Usage: node database/markCompleted.js [--undo] (--all | --course CODE | --reg REGNO)");
    process.exit(1);
  }

  const where = [`status = 'confirmed'`];
  const params = [];
  if (reg) {
    where.push(`student_id = (SELECT student_id FROM Student WHERE reg_no = ?)`);
    params.push(reg);
  }
  if (course) {
    where.push(
      `offering_id IN (SELECT co.offering_id FROM CourseOffering co JOIN Course c ON c.course_id = co.course_id WHERE c.course_code = ?)`
    );
    params.push(course);
  }

  const [result] = await pool.query(
    `UPDATE Enrollment SET completed_at = ${undo ? "NULL" : "COALESCE(completed_at, now())"} WHERE ${where.join(" AND ")}`,
    params
  );
  console.log(`${undo ? "Re-opened" : "Marked completed"}: ${result.affectedRows} enrollment(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
