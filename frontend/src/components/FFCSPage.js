import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import {
  getFFCSOptions,
  registerOffering,
  SOCKET_URL,
} from "../api";
import "./FFCSPage.css";

// =========================================================
// SEAT BAR
// =========================================================

function SeatBar({ seatsRemaining, totalSeats }) {
  const pct =
    totalSeats > 0
      ? Math.max(
          0,
          Math.min(100, (seatsRemaining / totalSeats) * 100)
        )
      : 0;

  const level =
    seatsRemaining <= 0
      ? "full"
      : pct <= 20
      ? "low"
      : pct <= 50
      ? "mid"
      : "ok";

  return (
    <div className={`seat-bar seat-bar-${level}`}>
      <div
        className="seat-bar-fill"
        style={{ width: `${pct}%` }}
      />
      <span className="seat-bar-label">
        {seatsRemaining}/{totalSeats} seats
      </span>
    </div>
  );
}

// =========================================================
// OPTION ROW
// =========================================================

function OptionRow({
  course,
  option,
  isRegistering,
  onRegister,
}) {
  return (
    <div
      className={`ffcs-option ${
        option.enrolled
          ? "ffcs-option-enrolled"
          : ""
      }`}
    >
      <div className="ffcs-option-top">
        <div className="ffcs-option-rank">
          P{option.priority_rank}
        </div>

        <div className="ffcs-option-professor">
          {option.professor_name}
        </div>

        <div className="ffcs-option-slots">
          {option.slot_codes.join(" + ")}
        </div>
      </div>

      <div className="ffcs-option-seats">
        {option.seats.map((seat) => (
          <div
            key={seat.offering_id}
            className="ffcs-option-seat-row"
          >
            <span className="ffcs-option-seat-type">
              {seat.course_type === "lab"
                ? "Lab"
                : "Theory"}{" "}
              · {seat.venue}
            </span>

            <SeatBar
              seatsRemaining={seat.seats_remaining}
              totalSeats={seat.total_seats}
            />
          </div>
        ))}
      </div>

      <div className="ffcs-option-footer">
        {option.enrolled ? (
          <span className="ffcs-status ffcs-status-enrolled">
            ✓ Registered
          </span>
        ) : option.waitlist_position ? (
          <span className="ffcs-status ffcs-status-waitlisted">
            On waitlist · position {option.waitlist_position}
          </span>
        ) : (
          <button
            type="button"
            className="ffcs-register-button"
            disabled={isRegistering}
            onClick={() => onRegister(course, option)}
          >
            {isRegistering
              ? "Registering..."
              : option.full
              ? "Join waitlist"
              : "Register"}
          </button>
        )}
      </div>
    </div>
  );
}

// =========================================================
// COURSE BLOCK
// =========================================================

function CourseBlock({
  course,
  registeringKey,
  onRegister,
}) {
  return (
    <div className="ffcs-course">
      <div className="ffcs-course-header">
        <div>
          <div className="ffcs-course-code">
            {course.course_code}
          </div>

          <div className="ffcs-course-name">
            {course.course_name}
          </div>
        </div>

        {course.locked && (
          <span className="ffcs-locked-badge">
            Registered
          </span>
        )}
      </div>

      <div className="ffcs-options">
        {course.options.map((option) => {
          const key = `${course.course_id}-${option.professor_id}-${option.priority_rank}`;

          return (
            <OptionRow
              key={key}
              course={course}
              option={option}
              isRegistering={
                registeringKey === key
              }
              onRegister={() =>
                onRegister(course, option, key)
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// =========================================================
// FFCS PAGE
// =========================================================

function FFCSPage({ onBack }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [registeringKey, setRegisteringKey] =
    useState(null);
  const socketRef = useRef(null);

  // ---- Load the student's own priority-filtered options ----
  const loadOptions = useCallback(async () => {
    try {
      const data = await getFFCSOptions();
      setCourses(
        Array.isArray(data?.courses)
          ? data.courses
          : []
      );
    } catch (error) {
      console.error(
        "Failed to load FFCS options:",
        error
      );
      setStatus(
        "Unable to load your FFCS options. Generate a Pre-FFCS timetable first."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // ---- Live seat updates ----
  // Every second the backend nudges seats_remaining down on whatever
  // offerings students actually have in their FFCS options (plus real
  // registrations), and broadcasts the new count. We patch just the
  // matching offering in place so numbers visibly tick down live.
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on(
      "seats:update",
      ({ offering_id, seats_remaining, total_seats }) => {
        setCourses((prev) =>
          prev.map((course) => ({
            ...course,
            options: course.options.map(
              (option) => {
                const seats = option.seats.map(
                  (seat) =>
                    seat.offering_id ===
                    offering_id
                      ? {
                          ...seat,
                          seats_remaining,
                          total_seats,
                        }
                      : seat
                );

                return {
                  ...option,
                  seats,
                  full: seats.some(
                    (seat) =>
                      seat.seats_remaining <= 0
                  ),
                };
              }
            ),
          }))
        );
      }
    );

    return () => {
      socket.disconnect();
    };
  }, []);

  // ---- Register ----
  // A course's option can carry one or two real offering_ids (theory
  // and/or lab); both are registered against the same first-come-first-
  // serve endpoint. If either seat filled up in the meantime, that call
  // comes back "waitlisted" instead of "enrolled" -- surfaced as-is.
  const handleRegister = async (
    course,
    option,
    key
  ) => {
    setRegisteringKey(key);
    setStatus("");

    try {
      const offeringIds = [
        option.theory_offering_id,
        option.lab_offering_id,
      ].filter(Boolean);

      const results = [];
      for (const offeringId of offeringIds) {
        // eslint-disable-next-line no-await-in-loop
        const result = await registerOffering(
          offeringId
        );
        results.push(result);
      }

      const anyWaitlisted = results.some(
        (result) =>
          result.status === "waitlisted"
      );

      setStatus(
        anyWaitlisted
          ? `Added to the waitlist for ${course.course_name}.`
          : `Registered for ${course.course_name} with ${option.professor_name}.`
      );
    } catch (error) {
      console.error(
        "Registration failed:",
        error
      );

      setStatus(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          "Registration failed — that slot may have just clashed or filled up."
      );
    } finally {
      setRegisteringKey(null);
      loadOptions();
    }
  };

  return (
    <div className="ffcs-shell">
      <header className="ffcs-header">
        <button
          type="button"
          className="ffcs-back"
          onClick={onBack}
        >
          ← Home
        </button>

        <div className="ffcs-header-text">
          <div className="eyebrow">
            VIT VELLORE · LIVE FFCS
          </div>

          <h1>Register for your slots</h1>

          <p>
            Only the faculty you ranked in Pre-FFCS
            show up here, and anything that clashes
            with a slot you've already locked in is
            hidden automatically. Seats update live —
            it's genuinely first come, first served.
          </p>
        </div>
      </header>

      {status && (
        <div className="ffcs-status-message">
          {status}
        </div>
      )}

      {loading ? (
        <div className="ffcs-loading">
          Loading your FFCS options...
        </div>
      ) : courses.length === 0 ? (
        <div className="ffcs-empty">
          <div className="ffcs-empty-icon">
            □
          </div>

          <h2>
            Nothing to register for yet
          </h2>

          <p>
            Go to Pre-FFCS, rank your faculty
            preferences for each course, and
            generate a timetable first.
          </p>
        </div>
      ) : (
        <div className="ffcs-course-list">
          {courses.map((course) => (
            <CourseBlock
              key={course.course_id}
              course={course}
              registeringKey={registeringKey}
              onRegister={handleRegister}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default FFCSPage;
