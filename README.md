# SeatSure

**SeatSure** is a full-stack course-registration simulator modeled on VIT Vellore's FFCS (Fully Flexible Credit System). Students rank professors/sections by priority, generate clash-free timetable options, take part in a **live, turn-based registration round** with real-time seat counts, then use **Add & Drop** to queue for courses they missed. Students who have completed a course can leave verified reviews.

> **Note:** SeatSure follows real FFCS for the core flow, but deliberately departs from it in two places (the Add & Drop queue and in-app reviews). See [Where SeatSure Differs From Real FFCS](#where-seatsure-differs-from-real-ffcs).

---

## Current Status

Active course project. All four stages below are built and wired end-to-end (React frontend ↔ Express backend ↔ PostgreSQL/Supabase, with Socket.IO for live updates).

| Stage | Status |
|---|---|
| Auth (signup/login, JWT, student + admin roles) | ✅ Working |
| Course & professor/section browsing | ✅ Working |
| Priority ranking + save/submit | ✅ Working |
| Clash-free timetable generation (backtracking) + PNG export | ✅ Working |
| Live FFCS round (turn clock, faculty pick, skip, real-time seats) | ✅ Working |
| FFCS summary screen | ✅ Working |
| Add & Drop (fair course queue, instant drop, live allotment) | ✅ Working |
| Credit-limit enforcement (27.5 / semester) | ❌ Not implemented |
| Course reviews (verified, completed-course students only) | ✅ Working |
| Day / night theme | ✅ Working |
| Automated tests | ❌ None yet |

---

## How It Works

1. **Pre-FFCS (Preferences)** — The student browses courses and ranks professors/sections per course. Preferences can be saved as a draft or **submitted** to lock them in. A clash-free timetable can be generated from the saved priorities using a backtracking search, and exported as an image.
2. **FFCS (Live Round)** — Each student gets a `registration_order` (turn number) at signup. A server clock (`FFCS_START_TIME` + `FFCS_TURN_GAP_SECONDS` per turn) gates when each student's round opens, like VIT's staggered release. Once open, the student goes through their submitted courses **one subject at a time**: they pick one faculty member and confirm. The server locks every offering for that professor (theory + lab) if it is clash-free and has seats; a rejected pick does not advance, so the student can choose someone else. A subject can also be **skipped** (marked not allocated). Seat counts update for everyone via Socket.IO.
3. **Add & Drop** — A fairness-oriented alternative to real FFCS's first-come drop rush. Two scheduled windows:
   - **Join window** (`ADDDROP_START_TIME` + `ADDDROP_WINDOW_MINUTES`): students join a queue for a *course* (any non-clashing section is acceptable). No allotment happens yet.
   - **Live allotment window** (`ALLOT_START_TIME` + `ALLOT_WINDOW_MINUTES`): when it opens, every queued course is swept for open seats and allotted immediately, in queue order; afterwards each drop is processed live. Candidates whose confirmed timetable would clash are skipped. A seat freed by a drop is offered first to the next student in that course's queue, so nobody has to be online at the right second. Dropping a confirmed course works at any time and just frees the seat.
4. **Reviews** — See [Course Reviews](#course-reviews).

---

## Where SeatSure Differs From Real FFCS

| Area | Real VIT FFCS | SeatSure |
|---|---|---|
| Add & Drop | No queue or waitlist. When someone drops a course, whoever is online first grabs the seat. | A per-course queue (ordered by join time). Freed seats go to the next eligible student automatically, so being online at the right moment doesn't matter. This is intentional: it's fairer than a first-come race. |
| Reviews | None official. Opinions are scattered across the internet and unverified. | An in-app reviews page where only students who completed a course can post. This is an extension beyond FFCS. |
| Credit limit | 27.5 credits per semester, excluding NPTEL credit transfers. | Not enforced yet (see Known Gaps). |

---

## Tech Stack

- **Frontend:** React 19 (Create React App), `axios`, `socket.io-client`, `html2canvas`, Bricolage Grotesque / Instrument Sans (`@fontsource-variable`)
- **Backend:** Node.js, Express 5, `jsonwebtoken`, `bcryptjs`, `socket.io`, `cors`, `dotenv`
- **Database:** PostgreSQL, designed for Supabase (via `pg`; `backend/db.js` is a thin wrapper that keeps the original `mysql2`-style `?` placeholders and `getConnection()`/transaction API)

---

## Project Structure

```
SeatSure/
├── backend/
│   ├── index.js        # Express app: auth, courses, preferences, timetable, FFCS engine, Add & Drop, reviews, admin, Socket.IO
│   ├── auth.js         # JWT issuing + authenticateToken / requireStudent / requireAdmin
│   ├── db.js           # PostgreSQL pool + mysql2-style wrapper
│   └── package.json
├── database/
│   ├── schema.pg.sql                  # PostgreSQL / Supabase schema (13 tables)
│   ├── schema.sql                     # Original MySQL schema (legacy)
│   ├── migrations/
│   │   ├── 002_reviews.sql            # Enrollment.completed_at, rebuilt Review table
│   │   └── 003_addrop.sql             # Course-level Waitlist queue for Add & Drop
│   ├── seed.js / seedData.js          # Sample courses, professors, offerings, slots
│   ├── resetSimulation.js             # Clears enrollments/waitlist/progress to re-run the round
│   ├── markCompleted.js               # Marks enrollments completed (unlocks reviews)
│   └── backfill_registration_order(.pg).sql
├── frontend/
│   └── src/
│       ├── App.js, api.js, theme.css
│       └── components/
│           ├── Login.js, Landing.js, CourseCard.js
│           ├── TimetableGrid.js       # Weekly grid for generated timetables
│           ├── FFCSPage.js            # Live round UI
│           ├── Waitlist.js            # Add & Drop UI (queues, drops, window status)
│           ├── ReviewsPage.js         # Browse / post / edit / delete reviews
│           └── ThemeToggle.js         # Day / night switch
├── package.json                       # Root script: `npm run dev` (backend + frontend)
└── .gitignore
```

---

## Database Schema

13 tables: `User`, `Student`, `Professor`, `Course`, `Slot`, `SlotSchedule`, `CourseOffering`, `OfferingSlot`, `StudentPreference`, `Enrollment`, `Waitlist`, `Review`, `RegistrationProgress`.

- A combined slot code like `A2+TA2` is stored as **two** `Slot` rows linked to one offering via `OfferingSlot`, so clash detection is a shared-slot-id check.
- `StudentPreference` stores the exact theory/lab offering picked per priority rank.
- `CourseOffering.seats_remaining` has a `CHECK` constraint and is updated inside row-locking transactions, so concurrent registrations can't oversell a seat.
- `RegistrationProgress` tracks each student's position in the live round.
- `Waitlist` is keyed by **course** (one entry per student per course) for Add & Drop.
- `Enrollment.completed_at` marks a finished course and gates reviews.

---

## Getting Started

### Prerequisites
- Node.js
- A PostgreSQL database (a free [Supabase](https://supabase.com) project works; use the **Session pooler** connection string)

### 1. Database
Run `database/schema.pg.sql` once in the Supabase SQL Editor (or with `psql`). It does not drop tables. Then:
```bash
node database/seed.js        # loads sample courses/professors/offerings (data in seedData.js)
```
If you created your database from an older schema, also run `database/migrations/002_reviews.sql` and `003_addrop.sql` once each.

### 2. Backend
Create `backend/.env` (never commit it):
```
DATABASE_URL=postgresql://...        # Supabase Session pooler string
# DATABASE_SSL=false                 # only for a local Postgres without SSL
JWT_SECRET=some-long-random-string
# CORS_ORIGIN=http://localhost:3000  # optional; defaults to allow all
# PORT=5000                          # optional

FFCS_START_TIME=                     # optional, ISO time; defaults to server start
FFCS_TURN_GAP_SECONDS=10             # seconds between each student's turn

ADDDROP_START_TIME=                  # optional; Add & Drop join window start
ADDDROP_WINDOW_MINUTES=30
ALLOT_START_TIME=                    # optional; live allotment window start
ALLOT_WINDOW_MINUTES=1440
```
```bash
cd backend
npm install
npm start          # http://localhost:5000
```

### 3. Frontend
```bash
cd frontend
npm install
npm start          # http://localhost:3000
```
Set `REACT_APP_API_URL` if the backend isn't on `http://localhost:5000`.

### Or run both at once
From the repo root: `npm install && npm run dev`.

To re-run the live round from scratch: `node database/resetSimulation.js`.

---

## API Overview

**Auth & data**

| Method & Path | Purpose |
|---|---|
| `POST /api/auth/signup` / `login` | Create account (assigns next `registration_order`) / get JWT |
| `GET /api/auth/me` | Current profile |
| `GET /api/courses` | List courses |
| `GET /api/offerings/:courseId` | Offerings (professor, venue, seats) |
| `GET /api/courses/:id/professors` | Professors + offerings for the ranking UI |

**Preferences & timetable**

| Method & Path | Purpose |
|---|---|
| `POST /api/preferences` | Save priority rankings (draft) |
| `POST /api/preferences/submit` | Lock preferences for the live round |
| `GET /api/preferences/me` / `:studentId` | Fetch saved preferences |
| `GET /api/timetable/:studentId` | Generate clash-free timetable options |
| `POST /api/register` | Direct registration with slot-clash check |

**Live FFCS**

| Method & Path | Purpose |
|---|---|
| `GET /api/ffcs/session` | Whether this student's turn has opened |
| `GET /api/ffcs/options` | Current subject's faculty options (clash/full flagged) |
| `POST /api/ffcs/confirm` | Lock the chosen `professor_id` and advance |
| `POST /api/ffcs/skip` | Mark the current subject not allocated and advance |
| `GET /api/ffcs/summary` | Final allocated / not-allocated summary |

**Add & Drop**

| Method & Path | Purpose |
|---|---|
| `GET /api/addrop/me` | Window status, queues and confirmed courses |
| `POST /api/addrop/queue/:courseId` | Join a course queue |
| `DELETE /api/addrop/queue/:courseId` | Leave a course queue |
| `POST /api/addrop/drop/:offeringId` | Drop a confirmed course (frees seat, promotes queue) |

**Reviews & admin**

| Method & Path | Purpose |
|---|---|
| `GET /api/reviews/courses` | Courses with review count, average rating, `completed` flag |
| `GET /api/courses/:id/reviews` | Reviews for a course |
| `POST /api/courses/:id/reviews` | Post a review (completed students only) |
| `PUT` / `DELETE /api/reviews/:id` | Edit / delete own review (admin may delete) |
| `POST /api/admin/enrollments/complete` | Admin: mark enrollments completed (`course_id`, `student_id` or `all: true`) |

Socket.IO events: `seats:update` (an offering's seats changed) and `addrop:promoted` (a queued student was allotted a seat).

---

## Course Reviews

Only students who enrolled in *and completed* a course can post. Eligibility is checked on the server: the student needs a `confirmed` enrollment (with that professor) whose `Enrollment.completed_at` is set. Everyone can read reviews; reviewers appear as "Verified student". One review per student per course per professor, editable and deletable by its author.

The simulator has no real semester lifecycle, so completion is set manually, either with the admin endpoint above or the script:

```bash
node database/markCompleted.js --all                       # finish everything
node database/markCompleted.js --course CSE1001            # one course
node database/markCompleted.js --reg 21BCE0001             # one student
node database/markCompleted.js --undo --all                # re-lock reviews
```

---

## Known Gaps / Next Steps

- **Credit limit not enforced.** Real FFCS caps a semester at 27.5 credits (NPTEL credit transfers excluded). Course `credits` are stored and returned, but the live round, direct registration and Add & Drop never check a total.
- **Not load-tested.** FFCS-scale traffic would need work on connection pooling, targeted Socket.IO updates instead of global `seats:update` broadcasts, multi-instance Socket.IO, caching of read-heavy endpoints and rate limiting.
- No automated tests (`npm test` is unset in the backend; the frontend only has the default CRA test).
- No admin UI. The admin role exists and has an API endpoint, but there is no screen for it.
- Add & Drop and FFCS windows are configured via environment variables and fixed at server start.
- `GET /api/addrop/me` runs a queue sweep on every call, which will not scale.
- `schema.sql` (MySQL) is legacy; the app now targets PostgreSQL.

