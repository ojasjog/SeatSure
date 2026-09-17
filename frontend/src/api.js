import axios from "axios";

const API_BASE = "http://localhost:5000/api";
export const TOKEN_KEY = "seatsure_token";

const client = axios.create({ baseURL: API_BASE });

// Attach the logged-in student's JWT to every request automatically.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Auth ----
export const signup = (payload) =>
  client.post("/auth/signup", payload).then((r) => r.data);

export const login = (payload) =>
  client.post("/auth/login", payload).then((r) => r.data);

export const getMe = () => client.get("/auth/me").then((r) => r.data);

// ---- App data (all require a logged-in student; the token supplies
// the student_id server-side, so it's never passed from the client) ----
export const getCourses = () => client.get("/courses").then((r) => r.data);

export const getCourseProfessors = (courseId) =>
  client.get(`/courses/${courseId}/professors`).then((r) => r.data);

export const savePreferences = (preferences) =>
  client.post("/preferences", { preferences }).then((r) => r.data);

export const generateTimetable = () =>
  client.get("/timetable/me").then((r) => r.data);

// ---- FFCS (live) ----
export const getFFCSOptions = () =>
  client.get("/ffcs/options").then((r) => r.data);

export const registerOffering = (offeringId) =>
  client.post("/register", { offering_id: offeringId }).then((r) => r.data);

export const submitPreferences = () =>
  client.post("/preferences/submit").then((r) => r.data);

export const getMyPreferences = () =>
  client.get("/preferences/me").then((r) => r.data);

export const SOCKET_URL = "http://localhost:5000";
