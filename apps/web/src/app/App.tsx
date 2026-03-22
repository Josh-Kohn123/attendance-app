import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./routes/login/LoginPage";
import { AuthCallback } from "./routes/login/AuthCallback";
import { NotRegisteredPage } from "./routes/login/NotRegisteredPage";
import { CalendarPage } from "./routes/employee/calendar/CalendarPage";
import { TimesheetsPage } from "./routes/employee/timesheets/TimesheetsPage";
import { ProfilePage } from "./routes/employee/profile/ProfilePage";
import { ManagerReports } from "./routes/manager/reports/ManagerReports";
import { CreateReportPage } from "./routes/manager/create-report/CreateReportPage";
import { EmployeesAdmin } from "./routes/admin/employees/EmployeesAdmin";
import { PoliciesPage } from "./routes/admin/policies/PoliciesPage";
import { HolidaysPage } from "./routes/admin/holidays/HolidaysPage";
import { DepartmentsPage } from "./routes/admin/departments/DepartmentsPage";
import { AuditLogPage } from "./routes/admin/audit/AuditLogPage";
import { AdminCalendarDigestPage } from "./routes/admin/calendar-digest/AdminCalendarDigestPage";
import { SharePage } from "./routes/admin/share/SharePage";
import { CalendarDigestPage } from "./routes/digest/CalendarDigestPage";

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/not-registered" element={<NotRegisteredPage />} />
        {/* Public token-authenticated route — no login required */}
        <Route path="/digest/:token" element={<CalendarDigestPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Employee routes */}
        <Route path="/" element={<Navigate to="/calendar" replace />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/timesheets" element={<TimesheetsPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        {/* Manager routes */}
        <Route path="/manager" element={<Navigate to="/manager/reports" replace />} />
        <Route path="/manager/reports" element={<ManagerReports />} />
        <Route path="/manager/create-report/:employeeId" element={<CreateReportPage />} />

        {/* Admin routes */}
        <Route path="/admin/employees" element={<EmployeesAdmin />} />
        <Route path="/admin/policies" element={<PoliciesPage />} />
        <Route path="/admin/holidays" element={<HolidaysPage />} />
        <Route path="/admin/departments" element={<DepartmentsPage />} />
        <Route path="/admin/audit" element={<AuditLogPage />} />
        <Route path="/admin/calendar-digest" element={<AdminCalendarDigestPage />} />
        <Route path="/admin/share" element={<SharePage />} />
      </Route>
      {/* Public token-authenticated route — works whether logged in or not */}
      <Route path="/digest/:token" element={<CalendarDigestPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
