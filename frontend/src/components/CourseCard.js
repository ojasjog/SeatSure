import React, { useEffect, useState } from "react";
import { getCourseProfessors } from "../api";

// One row per course: shows a dropdown-based ranking UI.
// The student picks their 1st, 2nd, 3rd choice professor for
// the theory section of this course (lab follows automatically
// since it's grouped by professor on the backend).
export default function CourseCard({ course, onRankChange, ranks }) {
  const [professors, setProfessors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCourseProfessors(course.course_id).then((data) => {
      // Deduplicate by professor (theory + lab rows collapse to one entry)
      const uniqueMap = new Map();
      data.forEach((row) => {
        if (!uniqueMap.has(row.professor_id)) {
          uniqueMap.set(row.professor_id, {
            professor_id: row.professor_id,
            name: row.name,
          });
        }
      });
      setProfessors(Array.from(uniqueMap.values()));
      setLoading(false);
    });
  }, [course.course_id]);

  const courseRanks = ranks[course.course_id] || {};

  function handleSelect(rankNum, professorId) {
    onRankChange(course.course_id, rankNum, professorId ? Number(professorId) : null);
  }

  const usedProfessorIds = Object.values(courseRanks).filter(Boolean);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>{course.course_name}</div>
      {loading ? (
        <div style={styles.loading}>Loading professors...</div>
      ) : (
        <div style={styles.rankRow}>
          {[1, 2, 3].map((rankNum) => (
            <div key={rankNum} style={styles.rankBlock}>
              <label style={styles.rankLabel}>Choice {rankNum}</label>
              <select
                style={styles.select}
                value={courseRanks[rankNum] || ""}
                onChange={(e) => handleSelect(rankNum, e.target.value)}
              >
                <option value="">-- Select --</option>
                {professors.map((p) => (
                  <option
                    key={p.professor_id}
                    value={p.professor_id}
                    disabled={
                      usedProfessorIds.includes(p.professor_id) &&
                      courseRanks[rankNum] !== p.professor_id
                    }
                  >
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "#ffffff",
    border: "1px solid #e2e4e8",
    borderRadius: "8px",
    padding: "16px 20px",
    marginBottom: "14px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  cardHeader: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#1a1a1a",
    marginBottom: "12px",
  },
  loading: {
    fontSize: "13px",
    color: "#888",
  },
  rankRow: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  },
  rankBlock: {
    display: "flex",
    flexDirection: "column",
    minWidth: "160px",
  },
  rankLabel: {
    fontSize: "12px",
    color: "#666",
    marginBottom: "4px",
  },
  select: {
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid #d5d8dd",
    fontSize: "13px",
    background: "#fafbfc",
    color: "#1a1a1a",
  },
};
