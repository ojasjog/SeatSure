import React, { useEffect, useMemo, useState } from "react";
import {
  getCourses,
  getCourseProfessors,
  savePreferences,
  generateTimetable,
} from "./api";
import "./App.css";

const STUDENT_ID = 1;

function App() {
  const [courses, setCourses] = useState([]);
  const [professors, setProfessors] = useState({});
  const [coursePriorities, setCoursePriorities] = useState({});
  const [openCourses, setOpenCourses] = useState({});
  const [searches, setSearches] = useState({});

  const [timetables, setTimetables] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [loadingCourses, setLoadingCourses] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");

  // =========================================================
  // LOAD COURSES
  // =========================================================

  useEffect(() => {
    const loadCourses = async () => {
      try {
        setLoadingCourses(true);

        const data = await getCourses();

        setCourses(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Failed to load courses:", error);
        setStatus("Unable to load courses.");
      } finally {
        setLoadingCourses(false);
      }
    };

    loadCourses();
  }, []);

  // =========================================================
  // SLOT HELPERS
  // =========================================================

  const getLabNumber = (slotCodes) => {
    const match = String(slotCodes || "").match(/L(\d+)/i);

    if (!match) {
      return null;
    }

    return Number(match[1]);
  };

  const isMorningLab = (slotCodes) => {
    const number = getLabNumber(slotCodes);

    if (number === null) {
      return false;
    }

    return number <= 30;
  };

  const isMorningTheory = (slotCodes) => {
    const first = String(slotCodes || "")
      .split("+")[0]
      .trim()
      .toUpperCase();

    /*
     * VIT theory slot convention:
     *
     * A1, B1, C1, D1, E1, F1...
     * = morning
     *
     * A2, B2, C2, D2, E2, F2...
     * = evening
     */

    return first.endsWith("1");
  };

  // =========================================================
  // LOAD FACULTY + CREATE SEPARATE SLOT OPTIONS
  // =========================================================

  const loadProfessors = async (course) => {
    const courseId = Number(course.course_id);

    if (professors[courseId]) {
      return;
    }

    try {
      const data = await getCourseProfessors(courseId);

      if (!Array.isArray(data)) {
        setProfessors((prev) => ({
          ...prev,
          [courseId]: [],
        }));

        return;
      }

      /*
       * IMPORTANT
       *
       * We DO NOT deduplicate only by professor_id.
       *
       * The same teacher can have two valid choices:
       *
       * ROHIT MATHUR
       * E1+TE1 → L35+L36
       *
       * ROHIT MATHUR
       * E2+TE2 → L27+L28
       *
       * These must remain TWO separate options.
       */

      const facultyMap = new Map();

      data.forEach((row) => {
        const professorId = Number(row.professor_id);

        if (!facultyMap.has(professorId)) {
          facultyMap.set(professorId, {
            professor_id: professorId,
            name: row.name,
            theory: [],
            lab: [],
          });
        }

        const faculty = facultyMap.get(professorId);

        const slotCodes = String(
          row.slot_codes || ""
        ).trim();

        if (!slotCodes) {
          return;
        }

        const courseType = String(
          row.course_type || ""
        ).toLowerCase();

        const offering = {
          offering_id: Number(row.offering_id),
          slot_codes: slotCodes,
        };

        if (courseType === "lab") {
          faculty.lab.push(offering);
        } else {
          faculty.theory.push(offering);
        }
      });

      const options = [];

      /*
       * Build valid theory + lab combinations.
       *
       * Valid:
       *
       * Morning theory + Evening lab
       *
       * OR
       *
       * Evening theory + Morning lab
       */

      facultyMap.forEach((faculty) => {
        faculty.theory.forEach((theory) => {
          faculty.lab.forEach((lab) => {
            const theoryMorning = isMorningTheory(
              theory.slot_codes
            );

            const labMorning = isMorningLab(
              lab.slot_codes
            );

            const validCombination =
              (theoryMorning && !labMorning) ||
              (!theoryMorning && labMorning);

            if (!validCombination) {
              return;
            }

            options.push({
              id: `${faculty.professor_id}-${theory.offering_id}-${lab.offering_id}`,

              professor_id: faculty.professor_id,

              name: faculty.name,

              theory_offering_id:
                theory.offering_id,

              lab_offering_id:
                lab.offering_id,

              theory_slots:
                theory.slot_codes,

              lab_slots:
                lab.slot_codes,

              slot_display:
                `${theory.slot_codes} → ${lab.slot_codes}`,
            });
          });
        });
      });

      /*
       * Sort:
       *
       * Faculty name first
       * Then morning/evening theory
       */

      options.sort((a, b) => {
        const nameCompare = String(
          a.name || ""
        ).localeCompare(String(b.name || ""));

        if (nameCompare !== 0) {
          return nameCompare;
        }

        return String(
          a.theory_slots || ""
        ).localeCompare(
          String(b.theory_slots || "")
        );
      });

      setProfessors((prev) => ({
        ...prev,
        [courseId]: options,
      }));
    } catch (error) {
      console.error(
        `Failed to load professors for course ${courseId}:`,
        error
      );

      setProfessors((prev) => ({
        ...prev,
        [courseId]: [],
      }));
    }
  };

  // =========================================================
  // TOGGLE COURSE
  // =========================================================

  const toggleCourse = async (course) => {
    const courseId = Number(course.course_id);

    const isOpen = !!openCourses[courseId];

    setOpenCourses((prev) => ({
      ...prev,
      [courseId]: !isOpen,
    }));

    if (!isOpen) {
      await loadProfessors(course);
    }
  };

  // =========================================================
  // ADD PRIORITY
  // =========================================================

  const addPriority = (course, option) => {
    const courseId = Number(course.course_id);

    const current =
      coursePriorities[courseId] || [];

    /*
     * The option ID includes:
     *
     * professor + theory offering + lab offering
     *
     * Therefore the same teacher can be added twice
     * if the slot combination is different.
     */

    const alreadyAdded = current.some(
      (item) => item.option_id === option.id
    );

    if (alreadyAdded) {
      return;
    }

    const newPriority = {
      id: `${option.id}-${Date.now()}`,

      option_id: option.id,

      course_id: courseId,

      professor_id: Number(
        option.professor_id
      ),

      professor_name: option.name,

      theory_offering_id:
        option.theory_offering_id,

      lab_offering_id:
        option.lab_offering_id,

      theory_slots:
        option.theory_slots,

      lab_slots:
        option.lab_slots,

      slot_display:
        option.slot_display,
    };

    setCoursePriorities((prev) => ({
      ...prev,

      [courseId]: [
        ...(prev[courseId] || []),
        newPriority,
      ],
    }));

    setStatus("");
  };

  // =========================================================
  // REMOVE PRIORITY
  // =========================================================

  const removePriority = (
    courseId,
    priorityId
  ) => {
    setCoursePriorities((prev) => ({
      ...prev,

      [courseId]: (
        prev[courseId] || []
      ).filter(
        (item) => item.id !== priorityId
      ),
    }));
  };

  // =========================================================
  // CLEAR ALL
  // =========================================================

  const clearAll = () => {
    setCoursePriorities({});
    setTimetables([]);
    setSelectedIndex(0);
    setStatus("");
  };

  // =========================================================
  // CLEAR COURSE
  // =========================================================

  const clearCourse = (courseId) => {
    setCoursePriorities((prev) => ({
      ...prev,
      [courseId]: [],
    }));
  };

  // =========================================================
  // DRAG START
  // =========================================================

  const handleDragStart = (
    event,
    courseId,
    index
  ) => {
    event.dataTransfer.setData(
      "courseId",
      String(courseId)
    );

    event.dataTransfer.setData(
      "priorityIndex",
      String(index)
    );

    event.dataTransfer.effectAllowed = "move";
  };

  // =========================================================
  // DRAG OVER
  // =========================================================

  const handleDragOver = (event) => {
    event.preventDefault();

    event.dataTransfer.dropEffect = "move";
  };

  // =========================================================
  // DROP
  // =========================================================

  const handleDrop = (
    event,
    courseId,
    targetIndex
  ) => {
    event.preventDefault();

    const sourceCourseId = Number(
      event.dataTransfer.getData("courseId")
    );

    const sourceIndex = Number(
      event.dataTransfer.getData(
        "priorityIndex"
      )
    );

    if (
      sourceCourseId !== Number(courseId) ||
      Number.isNaN(sourceIndex) ||
      sourceIndex === targetIndex
    ) {
      return;
    }

    setCoursePriorities((prev) => {
      const current = [
        ...(prev[courseId] || []),
      ];

      if (
        sourceIndex < 0 ||
        sourceIndex >= current.length
      ) {
        return prev;
      }

      const [moved] =
        current.splice(sourceIndex, 1);

      current.splice(
        targetIndex,
        0,
        moved
      );

      return {
        ...prev,
        [courseId]: current,
      };
    });
  };

  // =========================================================
  // SEARCH
  // =========================================================

  const updateSearch = (
    courseId,
    value
  ) => {
    setSearches((prev) => ({
      ...prev,
      [courseId]: value,
    }));
  };

  // =========================================================
  // TOTAL PRIORITIES
  // =========================================================

  const totalPriorities = useMemo(() => {
    return Object.values(
      coursePriorities
    ).reduce(
      (total, list) =>
        total +
        (Array.isArray(list)
          ? list.length
          : 0),
      0
    );
  }, [coursePriorities]);

  // =========================================================
  // GENERATE
  // =========================================================

  const handleGenerate = async () => {
    if (totalPriorities === 0) {
      setStatus(
        "Add at least one faculty preference first."
      );

      return;
    }

    try {
      setGenerating(true);

      setStatus(
        "Generating timetables..."
      );

      /*
       * The frontend now keeps the exact selected
       * theory/lab option.
       *
       * NOTE:
       * The current backend preference API accepts
       * course_id + professor_id + priority_rank.
       *
       * The offering-aware backend change is required
       * if the final timetable must distinguish two
       * options belonging to the same professor.
       */

      const preferences = [];

      Object.entries(
        coursePriorities
      ).forEach(
        ([courseId, priorities]) => {
          priorities.forEach(
            (item, index) => {
              preferences.push({
                course_id:
                  Number(courseId),

                professor_id:
                  Number(
                    item.professor_id
                  ),

                priority_rank:
                  index + 1,
              });
            }
          );
        }
      );

      await savePreferences(
        STUDENT_ID,
        preferences
      );

      const result =
        await generateTimetable(
          STUDENT_ID
        );

      const generated =
        Array.isArray(
          result?.timetables
        )
          ? result.timetables
          : [];

      setTimetables(generated);

      setSelectedIndex(0);

      if (generated.length === 0) {
        setStatus(
          "No clash-free timetable was found."
        );
      } else {
        setStatus("");
      }
    } catch (error) {
      console.error(
        "Timetable generation failed:",
        error
      );

      setTimetables([]);

      setSelectedIndex(0);

      setStatus(
        error?.response?.data?.message ||
          "Unable to generate timetable."
      );
    } finally {
      setGenerating(false);
    }
  };

  // =========================================================
  // CURRENT RESULT
  // =========================================================

  const currentTimetable =
    timetables.length > 0
      ? timetables[selectedIndex]
      : null;

  // =========================================================
  // COURSE SECTION
  // =========================================================

  const CourseSection = ({
    course,
  }) => {
    const courseId = Number(
      course.course_id
    );

    const isOpen =
      !!openCourses[courseId];

    const facultyOptions =
      professors[courseId] || [];

    const priorities =
      coursePriorities[courseId] || [];

    const searchValue =
      searches[courseId] || "";

    const filteredOptions =
      facultyOptions.filter(
        (option) =>
          String(option.name || "")
            .toLowerCase()
            .includes(
              searchValue
                .trim()
                .toLowerCase()
            )
      );

    return (
      <div className="course-section">

        {/* COURSE HEADER */}

        <button
          type="button"
          className="course-header"
          onClick={() =>
            toggleCourse(course)
          }
        >
          <div className="course-header-left">
            <div className="course-code">
              {course.course_code ||
                course.code ||
                "COURSE"}
            </div>

            <div className="course-title">
              {course.course_name ||
                course.name}
            </div>
          </div>

          <div className="course-header-right">
            {priorities.length >
              0 && (
              <span className="course-selected-count">
                {priorities.length}
              </span>
            )}

            <span
              className={`course-chevron ${
                isOpen
                  ? "open"
                  : ""
              }`}
            >
              ›
            </span>
          </div>
        </button>

        {/* COURSE BODY */}

        {isOpen && (
          <div className="course-body">

            {/* PRIORITY HEADER */}

            <div className="priority-label">
              <span>
                Faculty priorities
              </span>

              {priorities.length >
                0 && (
                <span className="priority-help">
                  Drag to reorder
                </span>
              )}
            </div>

            {/* SELECTED PRIORITIES */}

            {priorities.length >
            0 ? (
              <div className="priority-list">
                {priorities.map(
                  (
                    item,
                    index
                  ) => (
                    <div
                      key={
                        item.id
                      }
                      className="priority-item"
                      draggable
                      onDragStart={(
                        event
                      ) =>
                        handleDragStart(
                          event,
                          courseId,
                          index
                        )
                      }
                      onDragOver={
                        handleDragOver
                      }
                      onDrop={(
                        event
                      ) =>
                        handleDrop(
                          event,
                          courseId,
                          index
                        )
                      }
                    >
                      <div className="priority-number">
                        P
                        {index + 1}
                      </div>

                      <div className="priority-content">
                        <div className="priority-professor">
                          {
                            item.professor_name
                          }
                        </div>

                        <div className="priority-slots">
                          {
                            item.slot_display
                          }
                        </div>
                      </div>

                      <button
                        type="button"
                        className="priority-remove"
                        onClick={() =>
                          removePriority(
                            courseId,
                            item.id
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="no-priority">
                No faculty selected yet.
              </div>
            )}

            {/* SEARCH */}

            <div className="faculty-search">
              <span className="search-icon">
                ⌕
              </span>

              <input
                type="text"
                placeholder="Search faculty..."
                value={
                  searchValue
                }
                onChange={(
                  event
                ) =>
                  updateSearch(
                    courseId,
                    event.target
                      .value
                  )
                }
              />

              {searchValue && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() =>
                    updateSearch(
                      courseId,
                      ""
                    )
                  }
                >
                  ×
                </button>
              )}
            </div>

            {/* FACULTY OPTIONS */}

            {facultyOptions.length ===
            0 ? (
              <div className="faculty-loading">
                Loading faculty...
              </div>
            ) : filteredOptions.length ===
              0 ? (
              <div className="faculty-empty">
                No faculty found
                {searchValue
                  ? ` for "${searchValue}"`
                  : ""}
                .
              </div>
            ) : (
              <div className="faculty-results">
                {filteredOptions.map(
                  (option) => {
                    const alreadyAdded =
                      priorities.some(
                        (item) =>
                          item.option_id ===
                          option.id
                      );

                    return (
                      <button
                        type="button"
                        key={
                          option.id
                        }
                        className="faculty-result"
                        disabled={
                          alreadyAdded
                        }
                        onClick={() =>
                          addPriority(
                            course,
                            option
                          )
                        }
                      >
                        <div>
                          <strong>
                            {
                              option.name
                            }
                          </strong>

                          <small>
                            {
                              option.slot_display
                            }
                          </small>
                        </div>

                        <span className="add-symbol">
                          {alreadyAdded
                            ? "✓"
                            : "+"}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>
            )}

            {/* CLEAR COURSE */}

            {priorities.length >
              0 && (
              <button
                type="button"
                className="clear-button course-clear-button"
                onClick={() =>
                  clearCourse(
                    courseId
                  )
                }
              >
                Clear this subject
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // =========================================================
  // RESULT
  // =========================================================

  const TimetableResult = ({
    timetable,
  }) => {
    const selections =
      timetable?.selections || [];

    return (
      <div className="timetable-result">

        <div className="result-topbar">
          <div>
            <div className="result-label">
              TIMETABLE
            </div>

            <h2>
              Option{" "}
              {selectedIndex + 1}

              <span className="result-total">
                {" "}
                /{" "}
                {timetables.length}
              </span>
            </h2>
          </div>

          <div className="result-navigation">
            <button
              type="button"
              className="nav-button"
              disabled={
                selectedIndex ===
                0
              }
              onClick={() =>
                setSelectedIndex(
                  (prev) =>
                    Math.max(
                      0,
                      prev - 1
                    )
                )
              }
            >
              ← Prev
            </button>

            <button
              type="button"
              className="nav-button"
              disabled={
                selectedIndex ===
                timetables.length -
                  1
              }
              onClick={() =>
                setSelectedIndex(
                  (prev) =>
                    Math.min(
                      timetables.length -
                        1,
                      prev + 1
                    )
                )
              }
            >
              Next →
            </button>
          </div>
        </div>

        <div className="result-stats">
          <div className="stat">
            <span className="stat-value">
              {
                selections.length
              }
            </span>

            <span className="stat-label">
              Courses
            </span>
          </div>

          <div className="stat">
            <span className="stat-value">
              {timetable?.rankSum ??
                "—"}
            </span>

            <span className="stat-label">
              Priority score
            </span>
          </div>
        </div>

        <div className="assigned-faculty">
          <div className="assigned-title">
            ASSIGNED FACULTY
          </div>

          <div className="assigned-list">
            {selections.map(
              (
                selection,
                index
              ) => (
                <div
                  className="assigned-item"
                  key={`${selection.course_id}-${selection.professor_id}-${index}`}
                >
                  <div className="assigned-course">
                    {
                      selection.course_name
                    }
                  </div>

                  <div className="assigned-professor">
                    {
                      selection.professor_name
                    }
                  </div>

                  {selection.slot_codes && (
                    <div className="assigned-slots">
                      {
                        selection.slot_codes
                      }
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div className="timetable-placeholder">
          <div className="placeholder-title">
            Timetable grid
          </div>

          <div className="placeholder-text">
            Your generated timetable
            will appear here.
          </div>
        </div>
      </div>
    );
  };

  // =========================================================
  // EMPTY STATE
  // =========================================================

  const EmptyState = () => (
    <div className="empty-state">
      <div className="empty-icon">
        □
      </div>

      <h2>
        Your timetable will appear here
      </h2>

      <p>
        Select faculty in order of
        preference for each subject,
        then generate your
        clash-free timetable.
      </p>
    </div>
  );

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="app-shell">

      {/* SIDEBAR */}

      <aside className="sidebar">

        <div className="brand">
          <div className="brand-mark">
            S
          </div>

          <div>
            <div className="brand-name">
              SeatSure
            </div>

            <div className="brand-subtitle">
              Pre-FFCS Planner
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading">
            SELECTIONS
          </div>

          <div className="priority-count">
            {totalPriorities} faculty selected
          </div>

          {totalPriorities >
            0 && (
            <button
              type="button"
              className="clear-button"
              onClick={clearAll}
            >
              Clear all
            </button>
          )}
        </div>

        <div className="sidebar-section courses-sidebar">
          <div className="sidebar-heading">
            COURSES
          </div>

          {loadingCourses ? (
            <div className="sidebar-loading">
              Loading courses...
            </div>
          ) : courses.length ===
            0 ? (
            <div className="sidebar-loading">
              No courses available.
            </div>
          ) : (
            <div className="course-list">
              {courses.map(
                (course) => (
                  <CourseSection
                    key={
                      course.course_id
                    }
                    course={
                      course
                    }
                  />
                )
              )}
            </div>
          )}
        </div>
      </aside>

      {/* MAIN */}

      <main className="main-content">

        <header className="main-header">
          <div>
            <div className="eyebrow">
              VIT VELLORE
            </div>

            <h1>
              Build your timetable
            </h1>

            <p>
              Choose faculty preferences
              for each subject and find
              compatible timetable
              combinations.
            </p>
          </div>

          <button
            type="button"
            className="generate-button"
            onClick={
              handleGenerate
            }
            disabled={
              generating ||
              totalPriorities ===
                0
            }
          >
            {generating ? (
              <>
                <span className="button-spinner" />
                Generating...
              </>
            ) : (
              <>
                Generate timetable
                <span className="button-arrow">
                  →
                </span>
              </>
            )}
          </button>
        </header>

        {status && (
          <div className="status-message">
            {status}
          </div>
        )}

        <section className="workspace">
          {currentTimetable ? (
            <TimetableResult
              timetable={
                currentTimetable
              }
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;