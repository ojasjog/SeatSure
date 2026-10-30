import React from "react";
import "./TimetableGrid.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const COLUMNS = [
  { label: "P1", time: "08:00", theory: true, lab: "L1" },
  { label: "P2", time: "09:00", theory: true, lab: "L2" },
  { label: "P3", time: "10:00", theory: true, lab: "L3" },
  { label: "P4", time: "11:00", theory: true, lab: "L4" },
  { label: "P5", time: "12:00", theory: true, lab: "L5" },
  { label: "P6", time: "12:31", theory: false, lab: "L6" },
  { label: "Lunch", break: true },
  { label: "P7", time: "14:00", theory: true, lab: "L31" },
  { label: "P8", time: "15:00", theory: true, lab: "L32" },
  { label: "P9", time: "16:00", theory: true, lab: "L33" },
  { label: "P10", time: "17:00", theory: true, lab: "L34" },
  { label: "P11", time: "18:00", theory: true, lab: "L35" },
  { label: "P12", time: "18:31", theory: false, lab: "L36" },
];

const DAY_THEORY = {
  Mon: ["A1", "F1", "D1", "TB1", "TG1", null, null, "A2", "F2", "D2", "TB2", "TG2"],
  Tue: ["B1", "G1", "E1", "TC1", "TAA1", null, null, "B2", "G2", "E2", "TC2", "TAA2"],
  Wed: ["C1", "A1", "F1", "V1", "V2", null, null, "C2", "A2", "F2", "TD2", "TBB2"],
  Thu: ["D1", "B1", "G1", "TE1", "TCC1", null, null, "D2", "B2", "G2", "TE2", "TCC2"],
  Fri: ["E1", "C1", "TA1", "TF1", "TD1", null, null, "E2", "C2", "TA2", "TF2", "TDD2"],
};

const DAY_LAB = {
  Mon: ["L1", "L2", "L3", "L4", "L5", "L6", null, "L31", "L32", "L33", "L34", "L35"],
  Tue: ["L7", "L8", "L9", "L10", "L11", "L12", null, "L37", "L38", "L39", "L40", "L41"],
  Wed: ["L13", "L14", "L15", "L16", "L17", "L18", null, "L43", "L44", "L45", "L46", "L47"],
  Thu: ["L19", "L20", "L21", "L22", "L23", "L24", null, "L49", "L50", "L51", "L52", "L53"],
  Fri: ["L25", "L26", "L27", "L28", "L29", "L30", null, "L55", "L56", "L57", "L58", "L59"],
};

export const COURSE_COLOR_COUNT = 7;

function getFacultyShortName(name = "") {
  const parts = name.trim().split(/\s+/);
  return parts.length ? parts[0] : "";
}

/*
  slot code -> { courseName, professorName, colorIndex, clashWith }
  If two courses claim the same slot, the cell is flagged as a clash.
*/
function buildSlotLookup(selections) {
  const lookup = {};

  selections.forEach((selection, index) => {
    const colorIndex =
      selection.color_index != null ? selection.color_index : index;

    (selection.slot_codes || []).forEach((slotCode) => {
      const existing = lookup[slotCode];
      if (existing && existing.courseName !== selection.course_name) {
        existing.clashWith = selection.course_name;
        return;
      }
      lookup[slotCode] = {
        courseName: selection.course_name,
        professorName: selection.professor_name,
        colorIndex: colorIndex % COURSE_COLOR_COUNT,
        clashWith: null,
      };
    });
  });

  return lookup;
}

