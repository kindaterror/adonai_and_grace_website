import { Switch, Route } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { MaintenanceProvider, useMaintenanceMode } from "@/contexts/MaintenanceContext";
import { MaintenancePage } from "@/components/MaintenancePage";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import SettingsLayout from "@/components/layout/settings/SettingsLayout";

// -------------------------
// Route-level code splitting
// -------------------------
// Visitor + Auth
const VisitorHome = lazy(() => import("@/pages/visitor/home"));
const Login = lazy(() => import("@/pages/auth/login"));
const Register = lazy(() => import("@/pages/auth/register"));
const VerifyEmail = lazy(() => import("@/pages/auth/verify-email"));
const ForgotPassword = lazy(() => import("@/pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/auth/reset-password"));
// Admin
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminStudents = lazy(() => import("@/pages/admin/students"));
const AdminBooks = lazy(() => import("@/pages/admin/books"));
const AdminTeacher = lazy(() => import("@/pages/admin/teacher"));
const AddTeacher = lazy(() => import("@/pages/admin/add-teacher"));
const AddBook = lazy(() => import("@/pages/admin/add-book"));
const EditBook = lazy(() => import("@/pages/admin/edit-book"));
const BookDetails = lazy(() => import("@/pages/admin/book-details"));
// Teacher
const TeacherDashboard = lazy(() => import("@/pages/teacher/dashboard"));
const TeacherStudents = lazy(() => import("@/pages/teacher/students"));
const TeacherBooks = lazy(() => import("@/pages/teacher/books"));
const TeacherEditBook = lazy(() => import("@/pages/teacher/TeacherEditBook"));
const TeacherBookDetails = lazy(() => import("@/pages/teacher/TeacherBookDetails"));
// Student
const StudentDashboard = lazy(() => import("@/pages/student/dashboard"));
const Storybooks = lazy(() => import("@/pages/student/storybooks"));
const TwoDAnimation = lazy(() => import("@/pages/student/twodanimation"));
const SunMoonStory = lazy(() => import("@/pages/student/stories/sun-moon"));
const NecklaceCombStory = lazy(() => import("@/pages/student/stories/necklace-comb"));
// Bernardo Carpio story (previously mislabeled as CoconutManStory)
// ts-ignore below because the ?ver= query is only for cache busting the built chunk.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const BernardoCarpioStory = lazy(() => import(/* webpackChunkName: "bernardo-carpio-story" */"@/pages/student/stories/bernardo-carpio?ver=2025-10-05-01"));
const EducationalBooks = lazy(() => import("@/pages/student/educational-books"));
const ReadStorybook = lazy(() => import("@/pages/student/read-storybook"));
const ReadEducationalBook = lazy(() => import("@/pages/student/read-educational-book"));
const Progress = lazy(() => import("@/pages/student/progress"));
// Misc
const NotFound = lazy(() => import("@/pages/not-found"));

function Router() {
  const { isMaintenanceMode } = useMaintenanceMode();
  const { user } = useAuth(); // ✅ Now properly imported
  
  // If maintenance mode is enabled, show maintenance page to non-admins
  if (isMaintenanceMode && user?.role !== 'admin') {
    return <MaintenancePage />;
  }
  
  // Otherwise show normal app routes
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div>}>
    <Switch>
      {/* Visitor pages */}
      <Route path="/" component={VisitorHome} />
      
      {/* Auth pages */}
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/auth/login" component={Login} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      
      {/* Admin routes */}
      <Route path="/admin">
        <ProtectedRoute role="admin">
          <AdminDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/students">
        <ProtectedRoute role="admin">
          <AdminStudents />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/books">
        <ProtectedRoute role="admin">
          <AdminBooks />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/teacher">
        <ProtectedRoute role="admin">
          <AdminTeacher />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/add-teacher">
        <ProtectedRoute role="admin">
          <AddTeacher />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/add-book">
        <ProtectedRoute role="admin">
          <AddBook />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/edit-book/:id">
        <ProtectedRoute role="admin">
          <EditBook />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/books/:id">
        <ProtectedRoute role="admin">
          <BookDetails />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings">
        <ProtectedRoute role="admin">
          <SettingsLayout userRole="admin" />
        </ProtectedRoute>
      </Route>

      {/* Teacher routes */}
      <Route path="/teacher">
        <ProtectedRoute role="teacher">
          <TeacherDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/books">
        <ProtectedRoute role="teacher">
          <TeacherBooks />  
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/students">
        <ProtectedRoute role="teacher">
          <TeacherStudents />
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/add-book">
        <ProtectedRoute role="teacher">
          <AddBook />  
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/edit-book/:id">
        <ProtectedRoute role="teacher">
          <TeacherEditBook />
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/books/:id">
        <ProtectedRoute role="teacher">
          <TeacherBookDetails />
        </ProtectedRoute>
      </Route>
      <Route path="/teacher/settings">
        <ProtectedRoute role="teacher">
          <SettingsLayout userRole="teacher" />
        </ProtectedRoute>
      </Route>

      {/* Student routes */}
      <Route path="/student">
        <ProtectedRoute role="student">
          <StudentDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/student/storybooks">
        <ProtectedRoute role="student">
          <Storybooks />
        </ProtectedRoute>
      </Route>
      <Route path="/student/twodanimation">
        <ProtectedRoute role="student">
          <TwoDAnimation />
        </ProtectedRoute>
      </Route>
      <Route path="/student/read-twodanimation/sun-moon">
        <ProtectedRoute role="student">
          <SunMoonStory />
        </ProtectedRoute>
      </Route> 
      <Route path="/student/read-twodanimation/necklace-comb">
        <ProtectedRoute role="student">
          <NecklaceCombStory />
        </ProtectedRoute>
      </Route>
      <Route path="/student/read-twodanimation/bernardo-carpio">
        <ProtectedRoute role="student">
          <BernardoCarpioStory />
        </ProtectedRoute>
      </Route>
      <Route path="/student/educational-books">
        <ProtectedRoute role="student">
          <EducationalBooks />
        </ProtectedRoute>
      </Route>
      <Route path="/student/progress">
        <ProtectedRoute role="student">
          <Progress />
        </ProtectedRoute>
      </Route>
      <Route path="/student/settings">
        <ProtectedRoute role="student">
          <SettingsLayout userRole="student" />
        </ProtectedRoute>
      </Route>
      
      {/* Book reader routes */}
      <Route path="/student/storybooks/:id">
        <ProtectedRoute role="student">
          <ReadStorybook />
        </ProtectedRoute>
      </Route>
      
      <Route path="/student/educational-books/:id">
        <ProtectedRoute role="student">
          <ReadEducationalBook />
        </ProtectedRoute>
      </Route>
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MaintenanceProvider>
          <Router />
          <Toaster />
        </MaintenanceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;