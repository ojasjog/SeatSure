import React from "react";
import "./Landing.css";

// =========================================================
// LANDING
// First screen after login. Registration happens in three
// stages, in order (Pre-FFCS -> FFCS -> Add & Drop), plus a
// reviews space. Each card carries a small picture of what
// that stage does.
// =========================================================

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// a 6 x 4 week of tiles; some lit in course colours
const PLAN_TILES = [
  0, null, 2, null, 1, null,
  null, 3, null, 0, null, 5,
  2, null, 4, null, 3, null,
  null, 1, null, 5, null, 4,
];

function PlanVisual() {
  return (
    <div className="lv-plan" aria-hidden="true">
      {PLAN_TILES.map((c, i) => (
        <span
          key={i}
          className={c === null ? "lv-tile" : `lv-tile lit cc-${c}`}
          style={{ "--d": `${(i % 6) * 60 + Math.floor(i / 6) * 40}ms` }}
        />
      ))}
    </div>
  );
}

function SeatsVisual() {
  return (
    <div className="lv-seats" aria-hidden="true">
      <div className="lv-seats-row">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className={i < 9 ? "lv-seat taken" : "lv-seat"} style={{ "--d": `${i * 80}ms` }} />
        ))}
      </div>
      <div className="lv-seats-count">
        <strong>3</strong> seats left
      </div>
    </div>
  );
}

function QueueVisual() {
  return (
    <div className="lv-queue" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i === 0 ? "lv-person you" : "lv-person"}>
          {i === 0 ? "You" : ""}
        </span>
      ))}
    </div>
  );
}

function StarsVisual() {
  return (
    <div className="lv-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= 4 ? "on" : ""} style={{ "--d": `${n * 70}ms` }}>
          ★
        </span>
      ))}
    </div>
  );
}

function Landing({ student, onSelect, onLogout }) {
  const firstName = student?.name ? student.name.split(" ")[0] : "";

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">SeatSure</div>
            <div className="brand-subtitle">VIT Vellore registration</div>
          </div>
        </div>

        <div className="landing-header-right">
          {student?.reg_no && <span className="landing-reg">{student.reg_no}</span>}
          <button type="button" className="btn btn-sm" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="landing-main">
        <div className="landing-intro">
          <p className="landing-greeting">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}.
          </p>
          <h1>Where are you in registration?</h1>
        </div>

        <div className="landing-cards">
          <button
            type="button"
            className="landing-card lc-plan"
            onClick={() => onSelect("preffcs")}
          >
            <div className="landing-card-top">
              <span className="landing-card-step">Step 1</span>
            </div>
            <PlanVisual />
            <div className="landing-card-body">
              <div className="landing-card-title">Pre-FFCS</div>
              <div className="landing-card-desc">
                Rank faculty for every course and watch your week take shape.
                Clashes show up before you commit.
              </div>
            </div>
            <span className="landing-card-cta">Plan my week</span>
          </button>

          <button
            type="button"
            className="landing-card lc-ffcs"
            onClick={() => onSelect("ffcs")}
          >
            <div className="landing-card-top">
              <span className="landing-card-step">Step 2</span>
            </div>
            <SeatsVisual />
            <div className="landing-card-body">
              <div className="landing-card-title">FFCS</div>
              <div className="landing-card-desc">
                Register live from your ranked list. Seats go in real time,
                first come first served.
              </div>
            </div>
          </button>

          <button
            type="button"
            className="landing-card lc-wait"
            onClick={() => onSelect("waitlist")}
          >
            <div className="landing-card-top">
              <span className="landing-card-step">Step 3</span>
            </div>
            <QueueVisual />
            <div className="landing-card-body">
              <div className="landing-card-title">Add &amp; Drop</div>
              <div className="landing-card-desc">
                Queue for a course you missed, or drop one you don't want.
              </div>
            </div>
          </button>

          <button
            type="button"
            className="landing-card lc-reviews"
            onClick={() => onSelect("reviews")}
          >
            <StarsVisual />
            <div className="landing-card-body">
              <div className="landing-card-title">Reviews</div>
              <div className="landing-card-desc">
                What students who finished the course say about each professor.
              </div>
            </div>
          </button>
        </div>
      </main>
    </div>
  );
}

export default Landing;
