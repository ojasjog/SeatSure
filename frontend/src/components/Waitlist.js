import React, { useCallback, useEffect, useState } from "react";
import {
  getAddDropStatus,
  joinAddDropQueue,
  leaveAddDropQueue,
  dropCourse,
} from "../api";
import "./Waitlist.css";

// =========================================================
// WAITLIST  —  Add & Drop
// Two cards: Add (join/leave a course-level queue, only while the
// Pre-Add&Drop window is open) and Drop (give up a confirmed
// course any time — no window, no queue needed).
// =========================================================

const errMsg = (err, fallback) => err?.response?.data?.error || fallback;

function formatWindow(win) {
  if (!win?.configured) return "The Add & Drop window hasn't been scheduled yet.";
  const opens = new Date(win.opens_at);
  const closes = new Date(win.closes_at);
  const fmt = (d) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (win.open) return `Open now — closes ${fmt(closes)}.`;
  const now = new Date();
  return now < opens
    ? `Opens ${fmt(opens)}, closes ${fmt(closes)}.`
    : `Closed — was open until ${fmt(closes)}.`;
}

function WaitlistPage({ onBack }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null); // course_id or offering_id currently being acted on

  const load = useCallback(() => {
    return getAddDropStatus()
      .then((data) => {
        setStatus(data);
        setError("");
      })
      .catch((err) => setError(errMsg(err, "Couldn't load Add & Drop.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (courseId) => {
    setBusyId(courseId);
    setError("");
    try {
      await joinAddDropQueue(courseId);
      await load();
    } catch (err) {
      setError(errMsg(err, "Couldn't join the queue."));
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (courseId) => {
    setBusyId(courseId);
    setError("");
    try {
      await leaveAddDropQueue(courseId);
      await load();
    } catch (err) {
      setError(errMsg(err, "Couldn't leave the queue."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDrop = async (offeringId, courseName) => {
    if (!window.confirm(`Drop ${courseName}? This frees your seat for the next person in that course's queue.`)) {
      return;
    }
    setBusyId(offeringId);
    setError("");
    try {
      await dropCourse(offeringId);
      await load();
    } catch (err) {
      setError(errMsg(err, "Couldn't drop this course."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="ad-shell">
      <button type="button" className="ad-back" onClick={onBack}>← Home</button>

      <h1 className="ad-title">Waitlist</h1>
      <p className="ad-sub">Add a course you missed, or drop one you no longer want.</p>

      {loading && <div className="ad-muted">Loading…</div>}
      {error && <div className="ad-error">{error}</div>}

      {status && (
        <div className="ad-layout">
          {/* ---------- ADD card ---------- */}
          <section className="ad-card">
            <div className="ad-card-head">
              <h2>Add</h2>
              <span className={`ad-window-chip ${status.window.open ? "open" : ""}`}>
                {status.window.open ? "Window open" : "Window closed"}
              </span>
            </div>
            <p className="ad-window-note">{formatWindow(status.window)}</p>

            {status.missing.length === 0 ? (
              <div className="ad-empty">You have every course allotted. Nothing to add.</div>
            ) : (
              <ul className="ad-list">
                {status.missing.map((c) => (
                  <li key={c.course_id} className="ad-row">
                    <div>
                      <div className="ad-code">{c.course_code}</div>
                      <div className="ad-name">{c.course_name}</div>
                    </div>
                    {c.queued ? (
                      <div className="ad-row-actions">
                        <span className="ad-position">#{c.queue_position} in line</span>
                        <button
                          type="button"
                          className="ad-ghost danger"
                          disabled={busyId === c.course_id}
                          onClick={() => handleLeave(c.course_id)}
                        >
                          Leave queue
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ad-primary"
                        disabled={!status.window.open || busyId === c.course_id}
                        onClick={() => handleJoin(c.course_id)}
                        title={!status.window.open ? "Only available while the Pre-Add&Drop window is open" : undefined}
                      >
                        {busyId === c.course_id ? "Joining…" : "Be in queue"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- DROP card ---------- */}
          <section className="ad-card">
            <div className="ad-card-head">
              <h2>Drop</h2>
            </div>
            <p className="ad-window-note">Dropping works any time — no queue, no window.</p>

            {status.enrolled.length === 0 ? (
              <div className="ad-empty">You aren't enrolled in anything yet.</div>
            ) : (
              <ul className="ad-list">
                {status.enrolled.map((c) => (
                  <li key={c.offering_id} className="ad-row">
                    <div>
                      <div className="ad-code">{c.course_code} · {c.course_type}</div>
                      <div className="ad-name">{c.course_name}</div>
                      <div className="ad-meta">{c.professor} · {c.venue}</div>
                    </div>
                    <button
                      type="button"
                      className="ad-ghost danger"
                      disabled={busyId === c.offering_id}
                      onClick={() => handleDrop(c.offering_id, c.course_name)}
                    >
                      {busyId === c.offering_id ? "Dropping…" : "Drop"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default WaitlistPage;