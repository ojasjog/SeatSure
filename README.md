# SeatSure

**SeatSure** is a full-stack course-registration simulator modeled on VIT Vellore's FFCS (Fully Flexible Credit System). It lets a student rank professors/sections by priority, generates clash-free timetable options from those priorities, and then runs a **live, turn-based registration round** — complete with real-time seat counts, automatic clash/seat-availability skipping, and a waitlist fallback — much like the real FFCS registration day.

---

## Current Status

This is an active, in-progress course project. The **Pre-FFCS preference flow** and the **live FFCS registration round** are fully built and wired end-to-end (frontend ↔ backend ↔ MySQL, with Socket.IO for live updates). The **Waitlist page is a placeholder** — a stub screen exists so the three-stage flow is visible, but it isn't connected to the backend `Waitlist` logic yet.

| Stage | Status |
|---|---|
| Auth (signup/login, JWT) | ✅ Working |
| Course & professor/section browsing | ✅ Working |
| Priority ranking + save/submit | ✅ Working |
| Clash-free timetable generation (backtracking) | ✅ Working |
| Live FFCS round (turn clock, auto seat lock, real-time updates) | ✅ Working |
| FFCS summary screen | ✅ Working |
| Waitlist page | 🚧 Stub only — not wired to the backend |
| Reviews table (`Review`) | 🗄️ Schema exists, no API/UI yet |

---

## How It Works

SeatSure splits registration into three stages (mirroring real FFCS):

1. **Pre-FFCS (Preferences)** — The student browses courses, and for each one ranks professors/sections in priority order. Preferences can be saved as a draft and edited, or **submitted** to lock them in for the live round. A clash-free timetable can also be generated ahead of time from the saved priorities, using a backtracking search over each course's ranked professor choices.
2. **FFCS (Live Round)** — Each student is assigned a `registration_order` (their FFCS turn number) at signup. A server-side clock (`FFCS_START_TIME` + `TURN_GAP_SECONDS` per turn) gates when a student's round opens — exactly like VIT's staggered, seniority-based release. Once open, the student is walked through their submitted courses **one at a time**: for each course, the server tries their ranked priorities in order, automatically skipping any option that clashes with an already-locked slot or has no seats left, and locks the first one that's both clash-free and available. Seat counts update for everyone in real time via Socket.IO.
3. **Waitlist** — Intended to show queue position for any offering that was full during registration. The `Waitlist` table and the `/api/register` waitlist-insert logic exist on the backend, but the frontend page is currently a stub.

---

## Tech Stack

- **Frontend:** React 19 (Create React App), `axios`, `socket.io-client`, `html2canvas` (for exporting the timetable)
- **Backend:** Node.js, Express 5, `jsonwebtoken` (JWT auth), `bcryptjs` (password hashing), `socket.io` (live seat updates)
- **Database:** MySQL (via `mysql2/promise`)
- **Tooling:** `dotenv`, `concurrently` (run both servers with one command)

---

## Project Structure

```
SeatSure/
├── backend/
│   ├── index.js        # Express app: auth, courses, preferences, timetable, live FFCS engine, Socket.IO
│   ├── auth.js          # JWT issuing + authenticateToken/requireStudent middleware
│   ├── db.js             # MySQL connection pool
│   └── package.json
├── database/
│   ├── schema.sql                     # Full table definitions (13 tables)
│   ├── seed.js / seedData.js          # Sample courses, professors, offerings, slots
│   ├── resetSimulation.js             # Resets enrollments/progress to re-run the live round
│   └── backfill_registration_order.sql
├── frontend/
│   └── src/
│       ├── App.js                     # Top-level flow/state, timetable export
│       ├── api.js                     # Axios client for all backend endpoints
│       └── components/
│           ├── Login.js               # Sign-in / sign-up
│           ├── Landing.js             # Post-login hub (Pre-FFCS / FFCS / Waitlist)
│           ├── CourseCard.js          # Per-course professor priority ranking UI
│           ├── TimetableGrid.js       # Weekly grid renderer for generated timetables
│           ├── FFCSPage.js            # Live FFCS round UI (turn clock, seat bars, confirm button)
│           └── Waitlist.js            # Placeholder / stub page
├── package.json                       # Root script: `npm run dev` (runs backend + frontend together)
└── .gitignore
```

