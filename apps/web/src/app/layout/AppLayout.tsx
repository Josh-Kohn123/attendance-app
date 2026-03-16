import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import {
  CalendarDays,
  FileText,
  User,
  BarChart3,
  Users,
  Settings,
  Calendar,
  Building2,
  ScrollText,
  CalendarSearch,
  Share2,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
}

const navItems: NavItem[] = [
  // Employee
  { to: "/calendar", label: "Calendar", icon: <CalendarDays size={20} /> },
  { to: "/timesheets", label: "Timesheets", icon: <FileText size={20} /> },
  { to: "/profile", label: "Profile", icon: <User size={20} /> },
  // Manager
  { to: "/manager/reports", label: "Reports", icon: <BarChart3 size={20} />, roles: ["manager", "admin"] },
  // Admin
  { to: "/admin/employees", label: "Employees", icon: <Users size={20} />, roles: ["admin"] },
  { to: "/admin/policies", label: "Policies", icon: <Settings size={20} />, roles: ["admin"] },
  { to: "/admin/holidays", label: "Holidays", icon: <Calendar size={20} />, roles: ["admin"] },
  { to: "/admin/departments", label: "Departments", icon: <Building2 size={20} />, roles: ["admin"] },
  { to: "/admin/calendar-digest", label: "Calendar Digest", icon: <CalendarSearch size={20} />, roles: ["admin"] },
  { to: "/admin/share", label: "Share", icon: <Share2 size={20} />, roles: ["admin"] },
  { to: "/admin/audit", label: "Audit Log", icon: <ScrollText size={20} />, roles: ["admin"] },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const visibleItems = navItems.filter(
    (item) => !item.roles || item.roles.some((r) => user?.roles.includes(r))
  );

  // Group items
  const employeeItems = visibleItems.filter((i) => !i.to.startsWith("/manager") && !i.to.startsWith("/admin"));
  const managerItems = visibleItems.filter((i) => i.to.startsWith("/manager"));
  const adminItems = visibleItems.filter((i) => i.to.startsWith("/admin"));

  const renderNavGroup = (label: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4">
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {label}
        </p>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <h1 className="text-lg font-bold text-primary-700">Orbs Attendance</h1>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          {renderNavGroup("My Attendance", employeeItems)}
          {renderNavGroup("Management", managerItems)}
          {renderNavGroup("Administration", adminItems)}
        </nav>

        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-medium text-primary-700">
                {user?.displayName?.[0] ?? "?"}
              </div>
            )}
            <div className="flex-1 truncate">
              <p className="text-sm font-medium">{user?.displayName}</p>
              <p className="text-xs text-gray-500">{user?.roles.join(", ")}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center gap-4 border-b bg-white px-4 lg:px-6">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden">
            <Menu size={24} />
          </button>
          <h2 className="text-lg font-semibold capitalize">
            {location.pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "Dashboard"}
          </h2>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
