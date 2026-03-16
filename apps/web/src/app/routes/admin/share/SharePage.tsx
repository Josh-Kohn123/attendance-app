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
import { Download, Mail, FileSpreadsheet, FileText } from "lucide-react";
import dayjs from "dayjs";

export function SharePage() {
  const today = dayjs().format("YYYY-MM-DD");

  // Fetch org config to get monthStartDay
  const { data: org } = useQuery<{ monthStartDay: number }>({
    queryKey: ["org-config"],
    queryFn: () => api.get("/admin/policies/public"),
  });

  const monthStartDay = org?.monthStartDay ?? 26;

  // Compute current reporting period
  const now = dayjs();
  const currentDay = now.date();
  const labelMonth = currentDay >= monthStartDay ? now.month() + 2 : now.month() + 1;
  const labelYear = labelMonth > 12 ? now.year() + 1 : now.year();
  const adjustedMonth = labelMonth > 12 ? labelMonth - 12 : labelMonth;

  const { from: periodFrom, to: periodTo } = getReportingPeriod(adjustedMonth, labelYear, monthStartDay);
  const periodLabel = `${new Date(labelYear, adjustedMonth - 1).toLocaleString("default", { month: "long" })} ${labelYear}`;

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
        month: adjustedMonth,
        year: labelYear,
      }),
    onSuccess: () => setShowConfirm(false),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Share</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reporting period: <span className="font-medium text-gray-700">{periodLabel}</span>{" "}
          ({periodFrom} to {periodTo})
        </p>
      </div>

      {/* Download section */}
      <div className="rounded-xl border bg-white p-6 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Download Reports</h2>
        <p className="text-sm text-gray-500 mb-4">
          Download the full attendance report for the current reporting period.
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
          Send an attendance summary email to each manager with their team's data for this period.
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
