import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  confirmFFCSChoice,
  getFFCSOptions,
  getFFCSSession,
  getFFCSSummary,
  SOCKET_URL,
} from "../api";
import "./FFCSPage.css";

// =========================================================
// SEAT BAR
// =========================================================

function SeatBar({ seatsRemaining, totalSeats }) {
  const pct =
    totalSeats > 0 ? Math.max(0, Math.min(100, (seatsRemaining / totalSeats) * 100)) : 0;

  const level =
    seatsRemaining <= 0 ? "full" : pct <= 20 ? "low" : pct <= 50 ? "mid" : "ok";

  return (
    <div className={`seat-bar seat-bar-${level}`}>
      <div className="seat-bar-fill" style={{ width: `${pct}%` }} />
      <span className="seat-bar-label">
        {seatsRemaining}/{totalSeats} seats
      </span>
    </div>
  );
}

// =========================================================
// PRIORITY OPTION ROW (read-only — the server decides which one
// actually gets locked in when Confirm is pressed)
// =========================================================

function PriorityRow({ option, isTopViable }) {
  return (
    <div
      className={`ffcs-option ${isTopViable ? "ffcs-option-enrolled" : ""} ${
        option.full ? "ffcs-option-full" : ""
      }`}
    >
      <div className="ffcs-option-top">
        <div className="ffcs-option-rank">P{option.priority_rank}</div>
        <div className="ffcs-option-professor">{option.professor_name}</div>
        <div className="ffcs-option-slots">{option.slot_codes.join(" + ")}</div>
        {isTopViable && <span className="ffcs-status ffcs-status-enrolled">Will be tried first</span>}
        {option.full && !isTopViable && (
          <span className="ffcs-status ffcs-status-waitlisted">Full — auto-skipped</span>
        )}
      </div>

      <div className="ffcs-option-seats">
        {option.seats.map((seat) => (
          <div key={seat.offering_id} className="ffcs-option-seat-row">
            <span className="ffcs-option-seat-type">
              {seat.course_type === "lab" ? "Lab" : "Theory"} · {seat.venue}
            </span>
            <SeatBar seatsRemaining={seat.seats_remaining} totalSeats={seat.total_seats} />
          </div>
        ))}
      </div>
    </div>
  );
}

// =========================================================
// WAITING ROOM — shown before the student's turn opens
// =========================================================

function TurnCountdown({ unlocksAt, onOpen }) {
  const [msLeft, setMsLeft] = useState(new Date(unlocksAt) - new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = new Date(unlocksAt) - new Date();
      setMsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onOpen();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [unlocksAt, onOpen]);

  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));

  return (
    <div className="ffcs-empty">
      <div className="ffcs-empty-icon">⏳</div>
      <h2>Your FFCS turn hasn't started yet</h2>
      <p>
        Registration opens for you in <strong>{secondsLeft}s</strong>, based on your assigned
        turn number.
      </p>
    </div>
  );
}

// =========================================================
// FINAL SUMMARY SCREEN
// =========================================================

function SummaryScreen({ summary, onBack }) {
  return (
    <div className="ffcs-course-list">
      <div className="ffcs-summary-banner">
        <h2>FFCS complete</h2>
        <p>
          {summary.allocated_count} of {summary.courses.length} subjects allocated
          {summary.not_allocated_count > 0 ? ` · ${summary.not_allocated_count} not allocated` : ""}
        </p>
      </div>

      {summary.courses.map((course) => (
        <div
          key={course.course_id}
          className={`ffcs-course ${course.allocated ? "" : "ffcs-course-unallocated"}`}
        >
          <div className="ffcs-course-header">
            <div>
              <div className="ffcs-course-code">{course.course_code}</div>
              <div className="ffcs-course-name">{course.course_name}</div>
            </div>
            {course.allocated ? (
              <span className="ffcs-locked-badge">Allocated</span>
            ) : (
              <span className="ffcs-locked-badge ffcs-locked-badge-bad">Not allocated</span>
            )}
          </div>

          {course.allocated ? (
            <div className="ffcs-summary-detail">
              <strong>{course.professor_name}</strong>
              <div>
                {course.sections
                  .map((s) => `${s.course_type === "lab" ? "Lab" : "Theory"} (${s.slot_codes}) · ${s.venue}`)
                  .join("  ·  ")}
              </div>
            </div>
          ) : (
            <div className="ffcs-summary-detail ffcs-summary-detail-muted">
              All ranked professors were full or clashed with another subject you locked in.
            </div>
          )}
        </div>
      ))}

      <button type="button" className="ffcs-register-button" onClick={onBack}>
        ← Back home
      </button>
    </div>
  );
}

// =========================================================
// FFCS PAGE
// =========================================================

