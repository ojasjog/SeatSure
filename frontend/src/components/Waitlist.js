import React, { useEffect, useState, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import {
  getAddDropStatus,
  joinAddDropQueue,
  leaveAddDropQueue,
  dropCourse,
  SOCKET_URL,
} from "../api";
import "./Waitlist.css";

function formatWindow(win) {
  if (!win || !win.configured) return "Not scheduled yet";
  const opens = new Date(win.opens_at);
  const closes = new Date(win.closes_at);
  const fmt = (d) =>
    d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (win.open) return `Closes ${fmt(closes)}`;
  const now = new Date();
  if (now < opens) return `Opens ${fmt(opens)}`;
  return `Closed ${fmt(closes)}`;
}

function windowState(win) {
  if (!win || !win.configured) return "unscheduled";
  if (win.open) return "open";
  return new Date() < new Date(win.opens_at) ? "upcoming" : "closed";
}

export default function Waitlist({ onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  // Drop is two taps: the first arms the button, the second drops.
  const [armedDrop, setArmedDrop] = useState(null);

  useEffect(() => {
    if (armedDrop == null) return undefined;
    const t = setTimeout(() => setArmedDrop(null), 3500);
    return () => clearTimeout(t);
  }, [armedDrop]);
  const socketRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await getAddDropStatus();
      setData(res);
      setError("");
    } catch (err) {
      setError("Failed to load Add & Drop status");
    }
  }, []);

  useEffect(() => {
    load();
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on("seats:update", () => load());
    socket.on("addrop:promoted", () => load());

    const interval = setInterval(load, 15000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [load]);

  const handleJoin = async (courseId) => {
    setBusyId(courseId);
    try {
      await joinAddDropQueue(courseId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to join the queue");
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (courseId) => {
    setBusyId(courseId);
    try {
      await leaveAddDropQueue(courseId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to leave the queue");
    } finally {
      setBusyId(null);
    }
  };

  const handleDrop = async (offeringId) => {
    if (armedDrop !== offeringId) {
      setArmedDrop(offeringId);
      return;
    }
    setArmedDrop(null);
    setBusyId(offeringId);
    try {
      await dropCourse(offeringId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to drop this course");
    } finally {
      setBusyId(null);
    }
  };

  const joinWindow = data?.join_window;
  const allotWindow = data?.allot_window;
  const joinState = windowState(joinWindow);
  const allotState = windowState(allotWindow);

  return (
    <div className="ad-page">
      {onBack && (
        <button type="button" className="page-back" onClick={onBack}>
          ← Home
        </button>
      )}

      <header className="ad-header">
        <div>
          <div className="ad-eyebrow">Waitlist</div>
          <h1 className="ad-title">Add &amp; Drop</h1>
          <p className="ad-lede">
            Queue for a course you missed, any professor whose slots fit your timetable. Seats
            are handed out in queue order while live allotment runs.
          </p>
        </div>

        <ol className="ad-timeline" aria-label="Add and Drop schedule">
          <li className={`ad-step ad-step-${joinState}`}>
            <span className="ad-step-dot" />
            <div>
              <strong>Join the queue</strong>
              <span>{formatWindow(joinWindow)}</span>
            </div>
          </li>
          <li className={`ad-step ad-step-${allotState}`}>
            <span className="ad-step-dot" />
            <div>
              <strong>Live allotment</strong>
              <span>{formatWindow(allotWindow)}</span>
            </div>
          </li>
        </ol>
      </header>

      {error && <div className="ad-error">{error}</div>}

      {!data && !error ? (
        <div className="ad-loading">Loading Add &amp; Drop…</div>
      ) : (
        <div className="ad-cards">
          <section className="ad-card">
            <div className="ad-card-head">
              <h3>Add</h3>
              <span className={`ad-badge ${joinWindow?.open ? "ad-open" : "ad-closed"}`}>
                {joinWindow?.open ? "Queue open" : "Queue closed"}
              </span>
            </div>
            <p className="ad-sub">Courses you don't have yet.</p>

            {data?.missing?.length === 0 ? (
              <p className="ad-empty">You're enrolled in every course. Nothing to add.</p>
            ) : (
              <ul className="ad-list">
                {data?.missing?.map((m) => (
                  <li key={m.course_id} className={`ad-list-item${m.queued ? " queued" : ""}`}>
                    {m.queued && (
                      <span className="ad-pos" title="Your place in the queue">
                        <small>#</small>
                        {m.queue_position}
                      </span>
                    )}
                    <div className="ad-item-text">
                      <span className="ad-code">{m.course_code}</span>
                      <span className="ad-name">{m.course_name}</span>
                      {m.queued && (
                        <span className="ad-position">
                          {allotState === "open"
                            ? "Waiting for a seat to open"
                            : "In the queue, allotment hasn't started"}
                        </span>
                      )}
                    </div>
                    {m.queued ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyId === m.course_id}
                        onClick={() => handleLeave(m.course_id)}
                      >
                        Leave queue
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!joinWindow?.open || busyId === m.course_id}
                        onClick={() => handleJoin(m.course_id)}
                      >
                        {busyId === m.course_id ? "Joining…" : "Join queue"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ad-card">
            <div className="ad-card-head">
              <h3>Drop</h3>
              <span className="ad-badge ad-open">Any time</span>
            </div>
            <p className="ad-sub">Your courses. Dropping frees the seat for the next person in line.</p>

            {data?.enrolled?.length === 0 ? (
              <p className="ad-empty">You aren't enrolled in anything yet.</p>
            ) : (
              <ul className="ad-list">
                {data?.enrolled?.map((e) => (
                  <li key={e.offering_id} className="ad-list-item">
                    <div className="ad-item-text">
                      <span className="ad-code">{e.course_code}</span>
                      <span className="ad-name">{e.course_name}</span>
                      <span className="ad-position">
                        {e.professor}, {e.venue}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-danger btn-sm${armedDrop === e.offering_id ? " armed" : ""}`}
                      disabled={busyId === e.offering_id}
                      onClick={() => handleDrop(e.offering_id)}
                    >
                      {busyId === e.offering_id
                        ? "Dropping…"
                        : armedDrop === e.offering_id
                        ? "Tap to confirm"
                        : "Drop"}
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