import axios from "axios";

const API_BASE = "http://localhost:5000/api";

export const getCourses = () => axios.get(`${API_BASE}/courses`).then((r) => r.data);

export const getCourseProfessors = (courseId) =>
  axios.get(`${API_BASE}/courses/${courseId}/professors`).then((r) => r.data);

export const savePreferences = (studentId, preferences) =>
  axios.post(`${API_BASE}/preferences`, { student_id: studentId, preferences }).then((r) => r.data);

export const generateTimetable = (studentId) =>
  axios.get(`${API_BASE}/timetable/${studentId}`).then((r) => r.data);
