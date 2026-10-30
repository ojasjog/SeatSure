import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getReviewCourses,
  getCourseReviews,
  postReview,
  updateReview,
  deleteReview,
} from "../api";
import "./ReviewsPage.css";

// =========================================================
// REVIEWS
// Browse reviews for any course. Posting is only offered to students
// who have completed the course (the backend enforces this too — the
// form below is just the friendly front door).
// =========================================================

const MAX_LEN = 1000;

const errMsg = (err, fallback) => err?.response?.data?.error || fallback;

const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

// Read-only stars, or clickable when onChange is passed.
function Stars({ value, onChange }) {
  const rounded = Math.round(value || 0);
  return (
    <span className={`rv-stars ${onChange ? "rv-stars-input" : ""}`} aria-label={`${rounded} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            className={n <= rounded ? "rv-star on" : "rv-star"}
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            ★
          </button>
        ) : (
          <span key={n} className={n <= rounded ? "rv-star on" : "rv-star"}>★</span>
        )
      )}
    </span>
  );
}

const EMPTY_FORM = { professor_id: "", rating: 0, comment: "" };

function ReviewsPage({ onBack }) {
  const [courses, setCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [profFilter, setProfFilter] = useState("all");

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadCourses = useCallback(() => {
    return getReviewCourses()
      .then((data) => {
        setCourses(data);
        setListError("");
      })
      .catch((err) => setListError(errMsg(err, "Couldn't load courses.")))
      .finally(() => setLoadingCourses(false));
  }, []);

  const loadDetail = useCallback((courseId) => {
    setLoadingDetail(true);
    return getCourseReviews(courseId)
      .then((data) => {
        setDetail(data);
        setDetailError("");
      })
      .catch((err) => setDetailError(errMsg(err, "Couldn't load reviews.")))
      .finally(() => setLoadingDetail(false));
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    setDetail(null);
    setProfFilter("all");
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError("");
    if (selectedId != null) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) => c.course_code.toLowerCase().includes(q) || c.course_name.toLowerCase().includes(q)
    );
  }, [courses, search]);

  const visibleReviews = useMemo(() => {
    if (!detail) return [];
    return profFilter === "all"
      ? detail.reviews
      : detail.reviews.filter((r) => String(r.professor_id) === String(profFilter));
  }, [detail, profFilter]);

  const eligibility = detail?.eligibility;
  // Professors the student can still write a NEW review for.
  const open = eligibility?.reviewable.filter((p) => !p.my_review_id) || [];

  const startEdit = (review) => {
    setEditingId(review.review_id);
    setForm({ professor_id: String(review.professor_id), rating: review.rating, comment: review.comment || "" });
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.rating) return setFormError("Pick a star rating.");
    if (!editingId && !form.professor_id) return setFormError("Choose the professor you're reviewing.");

    setSubmitting(true);
    setFormError("");
    try {
      if (editingId) {
        await updateReview(editingId, { rating: form.rating, comment: form.comment });
      } else {
        await postReview(selectedId, {
          professor_id: Number(form.professor_id),
          rating: form.rating,
          comment: form.comment,
        });
      }
      setEditingId(null);
      setForm(EMPTY_FORM);
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (err) {
      setFormError(errMsg(err, "Couldn't save your review."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (review) => {
    if (!window.confirm("Delete your review?")) return;
    try {
      await deleteReview(review.review_id);
      if (editingId === review.review_id) cancelEdit();
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (err) {
      setFormError(errMsg(err, "Couldn't delete your review."));
    }
  };

  // ---------- the "can I post?" panel ----------
  const renderComposer = () => {
    if (!eligibility) return null; // not a student account

    if (!eligibility.can_review) {
      const msg =
        eligibility.reason === "in_progress"
          ? "You're enrolled in this course. You'll be able to review it once it's marked as completed."
          : "Only students who have enrolled in and completed this course can post a review.";
      return <div className="rv-locked">🔒 {msg}</div>;
    }

    if (!editingId && open.length === 0) {
      return <div className="rv-locked">✓ You've reviewed every professor you had for this course. You can edit your reviews below.</div>;
    }

    return (
      <form className="rv-form" onSubmit={handleSubmit}>
        <div className="rv-form-title">{editingId ? "Edit your review" : "Write a review"}</div>

        {!editingId && (
          <label className="rv-field">
            <span>Professor</span>
            <select value={form.professor_id} onChange={(e) => setForm({ ...form, professor_id: e.target.value })}>
              <option value="">Select…</option>
              {open.map((p) => (
                <option key={p.professor_id} value={p.professor_id}>{p.professor_name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="rv-field">
          <span>Rating</span>
          <Stars value={form.rating} onChange={(n) => setForm({ ...form, rating: n })} />
        </div>

        <label className="rv-field">
          <span>Comment <em>(optional)</em></span>
          <textarea
            rows={4}
            maxLength={MAX_LEN}
            value={form.comment}
            placeholder="Teaching style, workload, grading, would you recommend it?"
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />
          <small>{form.comment.length}/{MAX_LEN}</small>
        </label>

        {formError && <div className="rv-error">{formError}</div>}

        <div className="rv-form-actions">
          <button type="submit" className="rv-primary" disabled={submitting}>
            {submitting ? "Saving…" : editingId ? "Save changes" : "Post review"}
          </button>
          {editingId && (
            <button type="button" className="rv-ghost" onClick={cancelEdit}>Cancel</button>
          )}
        </div>
      </form>
    );
  };

  return (
    <div className="rv-shell">
      <button type="button" className="page-back" onClick={onBack}>← Home</button>

      <h1 className="rv-title">Reviews</h1>
      <p className="rv-sub">Anonymous reviews, only from students who completed the course.</p>

      <div className="rv-layout">
        {/* ---------- course list ---------- */}
        <aside className="rv-list">
          <input
            className="rv-search"
            placeholder="Search courses…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loadingCourses && <div className="rv-muted">Loading…</div>}
          {listError && <div className="rv-error">{listError}</div>}
          {!loadingCourses && !listError && filteredCourses.length === 0 && (
            <div className="rv-muted">No courses match.</div>
          )}
          {filteredCourses.map((c) => (
            <button
              key={c.course_id}
              type="button"
              className={`rv-course ${selectedId === c.course_id ? "active" : ""}`}
              onClick={() => setSelectedId(c.course_id)}
            >
              <div className="rv-course-top">
                <span className="rv-code">{c.course_code}</span>
                {c.completed && <span className="rv-chip">Completed</span>}
              </div>
              <div className="rv-course-name">{c.course_name}</div>
              <div className="rv-course-meta">
                {c.review_count > 0 ? (
                  <><Stars value={c.avg_rating} /> <b>{c.avg_rating}</b> · {c.review_count} review{c.review_count > 1 ? "s" : ""}</>
                ) : (
                  <span className="rv-muted">No reviews yet</span>
                )}
              </div>
            </button>
          ))}
        </aside>

        {/* ---------- detail ---------- */}
        <section className="rv-detail">
          {selectedId == null && <div className="rv-empty">Select a course to see its reviews.</div>}
          {selectedId != null && loadingDetail && !detail && <div className="rv-muted">Loading…</div>}
          {detailError && <div className="rv-error">{detailError}</div>}

          {detail && (
            <>
              <div className="rv-head">
                <div>
                  <div className="rv-code">{detail.course.course_code}</div>
                  <h2>{detail.course.course_name}</h2>
                </div>
                <div className="rv-score">
                  {detail.summary.review_count > 0 ? (
                    <>
                      <div className="rv-score-num">{detail.summary.avg_rating}</div>
                      <Stars value={detail.summary.avg_rating} />
                      <div className="rv-muted">{detail.summary.review_count} review{detail.summary.review_count > 1 ? "s" : ""}</div>
                    </>
                  ) : (
                    <div className="rv-muted">No reviews yet</div>
                  )}
                </div>
              </div>

              {detail.summary.review_count > 0 && (
                <div className="rv-dist">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const count = detail.summary.distribution[n];
                    const pct = (count / detail.summary.review_count) * 100;
                    return (
                      <div key={n} className="rv-dist-row">
                        <span>{n}★</span>
                        <div className="rv-bar"><div style={{ width: `${pct}%` }} /></div>
                        <span className="rv-muted">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {renderComposer()}

              {detail.summary.professors.length > 1 && (
                <div className="rv-filters">
                  <button type="button" className={profFilter === "all" ? "rv-pill on" : "rv-pill"} onClick={() => setProfFilter("all")}>
                    All professors
                  </button>
                  {detail.summary.professors.map((p) => (
                    <button
                      key={p.professor_id}
                      type="button"
                      className={String(profFilter) === String(p.professor_id) ? "rv-pill on" : "rv-pill"}
                      onClick={() => setProfFilter(p.professor_id)}
                    >
                      {p.professor_name} · {p.avg_rating}★ ({p.review_count})
                    </button>
                  ))}
                </div>
              )}

              <div className="rv-reviews">
                {visibleReviews.map((r) => (
                  <article key={r.review_id} className={`rv-review ${r.is_mine ? "mine" : ""}`}>
                    <div className="rv-review-top">
                      <Stars value={r.rating} />
                      <span className="rv-prof">{r.professor_name}</span>
                      {r.is_mine && <span className="rv-chip">Your review</span>}
                      <span className="rv-date">
                        {formatDate(r.created_at)}
                        {r.updated_at && r.updated_at !== r.created_at && new Date(r.updated_at) - new Date(r.created_at) > 1000 ? " (edited)" : ""}
                      </span>
                    </div>
                    {r.comment && <p>{r.comment}</p>}
                    <div className="rv-verified">Verified student</div>
                    {r.is_mine && (
                      <div className="rv-review-actions">
                        <button type="button" className="rv-ghost" onClick={() => startEdit(r)}>Edit</button>
                        <button type="button" className="rv-ghost danger" onClick={() => handleDelete(r)}>Delete</button>
                      </div>
                    )}
                  </article>
                ))}
                {detail.reviews.length > 0 && visibleReviews.length === 0 && (
                  <div className="rv-muted">No reviews for this professor yet.</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default ReviewsPage;
