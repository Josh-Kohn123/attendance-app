import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { Plus, Search, Pencil, Trash2, X, UserCheck } from "lucide-react";

const ROLES = ["employee", "manager", "admin"] as const;
type Role = (typeof ROLES)[number];

const ROLE_BADGES: Record<Role, string> = {
  employee: "bg-blue-100 text-blue-700",
  manager: "bg-purple-100 text-purple-700",
  admin: "bg-orange-100 text-orange-700",
};

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  SUNDAY: "Sunday", MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday",
};
const PERCENTAGE_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

const emptyForm = {
  email: "", firstName: "", lastName: "", employeeNumber: "",
  phone: "", position: "", startDate: "", role: "employee" as Role,
  departmentId: "", managerId: "",
  employmentPercentage: 100, daysOff: [] as string[],
  requireSelfSubmit: true,
};

type FormState = typeof emptyForm;

/** Strip empty optional fields and build a clean payload ready for the API */
function buildPayload(form: FormState, isNew: boolean) {
  const payload: Record<string, unknown> = {
    firstName: form.firstName,
    lastName: form.lastName,
    role: form.role,
    siteId: "00000000-0000-0000-0000-000000000010",
  };

  if (isNew) {
    payload.email = form.email;
    payload.startDate = form.startDate;
  }

  if (form.employeeNumber) payload.employeeNumber = form.employeeNumber;
  if (form.phone) payload.phone = form.phone;
  if (form.position) payload.position = form.position;
  if (form.departmentId) payload.departmentId = form.departmentId;
  if (form.managerId) payload.managerId = form.managerId;
  if (!isNew && form.startDate) payload.startDate = form.startDate;

  payload.employmentPercentage = form.employmentPercentage;
  payload.daysOff = form.daysOff;
  payload.requireSelfSubmit = form.requireSelfSubmit;

  return payload;
}