function FFCSPage({ onBack }) {
  const [phase, setPhase] = useState("loading"); // loading | waiting | active | summary | error
  const [unlocksAt, setUnlocksAt] = useState(null);
  const [courseData, setCourseData] = useState(null); // { course, options, course_index, total_courses }
  const [summary, setSummary] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const socketRef = useRef(null);
  const advanceTimerRef = useRef(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await getFFCSSummary();
      setSummary(data);
      setPhase("summary");
    } catch (error) {
      console.error("Failed to load FFCS summary:", error);
      setErrorMessage("Couldn't load your final summary.");
      setPhase("error");
    }
  }, []);

  const loadCurrentSubject = useCallback(async () => {
    try {
      const data = await getFFCSOptions();
      if (data.done) {
        loadSummary();
        return;
      }
      setCourseData(data);
      setPhase("active");
    } catch (error) {
      const apiError = error?.response?.data?.error;
      if (error?.response?.status === 403 && error?.response?.data?.unlocks_at) {
        setUnlocksAt(error.response.data.unlocks_at);
        setPhase("waiting");
        return;
      }
      console.error("Failed to load FFCS options:", error);
      setErrorMessage(apiError || "Unable to load your FFCS options. Submit your priorities first.");
      setPhase("error");
    }
  }, [loadSummary]);

  // ---- Entry point: check the turn gate first ----
  useEffect(() => {
    (async () => {
      try {
        const session = await getFFCSSession();
        if (session.open) {
          loadCurrentSubject();
        } else {
          setUnlocksAt(session.unlocks_at);
          setPhase("waiting");
        }
      } catch (error) {
        console.error("Failed to load FFCS session:", error);
        setErrorMessage(
          error?.response?.data?.error || "Unable to check your FFCS turn."
        );
        setPhase("error");
      }
    })();
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Live seat updates, active the whole time the page is open ----
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("seats:update", ({ offering_id, seats_remaining, total_seats }) => {
      setCourseData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          options: prev.options.map((option) => {
            const seats = option.seats.map((seat) =>
              seat.offering_id === offering_id ? { ...seat, seats_remaining, total_seats } : seat
            );
            return { ...option, seats, full: seats.some((s) => s.seats_remaining <= 0) };
          }),
        };
      });
    });

    return () => socket.disconnect();
  }, []);

  // ---- Confirm → auto-advance ----
  const handleConfirm = async () => {
    setConfirming(true);
    setResultMessage("");

    try {
      const result = await confirmFFCSChoice();

      setResultMessage(
        result.allocated
          ? `Locked in ${result.allocation.professor_name} (priority ${result.allocation.priority_rank}) for ${result.course.course_name}.`
          : `Couldn't allocate ${result.course.course_name} — every ranked professor was full or clashed.`
      );

      // Auto-advance with no manual "next" click, after a short beat
      // so the student sees what happened.
      advanceTimerRef.current = setTimeout(() => {
        setResultMessage("");
        if (result.done) {
          loadSummary();
        } else {
          loadCurrentSubject();
        }
      }, 1100);
    } catch (error) {
      console.error("Confirm failed:", error);
      setErrorMessage(error?.response?.data?.error || "Confirm failed — try again.");
    } finally {
      setConfirming(false);
    }
  };

  const topViableRank = courseData?.options.find((o) => !o.full)?.priority_rank;

  return (
    <div className="ffcs-shell">
      <header className="ffcs-header">
        <button type="button" className="ffcs-back" onClick={onBack}>
          ← Home
        </button>

        <div className="ffcs-header-text">
          <div className="eyebrow">VIT VELLORE · LIVE FFCS</div>
          <h1>Live FFCS round</h1>
          <p>
            Subjects appear one at a time, in the order you ranked them. Confirm locks in your
            best available priority and moves you straight to the next subject.
          </p>
        </div>

        {phase === "active" && courseData && (
          <div className="ffcs-progress">
            Subject {courseData.course_index + 1} of {courseData.total_courses}
          </div>
        )}
      </header>

      {resultMessage && <div className="ffcs-status-message">{resultMessage}</div>}
      {phase === "error" && <div className="ffcs-status-message">{errorMessage}</div>}

      {phase === "loading" && <div className="ffcs-loading">Checking your FFCS turn...</div>}

      {phase === "waiting" && unlocksAt && (
        <TurnCountdown unlocksAt={unlocksAt} onOpen={loadCurrentSubject} />
      )}

      {phase === "active" && courseData && (
        <div className="ffcs-course-list">
          <div className="ffcs-course">
            <div className="ffcs-course-header">
              <div>
                <div className="ffcs-course-code">{courseData.course.course_code}</div>
                <div className="ffcs-course-name">{courseData.course.course_name}</div>
              </div>
            </div>

            {courseData.options.length === 0 ? (
              <p className="ffcs-summary-detail-muted">
                Every ranked professor for this subject clashes with something you've already
                locked in. Confirming will mark it as not allocated and move on.
              </p>
            ) : (
              <div className="ffcs-options">
                {courseData.options.map((option) => (
                  <PriorityRow
                    key={option.priority_rank}
                    option={option}
                    isTopViable={option.priority_rank === topViableRank}
                  />
                ))}
              </div>
            )}

            <div className="ffcs-option-footer">
              <button
                type="button"
                className="ffcs-register-button"
                disabled={confirming}
                onClick={handleConfirm}
              >
                {confirming ? "Confirming..." : "Confirm & continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "summary" && summary && <SummaryScreen summary={summary} onBack={onBack} />}
    </div>
  );
}

export default FFCSPage;
