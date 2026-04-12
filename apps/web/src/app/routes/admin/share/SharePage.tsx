/**
 * Admin Share Page
 *
 * Provides:
 * - Download PDF / Excel reports for the current reporting period
 * - Send summary emails to all managers
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { getReportingPeriod } from "@orbs/shared";
import { Mail, FileSpreadsheet, FileText, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import dayjs from "dayjs";

export function SharePage() {
  // Fetch org config to get monthStartDay
  const { data: org } = useQuery<{ monthStartDay: number }>({
    queryKey: ["org-config"],
    queryFn: () => api.get("/admin/policies/public"),
  });

  const monthStartDay = org?.monthStartDay ?? 26;

  // Compute *current* reporting month to use as the default
  const now = dayjs();
  const currentDay = now.date();
  const currentLabelMonth = currentDay >= monthStartDay ? now.month() + 2 : now.month() + 1;
  const currentLabelYear = currentLabelMonth > 12 ? now.year() + 1 : now.year();
  const currentMonth = currentLabelMonth > 12 ? currentLabelMonth - 12 : currentLabelMonth;
  const currentYear = currentLabelYear;

  // Selectable month/year — defaults to the current reporting period
  const [m, setM] = useState(currentMonth);
  const [y, setY] = useState(currentYear);

  const { from: periodFrom, to: periodTo } = getReportingPeriod(m, y, monthStartDay);
  const periodLabel = dayjs().year(y).month(m - 1).format("MMMM YYYY");
  const isCurrentPeriod = m === currentMonth && y === currentYear;

  const goBack = () => { if (m === 1) { setM(12); setY(y - 1); } else setM(m - 1); };
  const goForward = () => { if (m === 12) { setM(1); setY(y + 1); } else setM(m + 1); };
  const goToCurrent = () => { setM(currentMonth); setY(currentYear); };

  const [showConfirm, setShowConfirm] = useState(false);

  // Download handlers
  const handleDownload = (format: "EXCEL" | "PDF") => {
    const token = localStorage.getItem("auth_token");
    const url = `/api/reports/download?format=${format}&from=${periodFrom}&to=${periodTo}`;
    // Open in new tab — the endpoint streams the file
    const link = document.createElement("a");
    link.href = url;
    // Add auth header via fetch and download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `attendance-report-${periodFrom}-to-${periodTo}.${format === "EXCEL" ? "xlsx" : "pdf"}`;
        a.click();
        URL.revokeObjectURL(objUrl);
      });
  };

  // Send manager summaries
  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<{ sent: number }>("/reports/send-manager-summaries", {
        from: periodFrom,
        to: periodTo,
        month: m,
        year: y,
      }),
    onSuccess: () => setShowConfirm(false),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Share</h1>
          <div className="flex items-center gap-2">
            <button onClick={goBack} className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-gray-50">
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={goToCurrent}
              disabled={isCurrentPeriod}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-default"
            >
              <Calendar size={14} />
              Current period
            </button>
            <button onClick={goForward} className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-gray-50">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Reporting period: <span className="font-medium text-gray-700">{periodLabel}</span>{" "}
          ({periodFrom} to {periodTo})
        </p>
      </div>

      {/* Download section */}
      <div className="rounded-xl border bg-white p-6 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Download Reports</h2>
        <p className="text-sm text-gray-500 mb-4">
          Download the full attendance report for {periodLabel}.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => handleDownload("EXCEL")}
            className="flex items-center gap-2 rounded-lg border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
          >
            <FileSpreadsheet size={18} />
            Download Excel
          </button>
          <button
            onClick={() => handleDownload("PDF")}
            className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <FileText size={18} />
            Download PDF
          </button>
        </div>
      </div>

      {/* Send emails section */}
      <div className="rounded-xl border bg-white p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Send Manager Summaries</h2>
        <p className="text-sm text-gray-500 mb-4">
          Send an attendance summary email to each manager with their team's data for {periodLabel}.
        </p>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Mail size={18} />
            Send Summary Emails
          </button>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800 mb-3">
              This will send an email to all managers with their team's attendance summary. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {sendMutation.isPending ? "Sending..." : "Confirm & Send"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-lg border px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {sendMutation.isSuccess && (
          <p className="mt-3 text-sm text-green-600">
            Emails sent to {sendMutation.data.sent} manager{sendMutation.data.sent === 1 ? "" : "s"}.
          </p>
        )}
        {sendMutation.isError && (
          <p className="mt-3 text-sm text-red-600">
            {(sendMutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