function EmployeeFormFields({
  form,
  onChange,
  isNew,
  departments,
  managers,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
  isNew: boolean;
  departments: { id: string; name: string }[];
  managers: { id: string; displayName: string; email: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {isNew && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => onChange({ email: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="employee@example.com"
          />
        </div>
      )}
      {[
        { key: "firstName" as const, label: "First Name", type: "text", required: true },
        { key: "lastName" as const, label: "Last Name", type: "text", required: true },
        { key: "employeeNumber" as const, label: "Employee #", type: "text" },
        { key: "phone" as const, label: "Phone", type: "tel" },
        { key: "position" as const, label: "Position", type: "text" },
        { key: "startDate" as const, label: "Start Date", type: "date", required: isNew },
      ].map(({ key, label, type, required }) => (
        <div key={key}>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {label} {required && <span className="text-red-500">*</span>}
          </label>
          <input
            type={type}
            value={form[key]}
            onChange={(e) => onChange({ [key]: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
        </div>
      ))}

      {/* Department selector */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Department</label>
        <select
          value={form.departmentId}
          onChange={(e) => onChange({ departmentId: e.target.value })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">— None —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Manager selector */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Manager {isNew && <span className="text-red-500">*</span>}
        </label>
        <select
          value={form.managerId}
          onChange={(e) => onChange({ managerId: e.target.value })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">— Select manager —</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.email})
            </option>
          ))}
        </select>
      </div>

      {/* Role selector */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
        <select
          value={form.role}
          onChange={(e) => onChange({ role: e.target.value as Role })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Employment percentage */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Employment %</label>
        <select
          value={form.employmentPercentage}
          onChange={(e) => {
            const pct = Number(e.target.value);
            onChange({ employmentPercentage: pct, daysOff: pct === 100 ? [] : form.daysOff });
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          {PERCENTAGE_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}%</option>
          ))}
        </select>
      </div>

      {/* Days off — shown when not 100% */}
      {form.employmentPercentage < 100 && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Specific days off (select which days the employee does not work)
          </label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const selected = form.daysOff.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? form.daysOff.filter((d) => d !== day)
                      : [...form.daysOff, day];
                    onChange({ daysOff: next });
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {WEEKDAY_LABELS[day]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Need to Approve Hours Themselves */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Need to Approve Hours Themselves
        </label>
        <select
          value={form.requireSelfSubmit ? "yes" : "no"}
          onChange={(e) => onChange({ requireSelfSubmit: e.target.value === "yes" })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    </div>
  );
}

// ─── Shared employee table component ─────────────────────────────────────────

function EmployeeTable({
  employees,
  onEdit,
  onDeactivate,
  onReactivate,
  isInactive,
}: {
  employees: any[];
  onEdit?: (emp: any) => void;
  onDeactivate?: (emp: any) => void;
  onReactivate?: (emp: any) => void;
  isInactive?: boolean;
}) {
  if (employees.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="px-4 py-3 font-medium">Name</th>
          <th className="px-4 py-3 font-medium">Email</th>
          <th className="px-4 py-3 font-medium">Role</th>
          <th className="px-4 py-3 font-medium">Department</th>
          <th className="px-4 py-3 font-medium">Manager</th>
          <th className="px-4 py-3 font-medium">Position</th>
          <th className="px-4 py-3 w-20 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {employees.map((emp: any) => {
          const role: Role = emp.user?.userRoles?.[0]?.role ?? "employee";
          return (
            <tr
              key={emp.id}
              className={`border-b last:border-0 hover:bg-gray-50 ${isInactive ? "opacity-70" : ""}`}
            >
              <td className="px-4 py-3 font-medium">
                {emp.firstName} {emp.lastName}
              </td>
              <td className="px-4 py-3 text-gray-500">{emp.email}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGES[role] ?? "bg-gray-100 text-gray-600"}`}>
                  {role}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-500">{emp.department?.name ?? "—"}</td>
              <td className="px-4 py-3 text-gray-500">
                {emp.manager ? (
                  <span title={emp.manager.email}>{emp.manager.displayName}</span>
                ) : "—"}
              </td>
              <td className="px-4 py-3 text-gray-500">{emp.position ?? "—"}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  {!isInactive && onEdit && (
                    <button
                      onClick={() => onEdit(emp)}
                      className="text-gray-400 transition-colors hover:text-primary-600"
                      title="Edit employee"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {!isInactive && onDeactivate && (
                    <button
                      onClick={() => onDeactivate(emp)}
                      className="text-gray-400 transition-colors hover:text-red-600"
                      title="Deactivate employee"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  {isInactive && onReactivate && (
                    <button
                      onClick={() => onReactivate(emp)}
                      className="text-gray-400 transition-colors hover:text-green-600"
                      title="Reactivate employee"
                    >
                      <UserCheck size={15} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EmployeesAdmin() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<any | null>(null);
  const [addForm, setAddForm] = useState<FormState>(emptyForm);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["employees", search],
    queryFn: () => api.get<any>(`/employees?search=${encodeURIComponent(search)}&limit=200`),
  });

  const { data: deptData } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<any>("/departments"),
  });
  const departments: { id: string; name: string }[] = deptData?.data ?? deptData ?? [];

  const { data: allEmpData } = useQuery({
    queryKey: ["employees-all"],
    queryFn: () => api.get<any>("/employees?limit=200"),
  });
  const managers: { id: string; displayName: string; email: string }[] = (
    (allEmpData?.items ?? []) as any[]
  )
    .filter((e: any) => {
      const role = e.user?.userRoles?.[0]?.role;
      const isActive = e.user?.isActive !== false;
      return isActive && (role === "manager" || role === "admin");
    })
    .map((e: any) => ({
      id: e.user?.id ?? "",
      displayName: `${e.firstName} ${e.lastName}`,
      email: e.email,
    }))
    .filter((m: any) => m.id);

  // ─── Create ───────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => {
      if (!addForm.email) throw new Error("Email is required.");
      if (!addForm.firstName) throw new Error("First name is required.");
      if (!addForm.lastName) throw new Error("Last name is required.");
      if (!addForm.startDate) throw new Error("Start date is required.");
      if (addForm.role === "employee" && !addForm.managerId) {
        throw new Error("Please assign a manager for this employee.");
      }
      return api.post("/employees", buildPayload(addForm, true));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowAdd(false);
      setAddForm(emptyForm);
      setFormError(null);
    },
    onError: (err: any) => setFormError(err?.message ?? "Failed to create employee."),
  });

  // ─── Edit ─────────────────────────────────────────────────────
  const openEdit = (emp: any) => {
    setEditForm({
      email: emp.email,
      firstName: emp.firstName,
      lastName: emp.lastName,
      employeeNumber: emp.employeeNumber ?? "",
      phone: emp.phone ?? "",
      position: emp.position ?? "",
      startDate: emp.startDate ? emp.startDate.split("T")[0] : "",
      role: (emp.user?.userRoles?.[0]?.role ?? "employee") as Role,
      departmentId: emp.departmentId ?? "",
      managerId: emp.managerId ?? "",
      employmentPercentage: emp.employmentPercentage ?? 100,
      daysOff: emp.daysOff ?? [],
      requireSelfSubmit: emp.requireSelfSubmit ?? true,
    });
    setEditTarget(emp);
    setFormError(null);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { role } = editForm;
      const payload = buildPayload(editForm, false);
      delete payload.role;
      await api.patch(`/employees/${editTarget.id}`, payload);
      const currentRole = editTarget.user?.userRoles?.[0]?.role;
      if (role !== currentRole && editTarget.userId) {
        await api.patch(`/employees/${editTarget.id}/role`, { role });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setEditTarget(null);
      setFormError(null);
    },
    onError: (err: any) => setFormError(err?.message ?? "Failed to update employee."),
  });

  // ─── Deactivate ───────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/employees/${deleteTarget.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDeleteTarget(null);
    },
  });

  // ─── Reactivate ───────────────────────────────────────────────
  const reactivateMutation = useMutation({
    mutationFn: () => api.patch(`/employees/${reactivateTarget.id}/reactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setReactivateTarget(null);
    },
  });

  const allEmployees: any[] = data?.items ?? [];
  const activeEmployees = allEmployees.filter((e) => e.user?.isActive !== false);
  const inactiveEmployees = allEmployees.filter((e) => e.user?.isActive === false);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Employees</h3>
        <button
          onClick={() => { setShowAdd(true); setAddForm(emptyForm); setFormError(null); }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border py-2 pl-10 pr-4 text-sm"
        />
      </div>

      {/* ── Add Employee Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-semibold">New Employee</h4>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <EmployeeFormFields
              form={addForm}
              onChange={(u) => { setAddForm((f) => ({ ...f, ...u })); setFormError(null); }}
              isNew
              departments={departments}
              managers={managers}
            />
            {(formError || createMutation.isError) && (
              <p className="mt-3 text-sm text-red-600">
                {formError ?? (createMutation.error as Error).message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowAdd(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating..." : "Create Employee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Employee Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-semibold">Edit Employee</h4>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="mb-4 rounded bg-gray-50 px-2 py-1 font-mono text-sm text-gray-500">
              {editTarget.email}
            </p>
            <EmployeeFormFields
              form={editForm}
              onChange={(u) => { setEditForm((f) => ({ ...f, ...u })); setFormError(null); }}
              isNew={false}
              departments={departments}
              managers={managers}
            />
            {(formError || updateMutation.isError) && (
              <p className="mt-3 text-sm text-red-600">
                {formError ?? (updateMutation.error as Error).message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setEditTarget(null)} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deactivate Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <Trash2 size={22} className="text-red-600" />
              </div>
            </div>
            <h4 className="mb-2 text-center text-lg font-semibold">Deactivate Employee?</h4>
            <p className="mb-1 text-center text-sm text-gray-500">
              <strong>{deleteTarget.firstName} {deleteTarget.lastName}</strong> will lose access immediately.
            </p>
            <p className="mb-5 text-center text-xs text-gray-400">
              Their attendance history is preserved. You can reactivate them later if needed.
            </p>
            {deleteMutation.isError && (
              <p className="mb-3 text-center text-sm text-red-600">
                {(deleteMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deactivating..." : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reactivate Confirmation Modal ── */}
      {reactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <UserCheck size={22} className="text-green-600" />
              </div>
            </div>
            <h4 className="mb-2 text-center text-lg font-semibold">Reactivate Employee?</h4>
            <p className="mb-1 text-center text-sm text-gray-500">
              <strong>{reactivateTarget.firstName} {reactivateTarget.lastName}</strong> will regain access immediately.
            </p>
            <p className="mb-5 text-center text-xs text-gray-400">
              They will be able to sign in again and submit attendance reports.
            </p>
            {reactivateMutation.isError && (
              <p className="mb-3 text-center text-sm text-red-600">
                {(reactivateMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setReactivateTarget(null)} className="flex-1 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => reactivateMutation.mutate()}
                disabled={reactivateMutation.isPending}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {reactivateMutation.isPending ? "Reactivating..." : "Reactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Active Employees Table ── */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b bg-gray-50 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-700">
            Active Employees
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {activeEmployees.length}
            </span>
          </h4>
        </div>
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : activeEmployees.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <p className="text-sm">No active employees yet.</p>
            <p className="mt-1 text-xs">Click "Add Employee" to create the first account.</p>
          </div>
        ) : (
          <EmployeeTable
            employees={activeEmployees}
            onEdit={openEdit}
            onDeactivate={setDeleteTarget}
          />
        )}
      </div>

      {/* ── Inactive Employees Table ── */}
      {inactiveEmployees.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b bg-gray-50 px-4 py-3">
            <h4 className="text-sm font-semibold text-gray-500">
              Inactive Employees
              <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                {inactiveEmployees.length}
              </span>
            </h4>
          </div>
          <EmployeeTable
            employees={inactiveEmployees}
            onReactivate={setReactivateTarget}
            isInactive
          />
        </div>
      )}
    </div>
  );
}