function SlotCell({ slotCode, type, match, ghost, order }) {
  if (!slotCode) {
    return (
      <td className="tt-empty-cell tt-none">
        <span className="tt-empty-slot" aria-hidden="true" />
      </td>
    );
  }

  const ghostHere = ghost && ghost.slots.has(slotCode);
  const ghostClash =
    ghostHere && match && match.courseName !== ghost.courseName;

  if (!match) {
    return (
      <td
        className={`tt-empty-cell${ghostHere ? " tt-ghost" : ""}`}
        style={{ "--i": order }}
      >
        <span className="tt-slot-code">{slotCode}</span>
        {ghostHere && (
          <span className="tt-ghost-label">{ghost.courseName}</span>
        )}
      </td>
    );
  }

  const clash = !!match.clashWith || ghostClash;

  return (
    <td
      className={`tt-filled-cell cc-${match.colorIndex}${clash ? " tt-clash" : ""}`}
      style={{ "--i": order }}
      title={
        match.clashWith
          ? `${match.courseName} clashes with ${match.clashWith} on ${slotCode}`
          : ghostClash
          ? `${ghost.courseName} would clash with ${match.courseName} on ${slotCode}`
          : `${match.courseName} · ${match.professorName}`
      }
    >
      <div className="tt-slot-code filled">{slotCode}</div>
      <div className="tt-course-name">{match.courseName}</div>
      {clash ? (
        <div className="tt-clash-label">Clash</div>
      ) : (
        <div className="tt-professor">
          {getFacultyShortName(match.professorName)}
        </div>
      )}
    </td>
  );
}

/*
  Props
  - selections: [{ course_name, professor_name, slot_codes: [...], color_index? }]
  - ghost: optional { courseName, slots: string[] } — slots previewed on hover
  - animateKey: change it to replay the deal-in animation (e.g. option index)
  - compact: smaller cells (used for the live draft)
  - sweep: play a single sweep of light across the grid when it mounts
*/
export default function TimetableGrid({
  selections = [],
  ghost = null,
  animateKey = "static",
  compact = false,
  sweep = false,
}) {
  const slotLookup = buildSlotLookup(selections);
  const ghostSet = ghost
    ? { courseName: ghost.courseName, slots: new Set(ghost.slots || []) }
    : null;

  return (
    <div
      className={`timetable-wrapper${compact ? " compact" : ""}${sweep ? " sweep" : ""}`}
      id="timetable-grid-capture"
    >
      <div className="timetable-scroll">
        <table className="timetable">
          <thead>
            <tr>
              <th className="tt-day-header">
                <span className="sr-only">Day</span>
              </th>

              {COLUMNS.map((column) => {
                if (column.break) {
                  return (
                    <th key={column.label} className="tt-break-header">
                      <span>{column.label}</span>
                    </th>
                  );
                }

                return (
                  <th key={column.label} className="tt-column-header">
                    <div className="tt-column-label">{column.label}</div>
                    <div className="tt-column-time">{column.time}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody key={animateKey}>
            {DAYS.map((day, dayIndex) => (
              <React.Fragment key={day}>
                <tr className="tt-row-theory">
                  <td rowSpan={2} className="tt-day-cell">
                    <span>{day}</span>
                  </td>

                  {COLUMNS.map((column, index) => {
                    if (column.break) {
                      return dayIndex === 0 ? (
                        <td
                          key={`theory-break-${day}`}
                          rowSpan={DAYS.length * 2}
                          className="tt-break-cell"
                        >
                          <span />
                        </td>
                      ) : null;
                    }

                    const slotCode = DAY_THEORY[day][getColumnDataIndex(index)];

                    return (
                      <SlotCell
                        key={`theory-${day}-${index}`}
                        slotCode={slotCode}
                        type="theory"
                        match={slotLookup[slotCode]}
                        ghost={ghostSet}
                        order={dayIndex + index}
                      />
                    );
                  })}
                </tr>

                <tr className="tt-row-lab">
                  {COLUMNS.map((column, index) => {
                    if (column.break) return null;

                    const slotCode = DAY_LAB[day][getColumnDataIndex(index)];

                    return (
                      <SlotCell
                        key={`lab-${day}-${index}`}
                        slotCode={slotCode}
                        type="lab"
                        match={slotLookup[slotCode]}
                        ghost={ghostSet}
                        order={dayIndex + index + 1}
                      />
                    );
                  })}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="timetable-key">
        <span>
          <i className="key-theory" />
          Theory row
        </span>
        <span>
          <i className="key-lab" />
          Lab row
        </span>
        <span className="key-note">VIT FFCS slot structure</span>
      </div>
    </div>
  );
}

/*
  The lunch column exists visually in the table, but DAY_THEORY /
  DAY_LAB arrays don't contain an entry for it. Convert the visual
  column index to the slot-array index.
*/
function getColumnDataIndex(columnIndex) {
  return columnIndex <= 5 ? columnIndex : columnIndex - 1;
}
