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
  if (win.open) return `Open now — closes ${fmt(closes)}`;
  const now = new Date();
  if (now < opens) return `Opens ${fmt(opens)}`;
  return `Closed — was open until ${fmt(closes)}`;
}

export default function Waitlist() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
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

  if (!data && !error) {
    return <div className="ad-page">Loading Add & Drop…</div>;
  }

  const joinWindow = data?.join_window;
  const allotWindow = data?.allot_window;

  return (
    <div className="ad-page">
      <h2 className="ad-title">Waitlist — Add &amp; Drop</h2>
      {error && <div className="ad-error">{error}</div>}

      <div className="ad-cards">
        <div className="ad-card">
          <div className="ad-card-head">
            <h3>Add</h3>
            <span className={`ad-badge ${joinWindow?.open ? "ad-open" : "ad-closed"}`}>
              {joinWindow?.open ? "Be-in-queue open" : "Be-in-queue closed"}
            </span>
          </div>
          <p className="ad-window-label">{formatWindow(joinWindow)}</p>
          <p className="ad-sub">
            Join a course you missed in FFCS. You're queued for the course itself — any
            non-clashing professor's section works.
          </p>

          <div className="ad-allot-note">
            <span className={`ad-badge ${allotWindow?.open ? "ad-open" : "ad-closed"}`}>
              {allotWindow?.open ? "Live allotment running" : "Live allotment not running"}
            </span>
            <span className="ad-sub">{formatWindow(allotWindow)}</span>
          </div>

          {data?.missing?.length === 0 ? (
            <p className="ad-empty">You're enrolled in every course — nothing to add.</p>
          ) : (
            <ul className="ad-list">
              {data?.missing?.map((m) => (
                <li key={m.course_id} className="ad-list-item">
                  <div>
                    <strong>{m.course_code}</strong> — {m.course_name}
                    {m.queued && (
                      <div className="ad-position">Queue position: #{m.queue_position}</div>
                    )}
                  </div>
                  {m.queued ? (
                    <button
                      className="ad-btn ad-btn-leave"
                      disabled={busyId === m.course_id}
                      onClick={() => handleLeave(m.course_id)}
                    >
                      Leave queue
                    </button>
                  ) : (
                    <button
                      className="ad-btn ad-btn-join"
                      disabled={!joinWindow?.open || busyId === m.course_id}
                      onClick={() => handleJoin(m.course_id)}
                    >
                      Be in queue
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ad-card">
          <div className="ad-card-head">
            <h3>Drop</h3>
            <span className="ad-badge ad-open">Always open</span>
          </div>
          <p className="ad-sub">
            Drop any course you're currently enrolled in. No window, no queue — it's instant.
          </p>

          {data?.enrolled?.length === 0 ? (
            <p className="ad-empty">You aren't enrolled in anything yet.</p>
          ) : (
            <ul className="ad-list">
              {data?.enrolled?.map((e) => (
                <li key={e.offering_id} className="ad-list-item">
                  <div>
                    <strong>{e.course_code}</strong> — {e.course_name}
                    <div className="ad-position">
                      {e.professor} · {e.venue} · {e.course_type}
                    </div>
                  </div>
                  <button
                    className="ad-btn ad-btn-drop"
                    disabled={busyId === e.offering_id}
                    onClick={() => handleDrop(e.offering_id)}
                  >
                    Drop
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}