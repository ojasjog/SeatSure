import React, { useState } from "react";
import { login, signup } from "../api";
import "./Login.css";

// Renders a sign-in / sign-up card and hands the resulting
// { token, student } back to the parent once auth succeeds.
function Login({ onAuthenticated }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [branch, setBranch] = useState("");
  const [semester, setSemester] = useState("");

  const resetExtraFields = () => {
    setName("");
    setRegNo("");
    setBranch("");
    setSemester("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    if (mode === "signup" && (!name.trim() || !regNo.trim())) {
      setError("Name and registration number are required.");
      return;
    }

    setSubmitting(true);
    try {
      const data =
        mode === "login"
          ? await login({ username: username.trim(), password })
          : await signup({
              username: username.trim(),
              password,
              name: name.trim(),
              reg_no: regNo.trim(),
              branch: branch.trim() || undefined,
              semester: semester ? Number(semester) : undefined,
            });

      onAuthenticated(data);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        (mode === "login" ? "Login failed. Check your credentials." : "Sign up failed.");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    resetExtraFields();
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">S</div>
          <div>
            <div className="login-brand-name">SeatSure</div>
            <div className="login-brand-subtitle">VIT Vellore · FFCS Planner</div>
          </div>
        </div>

        <h1>{mode === "login" ? "Student login" : "Create your account"}</h1>
        <p className="login-subtitle">
          {mode === "login"
            ? "Sign in to build and register your timetable."
            : "Sign up with your registration number to get started."}
        </p>

        <div className="login-toggle">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {mode === "signup" && (
            <>
              <label>
                Full name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </label>

              <label>
                Registration number
                <input
                  type="text"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="25BCE1234"
                  autoComplete="off"
                />
              </label>

              <div className="login-row">
                <label>
                  Branch
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="CSE"
                  />
                </label>
                <label>
                  Semester
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    placeholder="5"
                  />
                </label>
              </div>
            </>
          )}

          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jane.doe"
              autoComplete="username"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="button-spinner" />
                {mode === "login" ? "Logging in..." : "Creating account..."}
              </>
            ) : mode === "login" ? (
              "Log in"
            ) : (
              "Create account"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
