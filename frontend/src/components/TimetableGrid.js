import React from "react";
import "./TimetableGrid.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const COLUMNS = [
  {
    label: "P1",
    time: "08:00–08:50",
    theory: true,
    lab: "L1",
  },
  {
    label: "P2",
    time: "09:00–09:50",
    theory: true,
    lab: "L2",
  },
  {
    label: "P3",
    time: "10:00–10:50",
    theory: true,
    lab: "L3",
  },
  {
    label: "P4",
    time: "11:00–11:50",
    theory: true,
    lab: "L4",
  },
  {
    label: "P5",
    time: "12:00–12:50",
    theory: true,
    lab: "L5",
  },
  {
    label: "P6",
    time: "12:31–13:20",
    theory: false,
    lab: "L6",
  },
  {
    label: "BREAK",
    break: true,
  },
  {
    label: "P7",
    time: "14:00–14:50",
    theory: true,
    lab: "L31",
  },
  {
    label: "P8",
    time: "15:00–15:50",
    theory: true,
    lab: "L32",
  },
  {
    label: "P9",
    time: "16:00–16:50",
    theory: true,
    lab: "L33",
  },
  {
    label: "P10",
    time: "17:00–17:50",
    theory: true,
    lab: "L34",
  },
  {
    label: "P11",
    time: "18:00–18:50",
    theory: true,
    lab: "L35",
  },
  {
    label: "P12",
    time: "18:31–19:20",
    theory: false,
    lab: "L36",
  },
];

const DAY_THEORY = {
  Mon: [
    "A1",
    "F1",
    "D1",
    "TB1",
    "TG1",
    null,
    null,
    "A2",
    "F2",
    "D2",
    "TB2",
    "TG2",
  ],

  Tue: [
    "B1",
    "G1",
    "E1",
    "TC1",
    "TAA1",
    null,
    null,
    "B2",
    "G2",
    "E2",
    "TC2",
    "TAA2",
  ],

  Wed: [
    "C1",
    "A1",
    "F1",
    "V1",
    "V2",
    null,
    null,
    "C2",
    "A2",
    "F2",
    "TD2",
    "TBB2",
  ],

  Thu: [
    "D1",
    "B1",
    "G1",
    "TE1",
    "TCC1",
    null,
    null,
    "D2",
    "B2",
    "G2",
    "TE2",
    "TCC2",
  ],

  Fri: [
    "E1",
    "C1",
    "TA1",
    "TF1",
    "TD1",
    null,
    null,
    "E2",
    "C2",
    "TA2",
    "TF2",
    "TDD2",
  ],
};

const DAY_LAB = {
  Mon: [
    "L1",
    "L2",
    "L3",
    "L4",
    "L5",
    "L6",
    null,
    "L31",
    "L32",
    "L33",
    "L34",
    "L35",
  ],

  Tue: [
    "L7",
    "L8",
    "L9",
    "L10",
    "L11",
    "L12",
    null,
    "L37",
    "L38",
    "L39",
    "L40",
    "L41",
  ],

  Wed: [
    "L13",
    "L14",
    "L15",
    "L16",
    "L17",
    "L18",
    null,
    "L43",
    "L44",
    "L45",
    "L46",
    "L47",
  ],

  Thu: [
    "L19",
    "L20",
    "L21",
    "L22",
    "L23",
    "L24",
    null,
    "L49",
    "L50",
    "L51",
    "L52",
    "L53",
  ],

  Fri: [
    "L25",
    "L26",
    "L27",
    "L28",
    "L29",
    "L30",
    null,
    "L55",
    "L56",
    "L57",
    "L58",
    "L59",
  ],
};

/*
  Restrained course palette.

  These are intentionally warm / neutral.
  No purple, blue, neon or gradient.
*/
const COURSE_COLORS = [
  {
    background: "#F4EBDD",
    border: "#D7C6A7",
    text: "#68563A",
  },
  {
    background: "#E8EEE5",
    border: "#BCCAB8",
    text: "#4D6049",
  },
  {
    background: "#F2E3E0",
    border: "#D8BDB8",
    text: "#6D4A45",
  },
  {
    background: "#EAE9E4",
    border: "#CAC9C1",
    text: "#57564F",
  },
  {
    background: "#F3E8D9",
    border: "#DCC6A5",
    text: "#70563A",
  },
  {
    background: "#E9E8DD",
    border: "#C9C8B1",
    text: "#5C5D45",
  },
  {
    background: "#EFE9DF",
    border: "#D4C8B5",
    text: "#655B4B",
  },
];

