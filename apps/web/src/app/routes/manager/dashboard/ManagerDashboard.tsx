import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import dayjs from "dayjs";
import { CheckCircle, Clock, AlertCircle, ChevronLeft, ChevronRight, User } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: typeof CheckCircle }> = {
  APPROVED:  { label: "Approved",           badge: "bg-green-100 text-green-700", icon: CheckCircle },
  SUBMITTED: { label: "Waiting Approval",   badge: "bg-blue-100 text-blue-700",   icon: Clock },
  REJECTED:  { label: "Rejected",           badge: "bg-red-100 text-red-700",     icon: AlertCircle },
  DRAFT:     { label: "Pending Submission",  badge: "bg-gray-100 text-gray-500",   icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.badge}`}>
      <Icon size={12} />
      {cfg.label}
    </span>
  );
}

export function ManagerDashboard() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(dayjs().startOf("month"));
  const m = month.month() + 1;
  const y = month.year();

  const { data: teamStatus, isLoading } = useQuery({
    queryKey: ["monthly-reports", "team-status", m, y],
    queryFn: () => api.get<any>(`/monthly-reports/team-status?month=${m}&year=${y}`),
  });

  const items: any[] = (teamStatus as any)?.data ?? teamStatus ?? [];

  // Separate own report from team reports
  const selfReport = items.find((i: any) => i.isSelf);
  const teamReports = items.filter((i: any) => !i.isSelf);

  // Summary counts
  const counts = useMemo(() => {
    const c = { approved: 0, submitted: 0, rejected: 0, draft: 0 };
    for (const item of items) {
      const s = (item.status ?? "DRAFT").toUpperCase();
      if (s === "APPROVED") c.approved++;
      else if (s === "SUBMITTED") c.submitted++;
      else if (s === "REJECTED") c.rejected++;
      else c.draft++;
    }
    return c;
  }, [items]);

  // Approve / Reject mutations
  const approveMut = useMutation({
    mutationFn: (reportId: string) => api.post(`/monthly-reports/${reportId}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["monthly-reports"] }),
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
    <div className="mx-auto max-w-4xl">
      {/* Month selector */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold">Monthly Reports — {month.format("MMMM YYYY")}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth((m) => m.subtract(1, "month"))}
            className="rounded-lg border p-2 hover:bg-gray-50"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setMonth(dayjs().startOf("month"))}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            This month
          </button>
          <button
            onClick={() => setMonth((m) => m.add(1, "month"))}
            className="rounded-lg border p-2 hover:bg-gray-50"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-green-50 p-4">
          <p className="text-2xl font-bold text-green-700">{counts.approved}</p>
          <p className="text-xs text-green-600">Approved</p>
        </div>
        <div className="rounded-xl bg-blue-50 p-4">
          <p className="text-2xl font-bold text-blue-700">{counts.submitted}</p>
          <p className="text-xs text-blue-600">Waiting Approval</p>
        </div>
        <div className="rounded-xl bg-red-50 p-4">
          <p className="text-2xl font-bold text-red-700">{counts.rejected}</p>
          <p className="text-xs text-red-600">Rejected</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-4">
          <p className="text-2xl font-bold text-gray-600">{counts.draft}</p>
          <p className="text-xs text-gray-500">Pending Submission</p>
        </div>
      </div>

      {/* Own report — self-approval */}
      {selfReport && (
        <div className="mb-6 rounded-xl border-2 border-primary-200 bg-primary-50 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-200">
                <User size={18} className="text-primary-700" />
              </div>
              <div>
                <p className="font-semibold text-primary-900">Your Report</p>
                <p className="text-sm text-primary-600">{month.format("MMMM YYYY")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={selfReport.status} />
              {selfReport.status === "SUBMITTED" && selfReport.reportId && (
                <button
                  onClick={() => approveMut.mutate(selfReport.reportId)}
                  disabled={approveMut.isPending}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {approveMut.isPending ? "Approving..." : "Self-Approve"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team employee list */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h3 className="font-semibold">Team Reports</h3>
        </div>
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : teamReports.length === 0 ? (
          <p className="p-6 text-center text-gray-400">No employees found for this period.</p>
        ) : (
          <div className="divide-y">
            {teamReports.map((item: any) => (
              <div key={item.employeeId} className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium">{item.employeeName}</p>
                  <p className="text-xs text-gray-500">
                    {item.departmentName ?? "No department"} · {item.employeeEmail}
                  </p>
                  {item.status === "REJECTED" && item.reviewComment && (
                    <p className="mt-1 text-xs text-red-500">Rejected: {item.reviewComment}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={item.status} />
                  {item.status === "SUBMITTED" && item.reportId && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveMut.mutate(item.reportId)}
                        disabled={approveMut.isPending}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setRejectTarget(item)}
                        className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="mb-3 text-lg font-semibold">Reject Report</h4>
            <p className="mb-3 text-sm text-gray-500">
              Rejecting the report for <strong>{rejectTarget.employeeName}</strong>. Please provide a reason:
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
