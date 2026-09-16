import React from "react";
import "./Landing.css";

// =========================================================
// LANDING
// The first screen after login. Splits registration into its
// three real stages instead of dropping the student straight
// into Pre-FFCS. Only Pre-FFCS and FFCS are wired for Review 2;
// Waitlist is a placeholder button.
// =========================================================

function Landing({ student, onSelect, onLogout }) {
  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">SeatSure</div>
            <div className="brand-subtitle">VIT Vellore Registration Suite</div>
          </div>
        </div>

        <button type="button" className="logout-button" onClick={onLogout}>
          Log out
        </button>
      </header>

      <main className="landing-main">
        <div className="landing-intro">
          <div className="eyebrow">
            {student?.name ? `Welcome, ${student.name}` : "Welcome"}
          </div>

          <h1>What do you want to do?</h1>

          <p>Pick a stage of registration to continue.</p>
        </div>

        <div className="landing-cards">
          <button
            type="button"
            className="landing-card"
            onClick={() => onSelect("preffcs")}
          >
            <div className="landing-card-icon">1</div>
            <div className="landing-card-title">Pre-FFCS</div>
            <div className="landing-card-desc">
              Rank faculty preferences for each course and generate a
              clash-free draft timetable.
            </div>
            <span className="landing-card-arrow">→</span>
          </button>

          <button
            type="button"
            className="landing-card"
            onClick={() => onSelect("ffcs")}
          >
            <div className="landing-card-icon">2</div>
            <div className="landing-card-title">FFCS</div>
            <div className="landing-card-desc">
              Register live for the courses you ranked. Seats drain in
              real time — first come, first served, just like the real
              thing.
            </div>
            <span className="landing-card-arrow">→</span>
          </button>

          <button
            type="button"
            className="landing-card landing-card-soon"
            onClick={() => onSelect("waitlist")}
          >
            <div className="landing-card-icon">3</div>
            <div className="landing-card-title">
              Waitlist
              <span className="landing-card-badge">Coming soon</span>
            </div>
            <div className="landing-card-desc">
              Track your queue position for any offering that filled up
              during FFCS.
            </div>
            <span className="landing-card-arrow">→</span>
          </button>
        </div>
      </main>
    </div>
  );
}

export default Landing;