function getFacultyShortName(name = "") {
  const parts = name.trim().split(/\s+/);

  if (!parts.length) return "";

  return parts[0];
}

function buildSlotLookup(selections) {
  const lookup = {};

  selections.forEach((selection, index) => {
    const color =
      COURSE_COLORS[index % COURSE_COLORS.length];

    (selection.slot_codes || []).forEach((slotCode) => {
      lookup[slotCode] = {
        courseName: selection.course_name,
        professorName: selection.professor_name,
        color,
      };
    });
  });

  return lookup;
}

function SlotCell({
  slotCode,
  type,
  match,
}) {
  if (!slotCode) {
    return (
      <td className="tt-empty-cell">
        <span className="tt-empty-slot">—</span>
      </td>
    );
  }

  if (!match) {
    return (
      <td className="tt-empty-cell">
        <span className="tt-slot-code">{slotCode}</span>
      </td>
    );
  }

  return (
    <td
      className="tt-filled-cell"
      style={{
        backgroundColor: match.color.background,
        borderColor: match.color.border,
      }}
    >
      <div
        className="tt-slot-code filled"
        style={{ color: match.color.text }}
      >
        {slotCode}
      </div>

      <div
        className="tt-course-name"
        style={{ color: match.color.text }}
        title={match.courseName}
      >
        {match.courseName}
      </div>

      <div className="tt-professor">
        {getFacultyShortName(match.professorName)}
      </div>

      <div className="tt-type">
        {type === "theory" ? "THEORY" : "LAB"}
      </div>
    </td>
  );
}

export default function TimetableGrid({
  selections = [],
}) {
  const slotLookup = buildSlotLookup(selections);

  return (
        <div className="timetable-wrapper" id="timetable-grid-capture">
        <div className="timetable-scroll">
        <table className="timetable">
          <thead>
            <tr>
              <th className="tt-day-header">
                <span>DAY</span>
              </th>

              {COLUMNS.map((column) => {
                if (column.break) {
                  return (
                    <th
                      key={column.label}
                      className="tt-break-header"
                    >
                      <span>BREAK</span>
                    </th>
                  );
                }

                return (
                  <th
                    key={column.label}
                    className="tt-column-header"
                  >
                    <div className="tt-column-label">
                      {column.label}
                    </div>

                    <div className="tt-column-time">
                      {column.time}
                    </div>

                    <div className="tt-column-slots">
                      {column.theory && "THEORY"}
                      {column.theory && column.lab && " · "}
                      {column.lab && "LAB"}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {DAYS.map((day) => (
              <React.Fragment key={day}>
                {/* THEORY ROW */}
                <tr>
                  <td
                    rowSpan={2}
                    className="tt-day-cell"
                  >
                    <span>{day.toUpperCase()}</span>
                  </td>

                  {COLUMNS.map((column, index) => {
                    if (column.break) {
                      return (
                        <td
                          key={`theory-break-${day}`}
                          rowSpan={2}
                          className="tt-break-cell"
                        >
                          <span />
                        </td>
                      );
                    }

                    const slotCode =
                      DAY_THEORY[day][
                        getColumnDataIndex(index)
                      ];

                    return (
                      <SlotCell
                        key={`theory-${day}-${index}`}
                        slotCode={slotCode}
                        type="theory"
                        match={slotLookup[slotCode]}
                      />
                    );
                  })}
                </tr>

                {/* LAB ROW */}
                <tr>
                  {COLUMNS.map((column, index) => {
                    if (column.break) {
                      return null;
                    }

                    const slotCode =
                      DAY_LAB[day][
                        getColumnDataIndex(index)
                      ];

                    return (
                      <SlotCell
                        key={`lab-${day}-${index}`}
                        slotCode={slotCode}
                        type="lab"
                        match={slotLookup[slotCode]}
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
          Theory
        </span>

        <span>
          <i className="key-lab" />
          Lab
        </span>

        <span className="key-note">
          VIT FFCS slot structure
        </span>
      </div>
    </div>
  );
}

/*
  The BREAK column exists visually in the table,
  but DAY_THEORY / DAY_LAB arrays don't contain
  an entry for it.

  Convert the visual column index to the actual
  VIT slot-array index.
*/
function getColumnDataIndex(columnIndex) {
  if (columnIndex <= 5) {
    return columnIndex;
  }

  return columnIndex - 1;
}