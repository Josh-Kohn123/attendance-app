import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../api/client";
import { getReportingPeriod } from "@orbs/shared";
import dayjs from "dayjs";
import { CheckCircle, Clock, AlertCircle, User, PenLine } from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────── */

function StatBadge({ count, cls }: { count: number; cls: string }) {
  if (count === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{count}</span>
  );
}

const REPORT_STATUS: Record<string, { label: string; badge: string; icon: typeof CheckCircle }> = {
  APPROVED:  { label: "Approved",           badge: "bg-green-100 text-green-700", icon: CheckCircle },
  SUBMITTED: { label: "Waiting Approval",   badge: "bg-blue-100 text-blue-700",   icon: Clock },
  REJECTED:  { label: "Rejected",           badge: "bg-red-100 text-red-700",     icon: AlertCircle },
  DRAFT:     { label: "Pending Submission",  badge: "bg-gray-100 text-gray-500",   icon: AlertCircle },
};

function ReportStatusBadge({ status }: { status: string }) {
  const cfg = REPORT_STATUS[status] ?? REPORT_STATUS.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.badge}`}>
      <Icon size={12} /> {cfg.label}
    </span>
  );
}

/* ── component ───────────────────────────────────────────────────── */

export function ManagerReports() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [m, setM] = useState(dayjs().month() + 1);
  const [y, setY] = useState(dayjs().year());

  // Fetch org config to get monthStartDay (public endpoint, all roles)
  const { data: orgConfig } = useQuery<{ monthStartDay: number }>({
    queryKey: ["org-config"],
    queryFn: () => api.get("/admin/policies/public"),
  });
  const monthStartDay = orgConfig?.monthStartDay ?? 26;

  const { from, to } = getReportingPeriod(m, y, monthStartDay);
  const month = dayjs().year(y).month(m - 1);

  /* attendance data */
  const { data: report, isLoading: loadingReport } = useQuery({
    queryKey: ["reports", "team", from, to],
    queryFn: () => api.get<any>(`/reports/team?from=${from}&to=${to}`),
  });
  const attendanceRows: any[] = (report as any)?.data ?? report ?? [];
  const attendanceByEmpId = new Map(attendanceRows.map((r: any) => [r.employeeId, r]));

  /* monthly report status data */
  const { data: teamStatus, isLoading: loadingStatus } = useQuery({
    queryKey: ["monthly-reports", "team-status", m, y],
    queryFn: () => api.get<any>(`/monthly-reports/team-status?month=${m}&year=${y}`),
  });
  const statusItems: any[] = (teamStatus as any)?.data ?? teamStatus ?? [];

  /* merge: attendance + report status by employeeId */
  const selfReport = statusItems.find((i: any) => i.isSelf);
  const teamItems = statusItems.filter((i: any) => !i.isSelf);

  const mergedRows = teamItems.map((item: any) => {
    const att = attendanceByEmpId.get(item.employeeId) ?? {};
    return { ...item, ...att };
  });

  const isLoading = loadingReport || loadingStatus;

  /* approve / reject */
  const approveMut = useMutation({
    mutationFn: (reportId: string) => api.post(`/monthly-reports/${reportId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
    },
  });

  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectComment, setRejectComment] = useState("");
  const rejectMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      api.post(`/monthly-reports/${id}/reject`, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
      setRejectTarget(null);
      setRejectComment("");
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header + month nav */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Team Report — {month.format("MMMM YYYY")}</h3>
          {monthStartDay !== 1 && (
            <p className="text-xs text-gray-400">{from} to {to}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { if (m === 1) { setM(12); setY(y - 1); } else setM(m - 1); }} className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50">&larr;</button>
          <button onClick={() => { setM(dayjs().month() + 1); setY(dayjs().year()); }} className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50">This month</button>
          <button onClick={() => { if (m === 12) { setM(1); setY(y + 1); } else setM(m + 1); }} className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50">&rarr;</button>
        </div>
      </div>

      {/* Self-report approval banner */}
      {selfReport && (
        <div className="mb-4 rounded-xl border-2 border-primary-200 bg-primary-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-200">
                <User size={16} className="text-primary-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary-900">Your Report — {month.format("MMMM YYYY")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ReportStatusBadge status={selfReport.status} />
              {selfReport.status === "SUBMITTED" && selfReport.reportId && (
                <button
                  onClick={() => approveMut.mutate(selfReport.reportId)}
                  disabled={approveMut.isPending}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {approveMut.isPending ? "Approving..." : "Self-Approve"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main table */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : !mergedRows.length ? (
          <p className="p-6 text-center text-gray-500">No data for this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="p-3 font-medium bg-white">Employee</th>
                <th className="p-3 font-medium bg-white">Department</th>
                <th className="p-3 font-medium text-center bg-white">Total</th>
                <th className="p-3 font-medium text-center bg-white">Present</th>
                <th className="p-3 font-medium text-center bg-white">Sick</th>
                <th className="p-3 font-medium text-center bg-white">Child Sick</th>
                <th className="p-3 font-medium text-center bg-white">Vacation</th>
                <th className="p-3 font-medium text-center bg-white">Reserves</th>
                <th className="p-3 font-medium text-center bg-white">Half Day Off</th>
                <th className="p-3 font-medium text-center bg-white">Work From Home</th>
                <th className="p-3 font-medium text-center bg-white">Public Holiday</th>
                <th className="p-3 font-medium text-center bg-white">Day Off</th>
                <th className="p-3 font-medium text-center bg-white">Report Status</th>
                <th className="p-3 font-medium text-center bg-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row: any) => (
                <tr key={row.employeeId} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3 font-medium">{row.employeeName ?? row.name}</td>
                  <td className="p-3 text-gray-500">{row.departmentName ?? row.department ?? "—"}</td>
                  <td className="p-3 text-center">
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">
                      {row.totalDays ?? 0}
                    </span>
                  </td>
                  <td className="p-3 text-center"><StatBadge count={row.present ?? 0} cls="bg-green-100 text-green-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.sick ?? 0} cls="bg-amber-100 text-amber-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.childSick ?? 0} cls="bg-rose-100 text-rose-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.vacation ?? 0} cls="bg-blue-100 text-blue-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.reserves ?? 0} cls="bg-purple-100 text-purple-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.halfDay ?? 0} cls="bg-orange-100 text-orange-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.workFromHome ?? 0} cls="bg-teal-100 text-teal-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.publicHoliday ?? 0} cls="bg-indigo-100 text-indigo-700" /></td>
                  <td className="p-3 text-center"><StatBadge count={row.dayOff ?? 0} cls="bg-gray-100 text-gray-600" /></td>
                  <td className="p-3 text-center">
                    <ReportStatusBadge status={row.status ?? "DRAFT"} />
                  </td>
                  <td className="p-3 text-center">
                    {row.status === "SUBMITTED" && row.reportId ? (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => approveMut.mutate(row.reportId)}
                          disabled={approveMut.isPending}
                          className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectTarget(row)}
                          className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                        >
                          Reject
                        </button>
                      </div>
                    ) : ["DRAFT", "REJECTED"].includes(row.status ?? "DRAFT") ? (
                      <button
                        onClick={() => navigate(`/manager/create-report/${row.employeeId}?month=${m}&year=${y}`)}
                        className="inline-flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700"
                      >
                        <PenLine size={12} />
                        {(row.status ?? "DRAFT") === "REJECTED" ? "Edit" : "Create"}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="mb-3 text-lg font-semibold">Reject Report</h4>
            <p className="mb-3 text-sm text-gray-500">
              Rejecting the report for <strong>{rejectTarget.employeeName ?? rejectTarget.name}</strong>. Please provide a reason:
            </p>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
            {rejectMut.isError && (
              <p className="mt-2 text-sm text-red-600">{(rejectMut.error as Error).message}</p>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => { setRejectTarget(null); setRejectComment(""); }}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMut.mutate({ id: rejectTarget.reportId, comment: rejectComment })}
                disabled={!rejectComment.trim() || rejectMut.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {rejectMut.isPending ? "Rejecting..." : "Reject Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
