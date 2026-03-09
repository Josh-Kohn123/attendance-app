import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";

interface AdminUser {
  id: string;
  displayName: string;
  email: string;
}

export function PoliciesPage() {
  const queryClient = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ["policies"],
    queryFn: () => api.get<any>("/admin/policies"),
  });

  const { data: adminUsers = [] } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => api.get<AdminUser[]>("/admin/admin-users"),
  });

  const [form, setForm] = useState({
    monthStartDay: 1,
    autoLogoutTime: "",
    autoLogoutEnabled: false,
    reminderTime: "",
    reminderEnabled: false,
    timezone: "Asia/Jerusalem",
    calendarDigestAdminUserId: null as string | null,
  });

  useEffect(() => {
    if (org) {
      setForm({
        monthStartDay: org.monthStartDay ?? 1,
        autoLogoutTime: org.autoLogoutTime ?? "",
        autoLogoutEnabled: org.autoLogoutEnabled ?? false,
        reminderTime: org.reminderTime ?? "",
        reminderEnabled: org.reminderEnabled ?? false,
        timezone: org.timezone ?? "Asia/Jerusalem",
        calendarDigestAdminUserId: org.calendarDigestAdminUserId ?? null,
      });
    }
  }, [org]);

  const save = useMutation({
    mutationFn: () => api.patch("/admin/policies", form),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h3 className="mb-4 text-lg font-semibold">Organization Policies</h3>
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Month Start Day</label>
            <input type="number" min={1} max={28} value={form.monthStartDay} onChange={(e) => setForm({ ...form, monthStartDay: parseInt(e.target.value) })} className="w-32 rounded-lg border px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-gray-500">Which day of the month attendance resets (1-28)</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
            <input type="text" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="w-64 rounded-lg border px-3 py-2 text-sm" />
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto Logout</p>
                <p className="text-sm text-gray-500">Automatically mark end-of-day at a specific time</p>
              </div>
              <button
                onClick={() => setForm({ ...form, autoLogoutEnabled: !form.autoLogoutEnabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.autoLogoutEnabled ? "bg-primary-600" : "bg-gray-300"}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.autoLogoutEnabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            {form.autoLogoutEnabled && (
              <input type="time" value={form.autoLogoutTime} onChange={(e) => setForm({ ...form, autoLogoutTime: e.target.value })} className="mt-3 rounded-lg border px-3 py-2 text-sm" />
            )}
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Daily Reminders</p>
                <p className="text-sm text-gray-500">Send clock-in reminders to employees</p>
              </div>
              <button
                onClick={() => setForm({ ...form, reminderEnabled: !form.reminderEnabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.reminderEnabled ? "bg-primary-600" : "bg-gray-300"}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.reminderEnabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            {form.reminderEnabled && (
              <input type="time" value={form.reminderTime} onChange={(e) => setForm({ ...form, reminderTime: e.target.value })} className="mt-3 rounded-lg border px-3 py-2 text-sm" />
            )}
          </div>

          <div className="rounded-lg border p-4">
            <p className="font-medium">Calendar Digest Admin</p>
            <p className="mb-3 text-sm text-gray-500">
              This admin receives the morning email listing calendar events and confirms attendance changes before they are applied.
            </p>
            <select
              value={form.calendarDigestAdminUserId ?? ""}
              onChange={(e) =>
                setForm({ ...form, calendarDigestAdminUserId: e.target.value || null })
              }
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">— No admin assigned —</option>
              {adminUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </select>
            {adminUsers.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                No admin users found. Assign the "admin" role to a user first.
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-6 rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {save.isPending ? "Saving..." : "Save Policies"}
        </button>
        {save.isSuccess && <p className="mt-2 text-sm text-green-600">Policies saved.</p>}
      </div>
    </div>
  );
}
