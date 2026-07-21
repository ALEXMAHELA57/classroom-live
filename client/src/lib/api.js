import { API_BASE, getToken } from './auth.js';

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function createRoom(durationMinutes) {
  const res = await fetch(`${API_BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ durationMinutes: durationMinutes || null }),
  });
  return parseOrThrow(res);
}

// Named getLivekitToken (not getToken) to avoid clashing with the auth
// helper's getToken(), which reads the login token from local storage.
export async function getLivekitToken(roomId) {
  const res = await fetch(`${API_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ roomId }),
  });
  return parseOrThrow(res);
}

export async function getRoomInfo(roomId) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomId}`, {
    headers: authHeaders(),
  });
  return parseOrThrow(res);
}

// --- Subjects, enrollment, syllabus ---------------------------------------
export async function listSubjects() {
  const res = await fetch(`${API_BASE}/api/subjects`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function createSubject(name) {
  const res = await fetch(`${API_BASE}/api/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  return parseOrThrow(res);
}

export async function listStudents() {
  const res = await fetch(`${API_BASE}/api/students`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function enrollStudent(subjectId, studentId) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ studentId }),
  });
  return parseOrThrow(res);
}

export async function unenrollStudent(subjectId, studentId) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/enroll/${studentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseOrThrow(res);
}

export async function uploadSyllabus(subjectId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/syllabus`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return parseOrThrow(res);
}

export async function setSyllabusText(subjectId, text) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/syllabus-text`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text }),
  });
  return parseOrThrow(res);
}

// --- Quizzes ---------------------------------------------------------------
export async function generateQuiz(subjectId, { topic, questionCount }) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/quizzes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ topic, questionCount }),
  });
  return parseOrThrow(res);
}

export async function listQuizzes(subjectId) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/quizzes`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function getQuiz(quizId) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function submitQuiz(quizId, answers) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ answers }),
  });
  return parseOrThrow(res);
}

export async function getQuizSubmissions(quizId) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}/submissions`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function getQuizFull(quizId) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}/full`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function createManualQuiz(subjectId, { topic, questions }) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/quizzes/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ topic, questions }),
  });
  return parseOrThrow(res);
}

export async function uploadQuizFile(subjectId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/quizzes/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return parseOrThrow(res);
}

export async function updateQuiz(quizId, questions) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ questions }),
  });
  return parseOrThrow(res);
}

export async function publishQuiz(quizId) {
  const res = await fetch(`${API_BASE}/api/quizzes/${quizId}/publish`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseOrThrow(res);
}

// --- Assignments -------------------------------------------------------
export async function generateAssignment(subjectId, { topic, dueAt }) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ topic, dueAt }),
  });
  return parseOrThrow(res);
}

export async function listAssignments(subjectId) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/assignments`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function getAssignment(assignmentId) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function submitAssignment(assignmentId, { textAnswer, file }) {
  const formData = new FormData();
  if (textAnswer) formData.append('textAnswer', textAnswer);
  if (file) formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return parseOrThrow(res);
}

export async function getAssignmentSubmissions(assignmentId) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}/submissions`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function getAssignmentFull(assignmentId) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}/full`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function createManualAssignment(subjectId, { title, instructions, rubric, dueAt }) {
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/assignments/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, instructions, rubric, dueAt }),
  });
  return parseOrThrow(res);
}

export async function uploadAssignmentFile(subjectId, file, title) {
  const formData = new FormData();
  formData.append('file', file);
  if (title) formData.append('title', title);
  const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/assignments/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return parseOrThrow(res);
}

export async function updateAssignment(assignmentId, { title, instructions, rubric, dueAt }) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, instructions, rubric, dueAt }),
  });
  return parseOrThrow(res);
}

export async function publishAssignment(assignmentId) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}/publish`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseOrThrow(res);
}

export async function downloadAssignmentSourceFile(assignmentId) {
  const res = await fetch(`${API_BASE}/api/assignments/${assignmentId}/source-file`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Could not download file');
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'assignment-file';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Billing ---------------------------------------------------------------
export async function getBillingInstructions() {
  const res = await fetch(`${API_BASE}/api/billing/instructions`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function setBillingInstructions(instructions) {
  const res = await fetch(`${API_BASE}/api/billing/instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ instructions }),
  });
  return parseOrThrow(res);
}

export async function listBillingStudents() {
  const res = await fetch(`${API_BASE}/api/billing/students`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function listStudentPayments(studentId) {
  const res = await fetch(`${API_BASE}/api/billing/students/${studentId}/payments`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function addPayment(studentId, { amount, note }) {
  const res = await fetch(`${API_BASE}/api/billing/students/${studentId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ amount, note }),
  });
  return parseOrThrow(res);
}

export async function deletePayment(paymentId) {
  const res = await fetch(`${API_BASE}/api/billing/payments/${paymentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseOrThrow(res);
}

// --- Superadmin: live sessions ----------------------------------------
export async function listLiveSessions() {
  const res = await fetch(`${API_BASE}/api/admin/live-sessions`, { headers: authHeaders() });
  return parseOrThrow(res);
}

// --- Student self-recordings -------------------------------------------
export async function listStaff() {
  const res = await fetch(`${API_BASE}/api/staff`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function uploadSelfRecording(blob) {
  const formData = new FormData();
  const ext = blob.type.includes('video') ? 'webm' : 'webm';
  formData.append('file', blob, `self-recording-${Date.now()}.${ext}`);
  const res = await fetch(`${API_BASE}/api/self-recordings`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return parseOrThrow(res);
}

export async function listMySelfRecordings() {
  const res = await fetch(`${API_BASE}/api/self-recordings`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function shareSelfRecording(recordingId, staffId) {
  const res = await fetch(`${API_BASE}/api/self-recordings/${recordingId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ staffId }),
  });
  return parseOrThrow(res);
}

export async function listSharedRecordings() {
  const res = await fetch(`${API_BASE}/api/self-recordings/shared-with-me`, { headers: authHeaders() });
  return parseOrThrow(res);
}

export async function downloadSelfRecording(recordingId) {
  const res = await fetch(`${API_BASE}/api/self-recordings/${recordingId}/download`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Could not download recording');
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'recording.webm';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { API_BASE };
