import React, { useEffect, useState } from "react";
import { getCourses, savePreferences, generateTimetable } from "./api";
import CourseCard from "./components/CourseCard";
import TimetableGrid from "./components/TimetableGrid";

const STUDENT_ID = 1; // hardcoded test student for demo purposes

export default function App() {
  const [courses, setCourses] = useState([]);
  const [ranks, setRanks] = useState({}); // { courseId: { 1: profId, 2: profId, 3: profId } }
  const [timetables, setTimetables] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getCourses().then(setCourses);
  }, []);

  function handleRankChange(courseId, rankNum, professorId) {
    setRanks((prev) => ({
      ...prev,
      [courseId]: {
        ...prev[courseId],
        [rankNum]: professorId,
      },
    }));
  }

  async function handleGenerate() {
    setStatus("Saving preferences...");

    const preferences = [];
    Object.entries(ranks).forEach(([courseId, rankObj]) => {
      Object.entries(rankObj).forEach(([rankNum, professorId]) => {
        if (professorId) {
          preferences.push({
            course_id: Number(courseId),
            professor_id: professorId,
            priority_rank: Number(rankNum),
          });
        }
      });
    });

    if (preferences.length === 0) {
      setStatus("Please select at least one professor preference first.");
      return;
    }

    try {
      await savePreferences(STUDENT_ID, preferences);
      setStatus("Generating clash-free timetables...");
      const result = await generateTimetable(STUDENT_ID);
      setTimetables(result.timetables || []);
      setSelectedIndex(0);
      setStatus(
        result.timetables.length > 0
          ? `Found ${result.timetables.length} clash-free option(s).`
          : "No clash-free combination found with these preferences."
      );
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong. Check the backend console.");
    }
  }

  const currentTimetable = timetables[selectedIndex];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>SeatSure — Pre-FFCS Timetable Builder</h1>
        <p style={styles.subtitle}>
          Rank your preferred professors per course, then generate all clash-free timetable options.
        </p>
      </header>

      <div style={styles.container}>
        <div style={styles.leftPanel}>
          <h2 style={styles.sectionTitle}>Your Course Preferences</h2>
          {courses.map((course) => (
            <CourseCard
              key={course.course_id}
              course={course}
              ranks={ranks}
              onRankChange={handleRankChange}
            />
          ))}
          <button style={styles.generateBtn} onClick={handleGenerate}>
            Generate Clash-Free Timetable
          </button>
          {status && <div style={styles.status}>{status}</div>}
        </div>

        <div style={styles.rightPanel}>
          <h2 style={styles.sectionTitle}>Generated Timetable</h2>

          {timetables.length > 1 && (
            <div style={styles.tabRow}>
              {timetables.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  style={{
                    ...styles.tab,
                    ...(i === selectedIndex ? styles.tabActive : {}),
                  }}
                >
                  Option {i + 1}
                </button>
              ))}
            </div>
          )}

          {currentTimetable ? (
            <>
              <TimetableGrid selections={currentTimetable.selections} />
              <div style={styles.summary}>
                <strong>Assigned Professors:</strong>
                <ul style={styles.summaryList}>
                  {currentTimetable.selections.map((sel) => (
                    <li key={sel.course_id}>
                      {sel.course_name} — {sel.professor_name} (Choice #{sel.priority_rank})
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              Set your preferences on the left and click "Generate" to see your timetable here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    background: "#ffffff",
    borderBottom: "1px solid #e2e4e8",
    padding: "20px 32px",
  },
  title: {
    margin: 0,
    fontSize: "22px",
    color: "#1a1a1a",
  },
  subtitle: {
    margin: "6px 0 0",
    fontSize: "13px",
    color: "#666",
  },
  container: {
    display: "flex",
    gap: "24px",
    padding: "24px 32px",
    alignItems: "flex-start",
  },
  leftPanel: {
    flex: "0 0 380px",
  },
  rightPanel: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: "15px",
    color: "#333",
    marginBottom: "12px",
  },
  generateBtn: {
    width: "100%",
    padding: "12px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "8px",
  },
  status: {
    marginTop: "10px",
    fontSize: "13px",
    color: "#555",
  },
  tabRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
  },
  tab: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #d5d8dd",
    background: "#fff",
    fontSize: "12px",
    cursor: "pointer",
    color: "#555",
  },
  tabActive: {
    background: "#2563eb",
    color: "#fff",
    borderColor: "#2563eb",
  },
  summary: {
    marginTop: "16px",
    background: "#ffffff",
    border: "1px solid #e2e4e8",
    borderRadius: "8px",
    padding: "14px 18px",
    fontSize: "13px",
    color: "#333",
  },
  summaryList: {
    margin: "8px 0 0",
    paddingLeft: "18px",
  },
  emptyState: {
    padding: "40px",
    textAlign: "center",
    color: "#999",
    fontSize: "13px",
    background: "#ffffff",
    border: "1px dashed #d5d8dd",
    borderRadius: "8px",
  },
};
