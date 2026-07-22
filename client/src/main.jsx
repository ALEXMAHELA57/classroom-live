import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.jsx';
import JoinRoom from './components/JoinRoom.jsx';
import Classroom from './components/Classroom.jsx';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import AdminUsers from './components/AdminUsers.jsx';
import Subjects from './components/Subjects.jsx';
import SyllabusViewer from './components/SyllabusViewer.jsx';
import QuizTaker from './components/QuizTaker.jsx';
import QuizResults from './components/QuizResults.jsx';
import AssignmentTaker from './components/AssignmentTaker.jsx';
import AssignmentResults from './components/AssignmentResults.jsx';
import QuizEditor from './components/QuizEditor.jsx';
import AssignmentEditor from './components/AssignmentEditor.jsx';
import Billing from './components/Billing.jsx';
import LiveSessions from './components/LiveSessions.jsx';
import MyRecordings from './components/MyRecordings.jsx';
import SharedRecordings from './components/SharedRecordings.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import './styles.css';

function RequireSuperadmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login?redirect=/admin" replace />;
  if (user.role !== 'superadmin') return <Navigate to="/" replace />;
  return children;
}

function Root() {
  return (
    <AuthProvider>
      <InstallPrompt />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/join/:roomId" element={<JoinRoom />} />
        <Route path="/room/:roomId" element={<Classroom />} />
        <Route path="/subjects" element={<Subjects />} />
        <Route path="/subjects/:subjectId/syllabus" element={<SyllabusViewer />} />
        <Route path="/quizzes/:quizId" element={<QuizTaker />} />
        <Route path="/quizzes/:quizId/results" element={<QuizResults />} />
        <Route path="/quizzes/:quizId/edit" element={<QuizEditor />} />
        <Route path="/subjects/:subjectId/quizzes/new" element={<QuizEditor />} />
        <Route path="/assignments/:assignmentId" element={<AssignmentTaker />} />
        <Route path="/assignments/:assignmentId/results" element={<AssignmentResults />} />
        <Route path="/assignments/:assignmentId/edit" element={<AssignmentEditor />} />
        <Route path="/subjects/:subjectId/assignments/new" element={<AssignmentEditor />} />
        <Route path="/billing" element={<Billing />} />
        <Route
          path="/admin/live-sessions"
          element={
            <RequireSuperadmin>
              <LiveSessions />
            </RequireSuperadmin>
          }
        />
        <Route path="/my-recordings" element={<MyRecordings />} />
        <Route path="/shared-recordings" element={<SharedRecordings />} />
        <Route
          path="/admin"
          element={
            <RequireSuperadmin>
              <AdminUsers />
            </RequireSuperadmin>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
