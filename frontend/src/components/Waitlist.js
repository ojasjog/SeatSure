import React from "react";
import "./Waitlist.css";

// =========================================================
// WAITLIST (stub)
// Deliberately unwired for Review 2 — the button exists so the
// three-stage flow is visible end-to-end, but this page doesn't
// talk to the backend yet.
// =========================================================

function WaitlistPage({ onBack }) {
  return (
    <div className="stub-shell">
      <button type="button" className="stub-back" onClick={onBack}>
        ← Home
      </button>

      <div className="stub-card">
        <div className="stub-icon">◷</div>
        <h1>Waitlist</h1>
        <p>
          This is where you'll track your queue position for any offering
          that filled up during FFCS. It isn't wired up yet — that's
          planned for a later review.
        </p>
      </div>
    </div>
  );
}

export default WaitlistPage;
