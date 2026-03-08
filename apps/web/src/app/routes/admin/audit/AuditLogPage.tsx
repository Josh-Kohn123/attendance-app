import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import dayjs from "dayjs";

export function AuditLogPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", page],
    queryFn: () => api.get<any>(`/admin/audit-log?page=${page}&limit=30`),
  });

  const logs = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const actionColor: Record<string, string> = {
    EMPLOYEE_CREATED: "bg-green-100 text-green-700",
    EMPLOYEE_UPDATED: "bg-blue-100 text-blue-700",
    ROLE_ASSIGNED: "bg-purple-100 text-purple-700",
    ROLE_REVOKED: "bg-red-100 text-red-700",
    POLICY_UPDATED: "bg-yellow-100 text-yellow-700",
    REPORT_EXPORTED: "bg-indigo-100 text-indigo-700",
    REPORT_LOCKED: "bg-orange-100 text-orange-700",
    REPORT_SIGNED: "bg-teal-100 text-teal-700",
    ATTENDANCE_CORRECTED: "bg-cyan-100 text-cyan-700",
  };

  return (
    <div>
      <h3 className="mb-4 text-lg font-semibold">Audit Log</h3>

      <div className="rounded-xl bg-white shadow-sm">
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : logs.length === 0 ? (
          <p className="p-6 text-center text-gray-500">No audit entries yet.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="p-4 font-medium">Timestamp</th>
                  <th className="p-4 font-medium">User</th>
                  <th className="p-4 font-medium">Action</th>
                  <th className="p-4 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="p-4 text-gray-500">{dayjs(log.createdAt).format("MMM D HH:mm")}</td>
                    <td className="p-4">{log.user?.displayName ?? log.userId}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionColor[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                        {log.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-4 text-gray-500">{log.targetType ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t p-4">
              <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">Prev</button>
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
