import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Login from '../pages/Login';
import SignUp from '../pages/SignUp';
import StudentDashboard from '../pages/student/StudentDashboard';
import FaceRegistration from '../pages/student/FaceRegistration';
import StaffDashboard from '../pages/staff/StaffDashboard';
import StaffRegister from '../pages/staff/StaffRegister';
import AdminDashboard from '../pages/admin/AdminDashboard';

// Custom component to protect routes based on login and user role
const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  allowedRoles?: ('student' | 'staff' | 'admin')[];
}> = ({ children, allowedRoles }) => {
  const { currentUser, userProfile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-slate-400">Verifying session...</p>
      </div>
    );
  }

  if (!currentUser || !userProfile) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userProfile.role)) {
    // Redirect to their respective correct route
    if (userProfile.role === 'student') return <Navigate to="/student/dashboard" replace />;
    if (userProfile.role === 'staff') return <Navigate to="/staff/dashboard" replace />;
    if (userProfile.role === 'admin') return <Navigate to="/admin/dashboard" replace />;
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Custom component to verify if face registration is complete
const StudentFaceCheckRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { studentProfile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-slate-400 font-mono">Checking security parameters...</p>
      </div>
    );
  }

  if (studentProfile && !studentProfile.faceRegistered) {
    return <Navigate to="/RegisterFace" replace />;
  }

  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  const { currentUser, userProfile } = useAuth();

  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          currentUser && userProfile ? (
            userProfile.role === 'student' ? (
              <Navigate to="/student/dashboard" replace />
            ) : userProfile.role === 'staff' ? (
              <Navigate to="/staff/dashboard" replace />
            ) : (
              <Navigate to="/admin/dashboard" replace />
            )
          ) : (
            <Login />
          )
        }
      />
      
      <Route
        path="/signup"
        element={
          currentUser && userProfile ? (
            userProfile.role === 'student' ? (
              <Navigate to="/student/dashboard" replace />
            ) : userProfile.role === 'staff' ? (
              <Navigate to="/staff/dashboard" replace />
            ) : (
              <Navigate to="/admin/dashboard" replace />
            )
          ) : (
            <SignUp />
          )
        }
      />

      {/* Student Protected Routes */}
      <Route
        path="/student"
        element={<Navigate to="/student/dashboard" replace />}
      />
      <Route
        path="/student/dashboard"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            <StudentFaceCheckRoute>
              <StudentDashboard />
            </StudentFaceCheckRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/student/register-face"
        element={
          <Navigate to="/RegisterFace" replace />
        }
      />

      <Route
        path="/RegisterFace"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            {/* If face is already registered, go back to dashboard */}
            {useAuth().studentProfile?.faceRegistered ? (
              <Navigate to="/student/dashboard" replace />
            ) : (
              <FaceRegistration />
            )}
          </ProtectedRoute>
        }
      />

      {/* Staff Protected Routes */}
      <Route
        path="/staff"
        element={<Navigate to="/staff/dashboard" replace />}
      />
      <Route
        path="/staff-dashboard"
        element={<Navigate to="/staff/dashboard" replace />}
      />
      <Route
        path="/staff/dashboard"
        element={
          <ProtectedRoute allowedRoles={['staff', 'admin']}>
            <StaffDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/staff/register"
        element={
          currentUser && userProfile ? (
            userProfile.role === 'student' ? (
              <Navigate to="/student/dashboard" replace />
            ) : userProfile.role === 'staff' ? (
              <Navigate to="/staff/dashboard" replace />
            ) : (
              <Navigate to="/admin/dashboard" replace />
            )
          ) : (
            <StaffRegister />
          )
        }
      />

      {/* Admin Protected Routes */}
      <Route
        path="/admin"
        element={<Navigate to="/admin/dashboard" replace />}
      />
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      {/* Catch All - Redirect based on role or to login */}
      <Route
        path="*"
        element={
          currentUser && userProfile ? (
            userProfile.role === 'student' ? (
              <Navigate to="/student/dashboard" replace />
            ) : userProfile.role === 'staff' ? (
              <Navigate to="/staff/dashboard" replace />
            ) : (
              <Navigate to="/admin/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
};

export default AppRoutes;
