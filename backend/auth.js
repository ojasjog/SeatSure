// ============================================================
// SeatSure Backend - Auth helpers
// JWT-based session auth for the Student login/signup flow.
// ============================================================
const jwt = require("jsonwebtoken");

// Falls back to a dev-only secret so the app still boots without
// a .env file, but logs a loud warning so nobody ships that to prod.
const JWT_SECRET = process.env.JWT_SECRET || "seatsure-dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] WARNING: JWT_SECRET is not set in the environment. " +
      "Using an insecure default — set JWT_SECRET in backend/.env before deploying."
  );
}

const TOKEN_EXPIRY = "7d";

// Issue a signed token carrying just enough to identify the user
// and (for students) their student_id, so routes never have to
// trust a client-supplied student_id again.
function generateToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      role: user.role,
      student_id: user.student_id ?? null,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// Express middleware: requires "Authorization: Bearer <token>",
// verifies it, and attaches the decoded payload as req.user.
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.user = payload;
    next();
  });
}

// Extra guard for routes that only make sense for students
// (e.g. registering for a seat).
function requireStudent(req, res, next) {
  if (!req.user || req.user.role !== "student" || !req.user.student_id) {
    return res.status(403).json({ error: "Student account required" });
  }
  next();
}

module.exports = { generateToken, authenticateToken, requireStudent, JWT_SECRET };
