import React, { useCallback, useEffect, useState } from "react";
import {
  confirmFFCSChoice,
  getFFCSOptions,
  getFFCSSession,
  getFFCSSummary,
  skipFFCSSubject,
} from "../api";
import "./FFCSPage.css";

// =========================================================
// FACULTY ROW — plain radio pick. Shortlisted faculty (ranked
// during the preference step) are pinned to the top of the list
// and visually highlighted; everyone else follows alphabetically.
// No seat counts are shown here — availability is only surfaced
// if a Confirm attempt actually fails.
// =========================================================

function FacultyRow({ faculty, selected, onSelect }) {
  const isShortlisted = faculty.priority_rank != null;

  return (
    <label
      className={`ffcs-faculty-row ${isShortlisted ? "ffcs-faculty-row-shortlisted" : ""} ${
        selected ? "ffcs-faculty-row-selected" : ""
      }`}
    >
      <input
        type="radio"
        name="ffcs-faculty"
        className="ffcs-faculty-radio"
        checked={selected}
        onChange={() => onSelect(faculty.professor_id)}
      />

      <div className="ffcs-faculty-main">
        <div className="ffcs-faculty-top">
          {isShortlisted && <span className="ffcs-option-rank">P{faculty.priority_rank}</span>}
          <span className="ffcs-faculty-name">{faculty.professor_name}</span>
          <span className="ffcs-faculty-slots">{faculty.slot_codes.join(" + ")}</span>
        </div>
        <div className="ffcs-faculty-sections">
          {faculty.sections.map((s) => (
            <span key={s.offering_id} className="ffcs-faculty-section">
              {s.course_type === "lab" ? "Lab" : "Theory"} · {s.venue}
            </span>
          ))}
        </div>
      </div>
    </label>
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
            <div className="ffcs-summary-detail-muted">
              No faculty member was selected for this subject before it was skipped.
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

// Faculty the student shortlisted come first (in their ranked
// order); everyone else follows alphabetically by name.
function sortFaculty(faculty) {
  return [...faculty].sort((a, b) => {
    const aRanked = a.priority_rank != null;
    const bRanked = b.priority_rank != null;
    if (aRanked && bRanked) return a.priority_rank - b.priority_rank;
    if (aRanked) return -1;
    if (bRanked) return 1;
    return a.professor_name.localeCompare(b.professor_name);
  });
}

function FFCSPage({ onBack }) {
  const [phase, setPhase] = useState("loading"); // loading | waiting | active | summary | error
  const [unlocksAt, setUnlocksAt] = useState(null);
  const [courseData, setCourseData] = useState(null); // { course, faculty, course_index, total_courses }
  const [selectedProfessorId, setSelectedProfessorId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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
      // Default-select the student's top shortlisted faculty, if any.
      const sorted = sortFaculty(data.faculty);
      setSelectedProfessorId(sorted[0]?.professor_id ?? null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Confirm the selected faculty member ----
  const handleConfirm = async () => {
    if (!selectedProfessorId) return;
    setConfirming(true);
    setResultMessage("");

    try {
      const result = await confirmFFCSChoice(selectedProfessorId);

      if (result.allocated) {
        setResultMessage(
          `Locked in ${result.allocation.professor_name} for ${result.course.course_name}.`
        );
        setTimeout(() => {
          setResultMessage("");
          if (result.done) {
            loadSummary();
          } else {
            loadCurrentSubject();
          }
        }, 900);
      } else {
        // Not allocated (full/clash) — stay on this subject so the
        // student can pick someone else.
        setResultMessage(result.message || "Couldn't lock that in — pick another faculty member.");
      }
    } catch (error) {
      console.error("Confirm failed:", error);
      setErrorMessage(error?.response?.data?.error || "Confirm failed — try again.");
    } finally {
      setConfirming(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      const result = await skipFFCSSubject();
      if (result.done) {
        loadSummary();
      } else {
        loadCurrentSubject();
      }
    } catch (error) {
      console.error("Skip failed:", error);
      setErrorMessage(error?.response?.data?.error || "Couldn't skip this subject — try again.");
    } finally {
      setSkipping(false);
    }
  };

  const sortedFaculty = courseData ? sortFaculty(courseData.faculty) : [];

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
            Subjects appear one at a time, in the order you ranked them. Pick a faculty member
            for each — your shortlisted priorities are pinned to the top — then confirm to move
            to the next subject.
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

            {sortedFaculty.length === 0 ? (
              <p className="ffcs-summary-detail-muted">
                Every faculty member for this subject clashes with something you've already
                locked in. Skip to mark it as not allocated and move on.
              </p>
            ) : (
              <div className="ffcs-faculty-list">
                {sortedFaculty.map((faculty) => (
                  <FacultyRow
                    key={faculty.professor_id}
                    faculty={faculty}
                    selected={faculty.professor_id === selectedProfessorId}
                    onSelect={setSelectedProfessorId}
                  />
                ))}
              </div>
            )}

            <div className="ffcs-option-footer">
              <button
                type="button"
                className="ffcs-skip-button"
                disabled={confirming || skipping}
                onClick={handleSkip}
              >
                {skipping ? "Skipping..." : "Skip subject"}
              </button>
              <button
                type="button"
                className="ffcs-register-button"
                disabled={confirming || skipping || !selectedProfessorId}
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