---

## Database Schema

13 tables, normalized to avoid repeating-group slot codes (a `SlotSchedule` table lets one slot code occur on multiple day/time pairs per week):

`User`, `Student`, `Professor`, `Course`, `Slot`, `SlotSchedule`, `CourseOffering`, `OfferingSlot` (M:N junction between offerings and atomic slots), `StudentPreference`, `Enrollment`, `Waitlist`, `Review`, `RegistrationProgress`.

Key design points:
- A combined slot code like `A2+TA2` is stored as **two** `Slot` rows linked to one `CourseOffering` via `OfferingSlot`, so clash detection is a simple shared-slot-id check.
- `StudentPreference` stores the **exact** `theory_offering_id` / `lab_offering_id` a student picked per priority rank, not just a professor — so the live round and the timetable generator select the identical section the student ranked.
- `CourseOffering.seats_remaining` is protected by a `CHECK` constraint and updated inside `SELECT ... FOR UPDATE` transactions, so concurrent registrations can't oversell a seat.
- `RegistrationProgress` tracks each student's position in their live FFCS round (which course index they're on, and whether they're done).

---

## Getting Started

### Prerequisites
- Node.js
- MySQL server running locally

### 1. Database
```bash
mysql -u root -p < database/schema.sql
node database/seed.js        # or seedData.js — loads sample courses/professors/offerings
```

### 2. Backend
Create `backend/.env`:
```
DB_USER=root
DB_PASSWORD=your_mysql_password
JWT_SECRET=some-long-random-string
FFCS_START_TIME=            # optional, defaults to server start time
FFCS_TURN_GAP_SECONDS=10    # optional, seconds between each student's turn
```
```bash
cd backend
npm install
npm start          # runs on http://localhost:5000
```

### 3. Frontend
```bash
cd frontend
npm install
npm start           # runs on http://localhost:3000
```

### Or run both at once
From the repo root:
```bash
npm install
npm run dev
```

---

## API Overview

| Method & Path | Purpose |
|---|---|
| `POST /api/auth/signup` | Create account, assigns next FFCS `registration_order` |
| `POST /api/auth/login` | Login, returns JWT |
| `GET /api/auth/me` | Current student's profile |
| `GET /api/courses` | List all courses |
| `GET /api/offerings/:courseId` | Offerings (professor, venue, seats) for a course |
| `GET /api/courses/:id/professors` | Professors + offerings for a course, for the ranking UI |
| `POST /api/preferences` | Save priority rankings as a draft |
| `POST /api/preferences/submit` | Lock saved preferences in for the live round |
| `GET /api/preferences/me` / `:studentId` | Fetch saved preferences |
| `GET /api/timetable/:studentId` | Generate clash-free timetable options (backtracking) |
| `POST /api/register` | Direct registration with slot-clash check + waitlist fallback |
| `GET /api/ffcs/session` | Whether this student's FFCS turn has opened yet |
| `GET /api/ffcs/options` | Current course's options in the live round (clash/full pre-filtered) |
| `POST /api/ffcs/confirm` | Auto-allocate the current course from ranked priorities, advance to the next |
| `GET /api/ffcs/summary` | Final allocated/not-allocated summary |

Live seat counts are also pushed to all connected clients via the `seats:update` Socket.IO event whenever an offering's `seats_remaining` changes.

---

## Known Gaps / Next Steps

- Wire up the **Waitlist** page to the existing `Waitlist` table and `/api/register` waitlist path.
- No API/UI yet for the `Review` table (post-enrollment course ratings).
- No admin role/UI — `User.role` supports `'admin'` in the schema but nothing currently uses it.
- No automated tests yet (`npm test` is unset up in both `backend` and root `package.json`).