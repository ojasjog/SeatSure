import React, { useEffect, useMemo, useState } from "react";
import {
  getCourses,
  getCourseProfessors,
  savePreferences,
  submitPreferences,
  getMyPreferences,
  generateTimetable,
  getMe,
  TOKEN_KEY,
  resetMyFFCS, // add this
} from "./api";
import Login from "./components/Login";
import Landing from "./components/Landing";
import TimetableGrid, { COURSE_COLOR_COUNT } from "./components/TimetableGrid";
import FFCSPage from "./components/FFCSPage";
import WaitlistPage from "./components/Waitlist";
import ReviewsPage from "./components/ReviewsPage";
import ThemeToggle from "./components/ThemeToggle";
import html2canvas from "html2canvas";
import "./App.css";

// Course colours live in theme.css as .cc-0 … .cc-6 so they follow
// the day/night theme. This returns the class for a course index.
function courseColorClass(index) {
  return `cc-${index % COURSE_COLOR_COUNT}`;
}

// "A1+TA1 → L31+L32" -> ["A1", "TA1", "L31", "L32"]
function parseSlotCodes(display) {
  if (!display) return [];
  return String(display)
    .split(/\+|→|\/|,/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function optionSlotCodes(option) {
  if (!option) return [];
  const fromParts = [
    ...parseSlotCodes(option.theory_slots),
    ...parseSlotCodes(option.lab_slots),
  ];
  const codes = fromParts.length ? fromParts : parseSlotCodes(option.slot_display);
  return Array.from(new Set(codes));
}



// =========================================================
// SLOT HELPERS
// =========================================================

const getLabNumbers = (slotCodes) => {
  if (!slotCodes) return [];

  return String(slotCodes)
    .split("+")
    .map((slot) => slot.trim())
    .filter(Boolean)
    .map((slot) => {
      const match = slot.match(/^L(\d+)$/i);
      return match ? Number(match[1]) : null;
    })
    .filter((number) => number !== null);
};

const isMorningLab = (slotCodes) => {
  const numbers = getLabNumbers(slotCodes);

  if (numbers.length === 0) {
    return false;
  }

  return numbers.every((number) => number <= 30);
};

const isEveningLab = (slotCodes) => {
  const numbers = getLabNumbers(slotCodes);

  if (numbers.length === 0) {
    return false;
  }

  return numbers.every((number) => number > 30);
};

const isMorningTheory = (slotCodes) => {
  if (!slotCodes) return false;

  const first = String(slotCodes)
    .split("+")[0]
    .trim()
    .toUpperCase();

  return first.endsWith("1");
};

const isEveningTheory = (slotCodes) => {
  if (!slotCodes) return false;

  const first = String(slotCodes)
    .split("+")[0]
    .trim()
    .toUpperCase();

  return first.endsWith("2");
};

// =========================================================
// COURSE TYPE HELPERS
// =========================================================

const normalizeCourseType = (courseType) => {
  if (!courseType) return "";

  return String(courseType)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

const isLabType = (courseType) => {
  const type = normalizeCourseType(courseType);

  return (
    type === "lab" ||
    type === "laboratory" ||
    type === "lab only" ||
    type.includes("lab only")
  );
};

const isTheoryType = (courseType) => {
  const type = normalizeCourseType(courseType);

  return (
    type === "theory" ||
    type === "theory only" ||
    type.includes("theory only")
  );
};

const isTheoryLabType = (courseType) => {
  const type = normalizeCourseType(courseType);

  return (
    type.includes("theory + lab") ||
    type.includes("theory+lab") ||
    type.includes("theory and lab") ||
    type === "theory/lab"
  );
};

// =========================================================
// COURSE SECTION
// IMPORTANT:
// This component is OUTSIDE App so it does not remount
// every time the search input changes.
// =========================================================

function CourseSection({
  course,
  professors,
  coursePriorities,
  openCourses,
  searches,
  toggleCourse,
  addPriority,
  removePriority,
  clearCourse,
  updateSearch,
  handleDragStart,
  handleDragOver,
  handleDrop,
  occupiedSlots = {},
  setHoverPreview = () => {},
}) {
  const courseId = Number(course.course_id);

  const courseName = course.course_name || course.name;

  // Which other course (if any) already holds one of this option's slots
  // through its first-choice professor.
  const clashFor = (option) => {
    for (const code of optionSlotCodes(option)) {
      const holder = occupiedSlots[code];
      if (holder && holder.courseId !== courseId) return holder.courseName;
    }
    return null;
  };

  const previewOption = (option) =>
    setHoverPreview({
      courseId,
      courseName,
      slots: optionSlotCodes(option),
    });

  const clearPreview = () => setHoverPreview(null);

  const isOpen = !!openCourses[courseId];

  const facultyOptions =
    professors[courseId] || [];

  const priorities =
    coursePriorities[courseId] || [];

  const searchValue =
    searches[courseId] || "";

  const filteredOptions =
    facultyOptions.filter((option) =>
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
        onClick={() => toggleCourse(course)}
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
          {priorities.length > 0 && (
            <span className="course-selected-count">
              {priorities.length}
            </span>
          )}

          <span
            className={`course-chevron ${
              isOpen ? "open" : ""
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

            {priorities.length > 0 && (
              <span className="priority-help">
                Drag to reorder
              </span>
            )}
          </div>

          {/* SELECTED PRIORITIES */}

          {priorities.length > 0 ? (
            <div className="priority-list">
              {priorities.map(
                (item, index) => (
                  <div
                    key={item.id}
                    className="priority-item"
                    draggable
                    onDragStart={(event) =>
                      handleDragStart(
                        event,
                        courseId,
                        index
                      )
                    }
                    onDragOver={
                      handleDragOver
                    }
                    onDrop={(event) =>
                      handleDrop(
                        event,
                        courseId,
                        index
                      )
                    }
                  >
                    <div className="priority-number" title={`Choice ${index + 1}`}>
                      {index + 1}
                    </div>

                    <div className="priority-content">
                      <div className="priority-professor">
                        {item.professor_name}
                      </div>

                      <div className="priority-slots">
                        {item.slot_display}
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
              value={searchValue}
              onChange={(event) =>
                updateSearch(
                  courseId,
                  event.target.value
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

          {facultyOptions.length === 0 ? (
            <div className="faculty-loading">
              Loading faculty...
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="faculty-empty">
              No faculty found
              {searchValue
                ? ` for "${searchValue}"`
                : ""}
              .
            </div>
          ) : (
            <div
              className="faculty-results"
              onMouseLeave={clearPreview}
            >
              {filteredOptions.map(
                (option) => {
                  const alreadyAdded =
                    priorities.some(
                      (item) =>
                        item.option_id ===
                        option.id
                    );

                  const clashesWith = alreadyAdded
                    ? null
                    : clashFor(option);

                  return (
                    <button
                      type="button"
                      key={option.id}
                      className={`faculty-result${clashesWith ? " would-clash" : ""}`}
                      disabled={alreadyAdded}
                      onMouseEnter={() => previewOption(option)}
                      onFocus={() => previewOption(option)}
                      onBlur={clearPreview}
                      onClick={() => {
                        addPriority(
                          course,
                          option
                        );
                        clearPreview();
                      }}
                    >
                      <div>
                        <strong>
                          {option.name}
                        </strong>

                        <small>
                          {clashesWith ? (
                            <span className="clash-note">
                              Clashes with {clashesWith}
                            </span>
                          ) : (
                            option.slot_display
                          )}
                        </small>
                      </div>

                      <span className="add-symbol" aria-hidden="true">
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

          {priorities.length > 0 && (
            <button
              type="button"
              className="clear-button course-clear-button"
              onClick={() =>
                clearCourse(courseId)
              }
            >
              Clear this subject
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =========================================================
// TIMETABLE RESULT
// =========================================================

function TimetableResult({
  timetable,
  selectedIndex,
  timetables,
  setSelectedIndex,
}) {
  const selections =
    timetable?.selections || [];

  const total = timetables.length;

  // Arrow keys flip between options (ignored while typing in a field).
  useEffect(() => {
    const onKey = (event) => {
      const tag = (event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "ArrowRight") {
        setSelectedIndex((prev) => Math.min(total - 1, prev + 1));
      } else if (event.key === "ArrowLeft") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, setSelectedIndex]);

  const handleDownload = () => {
    const gridElement = document.getElementById("timetable-grid-capture");
    if (!gridElement) return;

    const background =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim() || "#ffffff";

    html2canvas(gridElement, { backgroundColor: background, scale: 2 }).then((canvas) => {
      const link = document.createElement("a");
      link.download = `seatsure-timetable-option-${selectedIndex + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  };

  const firstChoices = selections.filter((s) => s.priority_rank === 1).length;

  const gridSelections = selections.map((selection, index) => ({
    ...selection,
    color_index: index,
  }));

  // Only show a handful of dots; beyond that the counter says enough.
  const showDots = total > 1 && total <= 12;

  return (
    <div className="timetable-result">
      <div className="result-topbar">
        <div>
          <div className="result-label">
            Clash-free timetable
          </div>

          <h2>
            Option {selectedIndex + 1}
            <span className="result-total"> of {total}</span>
          </h2>
        </div>

        <div className="result-navigation">
          {showDots && (
            <div className="option-dots" role="tablist" aria-label="Timetable options">
              {timetables.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === selectedIndex}
                  aria-label={`Option ${i + 1}`}
                  className={`option-dot${i === selectedIndex ? " active" : ""}`}
                  onClick={() => setSelectedIndex(i)}
                />
              ))}
            </div>
          )}

          {total > 1 && (
            <span className="kbd-hint">
              <kbd>←</kbd> <kbd>→</kbd>
            </span>
          )}

          <button
            type="button"
            className="nav-button"
            disabled={selectedIndex === 0}
            onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))}
          >
            Previous
          </button>

          <button
            type="button"
            className="nav-button"
            disabled={selectedIndex === total - 1}
            onClick={() => setSelectedIndex((prev) => Math.min(total - 1, prev + 1))}
          >
            Next
          </button>

          <button
            type="button"
            className="nav-button"
            onClick={handleDownload}
          >
            Download PNG
          </button>
        </div>
      </div>

      <div className="result-stats">
        <div className="stat">
          <span className="stat-value">
            {firstChoices}/{selections.length}
          </span>
          <span className="stat-label">First choices you got</span>
        </div>

        <div className="stat">
          <span className="stat-value">{selections.length}</span>
          <span className="stat-label">Courses placed</span>
        </div>
      </div>

      <div className="assigned-faculty">
        <div className="assigned-title">
          Your faculty in this option
        </div>

        <div className="assigned-list" key={selectedIndex}>
          {selections.map((selection, index) => (
            <div
              className={`assigned-item ${courseColorClass(index)}`}
              style={{ animationDelay: `${index * 45}ms` }}
              key={`${selection.course_id}-${selection.professor_id}-${index}`}
            >
              <div className="assigned-course">
                {selection.course_name}
              </div>

              <div className="assigned-professor">
                {selection.professor_name}
                {selection.priority_rank
                  ? ` (choice ${selection.priority_rank})`
                  : ""}
              </div>

              {selection.slot_codes && selection.slot_codes.length > 0 && (
                <div className="assigned-slots">
                  {selection.slot_codes.join(" + ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <TimetableGrid
        selections={gridSelections}
        animateKey={`option-${selectedIndex}`}
        sweep
      />
    </div>
  );
}

// =========================================================
// MAIN APP
// =========================================================

function Dashboard({ student, onLogout, onBack }) {
  const [courses, setCourses] = useState([]);
  const [professors, setProfessors] = useState({});
  const [coursePriorities, setCoursePriorities] =
    useState({});
  const [openCourses, setOpenCourses] =
    useState({});
  const [searches, setSearches] =
    useState({});

  const [timetables, setTimetables] =
    useState([]);
  const [selectedIndex, setSelectedIndex] =
    useState(0);

  const [loadingCourses, setLoadingCourses] =
    useState(true);
  const [generating, setGenerating] =
    useState(false);
  const [status, setStatus] =
    useState("");

  const [clashInfo, setClashInfo] = useState([]);

  // Professor option currently hovered in the sidebar, shown as a
  // ghost on the live draft grid: { courseId, courseName, slots }
  const [hoverPreview, setHoverPreview] = useState(null);
  
  // =========================================================
  // LOAD COURSES
  // =========================================================

  useEffect(() => {
    const loadCourses = async () => {
      try {
        setLoadingCourses(true);

        const data = await getCourses();

        setCourses(
          Array.isArray(data)
            ? data
            : []
        );
      } catch (error) {
        console.error(
          "Failed to load courses:",
          error
        );

        setStatus(
          "Unable to load courses."
        );
      } finally {
        setLoadingCourses(false);
      }
    };

    loadCourses();
  }, []);

  useEffect(() => {
  getMyPreferences().then((rows) => {
    if (!rows || rows.length === 0) return;

    const restored = {};
    rows.forEach((row) => {
      const courseId = row.course_id;
      if (!restored[courseId]) restored[courseId] = [];
      restored[courseId].push({
        id: `${row.professor_id}-${row.theory_offering_id}-${row.lab_offering_id}`,
        option_id: `${row.professor_id}-${row.theory_offering_id}-${row.lab_offering_id}`,
        course_id: courseId,
        professor_id: row.professor_id,
        professor_name: row.professor_name,
        theory_offering_id: row.theory_offering_id,
        lab_offering_id: row.lab_offering_id,
        slot_display: "",
        type: row.lab_offering_id && row.theory_offering_id ? "theory_lab" : row.lab_offering_id ? "lab" : "theory",
      });
    });

    setCoursePriorities(restored);
  });
}, []);

  // =========================================================
  // LOAD FACULTY
  // =========================================================

  const loadProfessors = async (course) => {
    const courseId =
      Number(course.course_id);

    if (professors[courseId]) {
      return;
    }

    try {
      const data =
        await getCourseProfessors(
          courseId
        );

      if (!Array.isArray(data)) {
        setProfessors((prev) => ({
          ...prev,
          [courseId]: [],
        }));

        return;
      }

      /*
       * Keep every offering.
       *
       * Same professor with different
       * slot combinations must remain
       * separate options.
       */

      const facultyMap =
        new Map();

      data.forEach((row) => {
        const professorId =
          Number(row.professor_id);

        if (
          !facultyMap.has(
            professorId
          )
        ) {
          facultyMap.set(
            professorId,
            {
              professor_id:
                professorId,
              name: row.name,
              theory: [],
              lab: [],
              combined: [],
            }
          );
        }

        const faculty =
          facultyMap.get(
            professorId
          );

        const slotCodes =
          String(
            row.slot_codes || ""
          ).trim();

        if (!slotCodes) {
          return;
        }

        const courseType =
          normalizeCourseType(
            row.course_type
          );

        const offering = {
          offering_id:
            Number(
              row.offering_id
            ),
          slot_codes:
            slotCodes,
        };

        if (
          isLabType(courseType)
        ) {
          faculty.lab.push(
            offering
          );
        } else if (
          isTheoryType(courseType)
        ) {
          faculty.theory.push(
            offering
          );
        } else if (
          isTheoryLabType(
            courseType
          )
        ) {
          faculty.combined.push(
            offering
          );
        } else {
          /*
           * Fallback:
           *
           * Lxx = lab
           * anything else = theory
           */

          if (
            /^L\d+/i.test(
              slotCodes
            )
          ) {
            faculty.lab.push(
              offering
            );
          } else {
            faculty.theory.push(
              offering
            );
          }
        }
      });

      const options = [];

      // =====================================================
      // DIRECT THEORY + LAB
      // =====================================================

      facultyMap.forEach(
        (faculty) => {
          faculty.combined.forEach(
            (offering) => {
              options.push({
                id: `combined-${faculty.professor_id}-${offering.offering_id}`,

                professor_id:
                  faculty.professor_id,

                name: faculty.name,

                theory_offering_id:
                  offering.offering_id,

                lab_offering_id:
                  offering.offering_id,

                theory_slots:
                  offering.slot_codes,

                lab_slots:
                  offering.slot_codes,

                slot_display:
                  offering.slot_codes,

                type:
                  "theory_lab",
              });
            }
          );
        }
      );

      // =====================================================
      // LAB ONLY
      // =====================================================

      facultyMap.forEach(
        (faculty) => {
          if (
            faculty.lab.length > 0 &&
            faculty.theory.length === 0 &&
            faculty.combined.length === 0
          ) {
            faculty.lab.forEach(
              (lab) => {
                options.push({
                  id: `lab-${faculty.professor_id}-${lab.offering_id}`,

                  professor_id:
                    faculty.professor_id,

                  name: faculty.name,

                  theory_offering_id:
                    null,

                  lab_offering_id:
                    lab.offering_id,

                  theory_slots:
                    null,

                  lab_slots:
                    lab.slot_codes,

                  slot_display:
                    lab.slot_codes,

                  type: "lab",
                });
              }
            );
          }
        }
      );

      // =====================================================
      // THEORY ONLY
      // =====================================================

      facultyMap.forEach(
        (faculty) => {
          if (
            faculty.theory.length > 0 &&
            faculty.lab.length === 0 &&
            faculty.combined.length === 0
          ) {
            faculty.theory.forEach(
              (theory) => {
                options.push({
                  id: `theory-${faculty.professor_id}-${theory.offering_id}`,

                  professor_id:
                    faculty.professor_id,

                  name: faculty.name,

                  theory_offering_id:
                    theory.offering_id,

                  lab_offering_id:
                    null,

                  theory_slots:
                    theory.slot_codes,

                  lab_slots:
                    null,

                  slot_display:
                    theory.slot_codes,

                  type: "theory",
                });
              }
            );
          }
        }
      );

      // =====================================================
      // THEORY + LAB COMBINATIONS
      // =====================================================

      facultyMap.forEach(
        (faculty) => {
          if (
            faculty.theory.length > 0 &&
            faculty.lab.length > 0
          ) {
            faculty.theory.forEach(
              (theory) => {
                faculty.lab.forEach(
                  (lab) => {
                    const theoryMorning =
                      isMorningTheory(
                        theory.slot_codes
                      );

                    const theoryEvening =
                      isEveningTheory(
                        theory.slot_codes
                      );

                    const labMorning =
                      isMorningLab(
                        lab.slot_codes
                      );

                    const labEvening =
                      isEveningLab(
                        lab.slot_codes
                      );

                    /*
                     * Valid VIT combination:
                     *
                     * Morning theory + Evening lab
                     * OR
                     * Evening theory + Morning lab
                     */

                    const validCombination =
                      (theoryMorning &&
                        labEvening) ||
                      (theoryEvening &&
                        labMorning);

                    if (
                      !validCombination
                    ) {
                      return;
                    }

                    options.push({
                      id: `combo-${faculty.professor_id}-${theory.offering_id}-${lab.offering_id}`,

                      professor_id:
                        faculty.professor_id,

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

                      type:
                        "theory_lab",
                    });
                  }
                );
              }
            );
          }
        }
      );

      // =====================================================
      // SORT
      // =====================================================

      options.sort((a, b) => {
        const nameCompare =
          String(a.name || "")
            .localeCompare(
              String(b.name || "")
            );

        if (
          nameCompare !== 0
        ) {
          return nameCompare;
        }

        const typeOrder = {
          theory: 1,
          theory_lab: 2,
          lab: 3,
        };

        const typeCompare =
          (typeOrder[a.type] ||
            99) -
          (typeOrder[b.type] ||
            99);

        if (
          typeCompare !== 0
        ) {
          return typeCompare;
        }

        return String(
          a.slot_display || ""
        ).localeCompare(
          String(
            b.slot_display || ""
          )
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

  const toggleCourse = async (
    course
  ) => {
    const courseId =
      Number(course.course_id);

    const isOpen =
      !!openCourses[courseId];

    setOpenCourses((prev) => ({
      ...prev,
      [courseId]: !isOpen,
    }));

    if (!isOpen) {
      await loadProfessors(
        course
      );
    }
  };

  // =========================================================
  // ADD PRIORITY
  // =========================================================

  const addPriority = (
    course,
    option
  ) => {
    const courseId =
      Number(course.course_id);

    const current =
      coursePriorities[
        courseId
      ] || [];

    const alreadyAdded =
      current.some(
        (item) =>
          item.option_id ===
          option.id
      );

    if (alreadyAdded) {
      return;
    }

    const newPriority = {
      id: `${option.id}-${Date.now()}`,

      option_id:
        option.id,

      course_id:
        courseId,

      professor_id:
        Number(
          option.professor_id
        ),

      professor_name:
        option.name,

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

      type:
        option.type,
    };

    setCoursePriorities(
      (prev) => ({
        ...prev,

        [courseId]: [
          ...(prev[courseId] ||
            []),
          newPriority,
        ],
      })
    );

    setStatus("");
  };

  // =========================================================
  // REMOVE PRIORITY
  // =========================================================

  const removePriority = (
    courseId,
    priorityId
  ) => {
    setCoursePriorities(
      (prev) => ({
        ...prev,

        [courseId]: (
          prev[courseId] || []
        ).filter(
          (item) =>
            item.id !==
            priorityId
        ),
      })
    );
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

  const clearCourse = (
    courseId
  ) => {
    setCoursePriorities(
      (prev) => ({
        ...prev,
        [courseId]: [],
      })
    );
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

    event.dataTransfer.effectAllowed =
      "move";
  };

  // =========================================================
  // DRAG OVER
  // =========================================================

  const handleDragOver = (
    event
  ) => {
    event.preventDefault();

    event.dataTransfer.dropEffect =
      "move";
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

    const sourceCourseId =
      Number(
        event.dataTransfer.getData(
          "courseId"
        )
      );

    const sourceIndex =
      Number(
        event.dataTransfer.getData(
          "priorityIndex"
        )
      );

    if (
      sourceCourseId !==
        Number(courseId) ||
      Number.isNaN(
        sourceIndex
      ) ||
      sourceIndex ===
        targetIndex
    ) {
      return;
    }

    setCoursePriorities(
      (prev) => {
        const current = [
          ...(prev[courseId] ||
            []),
        ];

        if (
          sourceIndex < 0 ||
          sourceIndex >=
            current.length
        ) {
          return prev;
        }

        const [moved] =
          current.splice(
            sourceIndex,
            1
          );

        current.splice(
          targetIndex,
          0,
          moved
        );

        return {
          ...prev,
          [courseId]:
            current,
        };
      }
    );
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

  const totalPriorities =
    useMemo(() => {
      return Object.values(
        coursePriorities
      ).reduce(
        (total, list) =>
          total +
          (Array.isArray(
            list
          )
            ? list.length
            : 0),
        0
      );
    }, [coursePriorities]);

  // =========================================================
  // GENERATE
  // =========================================================

  const handleGenerate =
    async () => {
      if (
        totalPriorities === 0
      ) {
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
         * Exact selected offerings (theory_offering_id /
         * lab_offering_id) are preserved here and saved by the
         * backend, so timetable generation uses the specific
         * combo the student picked instead of every offering
         * that professor teaches for the course.
         */

        const preferences = [];

        Object.entries(
          coursePriorities
        ).forEach(
          ([courseId, priorities]) => {
            priorities.forEach(
              (
                item,
                index
              ) => {
                preferences.push({
                  course_id:
                    Number(
                      courseId
                    ),

                  professor_id:
                    Number(
                      item.professor_id
                    ),

                  theory_offering_id:
                    item.theory_offering_id,

                  lab_offering_id:
                    item.lab_offering_id,

                  priority_rank:
                    index + 1,
                });
              }
            );
          }
        );

        await savePreferences(
          preferences
        );

        const result =
          await generateTimetable();

        const generated =
          Array.isArray(
            result?.timetables
          )
            ? result.timetables
            : [];

        setTimetables(
          generated
        );

        setSelectedIndex(0);

     if (generated.length === 0) {
  const clashes = result?.diagnostic?.clashes || [];

  if (clashes.length > 0) {
    setClashInfo(clashes);
    setStatus("No clash-free timetable found — see the conflicts below.");
  } else {
    setClashInfo([]);
    setStatus("No clash-free timetable was found.");
  }
} else {
  setClashInfo([]);
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
          error?.response?.data
            ?.message ||
            "Unable to generate timetable."
        );
      } finally {
        setGenerating(false);
      }
    };

  // =========================================================
  // LIVE DRAFT
  // Each course's first-choice professor, laid onto the week as
  // you build. Restored (saved) choices get their slots resolved
  // from the faculty list once it has loaded.
  // =========================================================

  // Saved priorities come back without slot info, so load faculty
  // for those courses in the background to fill the draft grid.
  useEffect(() => {
    if (courses.length === 0) return;
    Object.entries(coursePriorities).forEach(([courseId, list]) => {
      if (!list || list.length === 0) return;
      if (professors[Number(courseId)]) return;
      const course = courses.find((c) => Number(c.course_id) === Number(courseId));
      if (course) loadProfessors(course);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, coursePriorities]);

  const courseIndexById = useMemo(() => {
    const map = {};
    courses.forEach((course, index) => {
      map[Number(course.course_id)] = index;
    });
    return map;
  }, [courses]);

  const draftSelections = useMemo(() => {
    const list = [];
    Object.entries(coursePriorities).forEach(([courseId, priorities]) => {
      const first = priorities && priorities[0];
      if (!first) return;

      let slots = [
        ...parseSlotCodes(first.theory_slots),
        ...parseSlotCodes(first.lab_slots),
      ];
      if (slots.length === 0) slots = parseSlotCodes(first.slot_display);

      if (slots.length === 0) {
        const options = professors[Number(courseId)] || [];
        const match = options.find(
          (o) =>
            Number(o.professor_id) === Number(first.professor_id) &&
            (o.theory_offering_id || null) === (first.theory_offering_id || null) &&
            (o.lab_offering_id || null) === (first.lab_offering_id || null)
        );
        slots = optionSlotCodes(match);
      }

      const course = courses.find((c) => Number(c.course_id) === Number(courseId));
      list.push({
        course_id: Number(courseId),
        course_name: course?.course_name || course?.name || `Course ${courseId}`,
        professor_name: first.professor_name,
        slot_codes: Array.from(new Set(slots)),
        color_index: courseIndexById[Number(courseId)] ?? list.length,
      });
    });
    return list;
  }, [coursePriorities, professors, courses, courseIndexById]);

  // slot code -> course holding it (via first choice), for clash hints
  const occupiedSlots = useMemo(() => {
    const map = {};
    draftSelections.forEach((sel) => {
      sel.slot_codes.forEach((code) => {
        if (!map[code]) {
          map[code] = { courseId: sel.course_id, courseName: sel.course_name };
        }
      });
    });
    return map;
  }, [draftSelections]);

  const draftClashes = useMemo(() => {
    const seen = {};
    const pairs = new Set();
    draftSelections.forEach((sel) => {
      sel.slot_codes.forEach((code) => {
        if (seen[code] && seen[code] !== sel.course_name) {
          pairs.add([seen[code], sel.course_name].sort().join(" and "));
        } else {
          seen[code] = sel.course_name;
        }
      });
    });
    return Array.from(pairs);
  }, [draftSelections]);

  const rankedCourses = draftSelections.length;
  const totalCourses = courses.length;
  const progressPct = totalCourses ? rankedCourses / totalCourses : 0;
  const RING = 2 * Math.PI * 25;

  const ghost =
    hoverPreview && hoverPreview.slots.length > 0
      ? { courseName: hoverPreview.courseName, slots: hoverPreview.slots }
      : null;

  // =========================================================
  // CURRENT RESULT
  // =========================================================

  const currentTimetable =
    timetables.length > 0
      ? timetables[
          selectedIndex
        ]
      : null;

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
          <div className="progress-block">
            <div
              className={`progress-ring${
                totalCourses > 0 && rankedCourses === totalCourses ? " complete" : ""
              }`}
              role="img"
              aria-label={`${rankedCourses} of ${totalCourses} courses ranked`}
            >
              <svg viewBox="0 0 58 58">
                <circle className="progress-ring-track" cx="29" cy="29" r="25" />
                <circle
                  className="progress-ring-value"
                  cx="29"
                  cy="29"
                  r="25"
                  strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - progressPct)}
                />
              </svg>
              <span className="progress-ring-label">{rankedCourses}</span>
            </div>

            <div className="progress-text">
              <strong>
                {rankedCourses} of {totalCourses} courses ranked
              </strong>
              <span>
                {totalPriorities === 0
                  ? "Open a course to pick faculty"
                  : `${totalPriorities} faculty choice${totalPriorities === 1 ? "" : "s"} in total`}
              </span>
            </div>
          </div>

          {totalPriorities > 0 && (
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
            Courses
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
                    professors={
                      professors
                    }
                    coursePriorities={
                      coursePriorities
                    }
                    openCourses={
                      openCourses
                    }
                    searches={
                      searches
                    }
                    toggleCourse={
                      toggleCourse
                    }
                    addPriority={
                      addPriority
                    }
                    removePriority={
                      removePriority
                    }
                    clearCourse={
                      clearCourse
                    }
                    updateSearch={
                      updateSearch
                    }
                    handleDragStart={
                      handleDragStart
                    }
                    handleDragOver={
                      handleDragOver
                    }
                    handleDrop={
                      handleDrop
                    }
                    occupiedSlots={occupiedSlots}
                    setHoverPreview={setHoverPreview}
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
              {student?.name
                ? `Pre-FFCS for ${student.name.split(" ")[0]}`
                : "Pre-FFCS"}
            </div>

            <h1>
              Build your week
            </h1>

            <p>
              Rank faculty for each course. Hover a professor to see
              where their classes land, then generate every clash-free
              timetable your choices allow.
            </p>
          </div>

<div className="header-actions">
            <button
              type="button"
              className="header-link"
              onClick={onBack}
            >
              ← Home
            </button>

            <div className="header-secondary-group">
              <button
                type="button"
                className="header-link"
                onClick={async () => {
                  const preferences = [];
                  Object.entries(coursePriorities).forEach(([courseId, priorities]) => {
                    priorities.forEach((item, index) => {
                      preferences.push({
                        course_id: Number(courseId),
                        professor_id: Number(item.professor_id),
                        theory_offering_id: item.theory_offering_id || null,
                        lab_offering_id: item.lab_offering_id || null,
                        priority_rank: index + 1,
                      });
                    });
                  });
                  await savePreferences(preferences);
                  setStatus("Progress saved.");
                }}
              >
                Save progress
              </button>

              <span className="header-divider-dot" />

              <button
                type="button"
                className="header-link"
                onClick={async () => {
                  try {
                    await submitPreferences();
                    setStatus("Priorities submitted for FFCS.");
                  } catch (err) {
                    setStatus(err?.response?.data?.error || "Submit failed — save your priorities first.");
                  }
                }}
              >
                Submit for FFCS
              </button>
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
                  Generate timetables
                </>
              )}
            </button>

            <button
  type="button"
  className="header-link danger"
  onClick={async () => {
    const confirmed = window.confirm(
      "This will clear your saved priorities and any FFCS picks so you can redo the whole flow. Continue?"
    );
    if (!confirmed) return;

    try {
      await resetMyFFCS();
      window.location.reload();
    } catch (err) {
      alert("Reset failed — check the console.");
      console.error(err);
    }
  }}
>
  Reset simulation
</button>

<button
  type="button"
  className="header-link"
  onClick={onLogout}
>
  Log out
</button>
          </div>

        </header>

        {status && (
          <div className="status-message">
            {status}
          </div>
        )}

        {clashInfo.length > 0 && (
  <div className="clash-details">
    <div className="clash-details-title">Conflicts found</div>
    {clashInfo.map((clash, i) => (
      <div key={i} className="clash-item">
        <strong>{clash.course_a}</strong> ({clash.professor_a}) clashes with{" "}
        <strong>{clash.course_b}</strong> ({clash.professor_b}) on slot(s):{" "}
        {clash.shared_slot_codes.join(", ")}
      </div>
    ))}
  </div>
)}

        <section className="workspace">
          {currentTimetable ? (
            <TimetableResult
              timetable={
                currentTimetable
              }
              selectedIndex={
                selectedIndex
              }
              timetables={
                timetables
              }
              setSelectedIndex={
                setSelectedIndex
              }
            />
          ) : (
            <div className="draft">
              <div className="draft-head">
                <div>
                  <h2 className="draft-title">
                    {rankedCourses === 0
                      ? "Your week, before you build it"
                      : draftClashes.length > 0
                      ? "Your first choices clash"
                      : "Your first choices fit together"}
                  </h2>
                  <p className="draft-hint">
                    {rankedCourses === 0
                      ? "Open a course on the left and hover a professor. Their slots light up here before you add them."
                      : draftClashes.length > 0
                      ? `${draftClashes.join(", ")} share a slot. Add backup faculty or swap the order, then generate.`
                      : "This is your week with everyone's first choice. Generate to find every clash-free combination, including your backups."}
                  </p>
                </div>

                <div className="draft-legend">
                  {draftSelections.map((sel) => (
                    <span
                      key={sel.course_id}
                      className={`legend-chip ${courseColorClass(sel.color_index)}`}
                    >
                      {sel.course_name}
                    </span>
                  ))}
                  {ghost && (
                    <span className="legend-chip ghost">
                      Previewing {ghost.courseName}
                    </span>
                  )}
                </div>
              </div>

              <TimetableGrid
                selections={draftSelections}
                ghost={ghost}
                compact
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// =========================================================
// APP (auth gate)
//
// Holds the logged-in student's session, restores it from a
// saved token on refresh, and renders either the Login screen
// or the Dashboard.
// =========================================================

function App() {
  const [student, setStudent] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState("landing"); // "landing" | "preffcs" | "ffcs" | "waitlist" | "reviews"

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setCheckingSession(false);
      return;
    }

    getMe()
      .then((data) => setStudent(data))
      .catch(() => {
        // Token missing/expired/invalid — clear it and fall back to login.
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  const handleAuthenticated = ({ token, student: authedStudent }) => {
    localStorage.setItem(TOKEN_KEY, token);
    setStudent(authedStudent);
    setView("landing");
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setStudent(null);
    setView("landing");
  };

  let page;

  if (checkingSession) {
    page = <div className="session-loading">Loading SeatSure…</div>;
  } else if (!student) {
    page = <Login onAuthenticated={handleAuthenticated} />;
  } else if (view === "preffcs") {
    page = (
      <Dashboard
        student={student}
        onLogout={handleLogout}
        onBack={() => setView("landing")}
      />
    );
  } else if (view === "ffcs") {
    page = <FFCSPage onBack={() => setView("landing")} />;
  } else if (view === "reviews") {
    page = <ReviewsPage onBack={() => setView("landing")} />;
  } else if (view === "waitlist") {
    page = <WaitlistPage onBack={() => setView("landing")} />;
  } else {
    page = (
      <Landing
        student={student}
        onSelect={setView}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <>
      {page}
      <ThemeToggle />
    </>
  );
}

export default App;