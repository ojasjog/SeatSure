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
} from "./api";
import Login from "./components/Login";
import Landing from "./components/Landing";
import TimetableGrid from "./components/TimetableGrid";
import FFCSPage from "./components/FFCSPage";
import WaitlistPage from "./components/Waitlist";
import "./App.css";const COURSE_COLORS = [
  "#D7C6A7", "#BCCAB8", "#D8BDB8", "#CAC9C1",
  "#DCC6A5", "#C9C8B1", "#D4C8B5",
];

function courseColor(index) {
  return COURSE_COLORS[index % COURSE_COLORS.length];
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
}) {
  const courseId = Number(course.course_id);

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
                    <div className="priority-number">
                      P{index + 1}
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
                      key={option.id}
                      className="faculty-result"
                      disabled={alreadyAdded}
                      onClick={() =>
                        addPriority(
                          course,
                          option
                        )
                      }
                    >
                      <div>
                        <strong>
                          {option.name}
                        </strong>

                        <small>
                          {option.slot_display}
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
              selectedIndex === 0
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
              timetables.length - 1
            }
            onClick={() =>
              setSelectedIndex(
                (prev) =>
                  Math.min(
                    timetables.length - 1,
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
            {selections.filter((s) => s.priority_rank === 1).length}
            /
            {selections.length}
          </span>

          <span className="stat-label">
            Got 1st choice
          </span>
        </div>
      </div>

      <div className="assigned-faculty">
        <div className="assigned-title">
          ASSIGNED FACULTY
        </div>

        <div className="assigned-list">
          {selections.map(
            (selection, index) => (
              <div
                className="assigned-item"
                key={`${selection.course_id}-${selection.professor_id}-${index}`}
              >
                <div className="assigned-course">
                  {selection.course_name}
                </div>

                <div className="assigned-professor">
                  {selection.professor_name}
                </div>

                {selection.slot_codes && selection.slot_codes.length > 0 && (
                  <div className="assigned-slots">
                    {selection.slot_codes.join(" + ")}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <div className="assigned-faculty" style={{ marginTop: "12px" }}>
  <div className="assigned-title">
    COLOR KEY
  </div>
  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", padding: "10px 13px" }}>
    {selections.map((selection, index) => (
      <div
        key={selection.course_id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "9px",
          color: "var(--text-soft)",
        }}
      >
        <span
          style={{
            width: "9px",
            height: "9px",
            borderRadius: "2px",
            background: courseColor(index),
            display: "inline-block",
          }}
        />
        {selection.course_name}
      </div>
    ))}
  </div>
</div>

      <TimetableGrid selections={selections} />

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

        if (
          generated.length ===
          0
        ) {
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
          error?.response?.data
            ?.message ||
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
          <div className="sidebar-heading">
            SELECTIONS
          </div>

          <div className="priority-count">
            {totalPriorities} faculty selected
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
              VIT VELLORE {student?.name ? `· ${student.name}` : ""}
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

    <div className="header-actions">
            <button
              type="button"
              className="home-button"
              onClick={onBack}
            >
              ← Home
            </button>

            <button
              type="button"
              className="home-button"
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
              Save Progress
            </button>

            <button
              type="button"
              className="home-button"
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

            <button
              type="button"
              className="logout-button"
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
            <div className="empty-state">
              <div className="empty-icon">
                □
              </div>

              <h2>
                Your timetable will appear here
              </h2>

              <p>
                Select faculty in order
                of preference for each
                subject, then generate
                your clash-free timetable.
              </p>
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
  const [view, setView] = useState("landing"); // "landing" | "preffcs" | "ffcs" | "waitlist"

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

  if (checkingSession) {
    return <div className="session-loading">Loading SeatSure...</div>;
  }

  if (!student) {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  if (view === "preffcs") {
    return (
      <Dashboard
        student={student}
        onLogout={handleLogout}
        onBack={() => setView("landing")}
      />
    );
  }

  if (view === "ffcs") {
    return <FFCSPage onBack={() => setView("landing")} />;
  }

  if (view === "waitlist") {
    return <WaitlistPage onBack={() => setView("landing")} />;
  }

  return (
    <Landing
      student={student}
      onSelect={setView}
      onLogout={handleLogout}
    />
  );
}

export default App;