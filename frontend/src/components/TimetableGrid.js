import React from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Column definitions: theory time + lab time + the slot codes
// that occupy that column, per day (matches VIT's real grid)
const COLUMNS = [
  { label: "P1", theoryTime: "08:00-08:50", labTime: "08:00-08:50" },
  { label: "P2", theoryTime: "09:00-09:50", labTime: "08:51-09:40" },
  { label: "P3", theoryTime: "10:00-10:50", labTime: "09:51-10:40" },
  { label: "P4", theoryTime: "11:00-11:50", labTime: "10:41-11:30" },
  { label: "P5", theoryTime: "12:00-12:50", labTime: "11:40-12:30" },
  { label: "P6", theoryTime: "-", labTime: "12:31-13:20" },
  { label: "P7", theoryTime: "14:00-14:50", labTime: "14:00-14:50" },
  { label: "P8", theoryTime: "15:00-15:50", labTime: "14:51-15:40" },
  { label: "P9", theoryTime: "16:00-16:50", labTime: "15:51-16:40" },
  { label: "P10", theoryTime: "17:00-17:50", labTime: "16:41-17:30" },
  { label: "P11", theoryTime: "18:00-18:50", labTime: "17:40-18:30" },
];

const DAY_THEORY = {
  Mon: ["A1", "F1", "D1", "TB1", "TG1", null, "A2", "F2", "D2", "TB2", "TG2"],
  Tue: ["B1", "G1", "E1", "TC1", "TAA1", null, "B2", "G2", "E2", "TC2", "TAA2"],
  Wed: ["C1", "A1", "F1", "V1", "V2", null, "C2", "A2", "F2", "TD2", "TBB2"],
  Thu: ["D1", "B1", "G1", "TE1", "TCC1", null, "D2", "B2", "G2", "TE2", "TCC2"],
  Fri: ["E1", "C1", "TA1", "TF1", "TD1", null, "E2", "C2", "TA2", "TF2", "TDD2"],
};

const DAY_LAB = {
  Mon: ["L1", "L2", "L3", "L4", "L5", "L6", "L31", "L32", "L33", "L34", "L35"],
  Tue: ["L7", "L8", "L9", "L10", "L11", "L12", "L37", "L38", "L39", "L40", "L41"],
  Wed: ["L13", "L14", "L15", "L16", "L17", "L18", "L43", "L44", "L45", "L46", "L47"],
  Thu: ["L19", "L20", "L21", "L22", "L23", "L24", "L49", "L50", "L51", "L52", "L53"],
  Fri: ["L25", "L26", "L27", "L28", "L29", "L30", "L55", "L56", "L57", "L58", "L59"],
};

// Muted, light color palette per course (no dark/purple/AI look)
const COURSE_COLORS = [
  { bg: "#EAF3FC", border: "#B7D6F0", text: "#2A5C8A" }, // light blue
  { bg: "#EDF7EE", border: "#BFE3C4", text: "#2F6B3A" }, // light green
  { bg: "#FDF3E7", border: "#F2D4A8", text: "#8A5A20" }, // light orange
  { bg: "#F6EEF9", border: "#DFC3E8", text: "#6B3A7A" }, // light purple
  { bg: "#FDECEC", border: "#F3BEBE", text: "#8A2F2F" }, // light red
  { bg: "#EFF6F6", border: "#C4E0E0", text: "#2F6B6B" }, // light teal
];

export default function TimetableGrid({ selections }) {
  // Build a lookup: atomic slot_code -> { courseName, professorName, colorIndex }
  const slotToCourse = {};
  selections.forEach((sel, idx) => {
    const color = COURSE_COLORS[idx % COURSE_COLORS.length];
    // slot_codes not directly available here; grid highlights by
    // matching course/professor name via a slotCodes prop instead
    (sel.slot_codes || []).forEach((code) => {
      slotToCourse[code] = {
        courseName: sel.course_name,
        professorName: sel.professor_name,
        color,
      };
    });
  });

  function renderCell(day, colIndex, type) {
    const code = type === "theory" ? DAY_THEORY[day][colIndex] : DAY_LAB[day][colIndex];
    if (!code) return <td style={styles.emptyCell}></td>;

    const match = slotToCourse[code];
    if (match) {
      return (
        <td
          style={{
            ...styles.filledCell,
            background: match.color.bg,
            borderColor: match.color.border,
          }}
        >
          <div style={{ ...styles.slotCode, color: match.color.text }}>{code}</div>
          <div style={{ ...styles.courseLabel, color: match.color.text }}>
            {match.courseName}
          </div>
          <div style={styles.profLabel}>{match.professorName}</div>
        </td>
      );
    }

    return (
      <td style={styles.openCell}>
        <div style={styles.slotCodeOpen}>{code}</div>
      </td>
    );
  }

  return (
    <div style={styles.wrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.cornerHeader}>Day</th>
            {COLUMNS.map((col) => (
              <th key={col.label} style={styles.colHeader}>
                <div style={styles.colLabel}>{col.label}</div>
                <div style={styles.colTime}>{col.theoryTime}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <React.Fragment key={day}>
              <tr>
                <td rowSpan={2} style={styles.dayCell}>
                  {day}
                </td>
                {COLUMNS.map((col, i) => (
                  <React.Fragment key={`theory-${day}-${i}`}>
                    {renderCell(day, i, "theory")}
                  </React.Fragment>
                ))}
              </tr>
              <tr>
                {COLUMNS.map((col, i) => (
                  <React.Fragment key={`lab-${day}-${i}`}>
                    {renderCell(day, i, "lab")}
                  </React.Fragment>
                ))}
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  wrapper: {
    overflowX: "auto",
    border: "1px solid #e2e4e8",
    borderRadius: "8px",
    background: "#ffffff",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontFamily: "inherit",
  },
  cornerHeader: {
    background: "#f7f8fa",
    border: "1px solid #e2e4e8",
    padding: "8px",
    fontSize: "12px",
    color: "#666",
    minWidth: "60px",
  },
  colHeader: {
    background: "#f7f8fa",
    border: "1px solid #e2e4e8",
    padding: "6px 8px",
    minWidth: "90px",
  },
  colLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#444",
  },
  colTime: {
    fontSize: "10px",
    color: "#999",
  },
  dayCell: {
    background: "#f7f8fa",
    border: "1px solid #e2e4e8",
    fontWeight: 600,
    fontSize: "13px",
    color: "#333",
    textAlign: "center",
    verticalAlign: "middle",
  },
  emptyCell: {
    border: "1px solid #eceef1",
    background: "#fcfcfd",
  },
  openCell: {
    border: "1px solid #eceef1",
    background: "#fcfcfd",
    padding: "4px",
    textAlign: "center",
  },
  slotCodeOpen: {
    fontSize: "11px",
    color: "#bbb",
  },
  filledCell: {
    border: "1px solid",
    padding: "4px 6px",
    textAlign: "center",
    verticalAlign: "middle",
  },
  slotCode: {
    fontSize: "10px",
    fontWeight: 700,
  },
  courseLabel: {
    fontSize: "11px",
    fontWeight: 600,
  },
  profLabel: {
    fontSize: "9px",
    color: "#777",
  },
};
