import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import dayjs from "dayjs";

// Status display config — mirrors CalendarPage / AttendanceEvent.notes values
const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  PRESENT:        { label: "Present",              badge: "bg-green-100 text-green-700" },
  SICK:           { label: "Sick Leave",           badge: "bg-amber-100 text-amber-700" },
  CHILD_SICK:     { label: "Child Sick",           badge: "bg-rose-100 text-rose-700" },
  VACATION:       { label: "Vacation",             badge: "bg-blue-100 text-blue-700" },
  RESERVES:       { label: "Reserves",             badge: "bg-purple-100 text-purple-700" },
  HALF_DAY:       { label: "Half Day Off",         badge: "bg-orange-100 text-orange-700" },
  WORK_FROM_HOME: { label: "Work From Home",       badge: "bg-teal-100 text-teal-700" },
  PUBLIC_HOLIDAY: { label: "Public Holiday - Paid", badge: "bg-indigo-100 text-indigo-700" },
  DAY_OFF:        { label: "Day Off",              badge: "bg-gray-100 text-gray-600" },
};

function StatusBadge({ notes }: { notes?: string | null }) {
  const key = (notes ?? "PRESENT").toUpperCase();
  const cfg = STATUS_CONFIG[key] ?? STATUS_CONFIG.PRESENT;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

export function TimesheetsPage() {
  const [month, setMonth] = useState(dayjs().startOf("month"));
  const from = month.format("YYYY-MM-DD");
  const to = month.endOf("month").format("YYYY-MM-DD");

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "self", from, to],
    queryFn: () => api.get<any>(`/attendance/self?from=${from}&to=${to}&limit=100`),
  });

  const events = data?.items ?? [];
  const clockIns = events.filter((e: any) => e.eventType === "CLOCK_IN");

  // Break down counts by status for the summary row
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of clockIns) {
      const key = (ev.notes ?? "PRESENT").toUpperCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [clockIns]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Timesheet — {month.format("MMMM YYYY")}</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setMonth((m) => m.subtract(1, "month"))}
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
            >
              &larr;
            </button>
            <button
              onClick={() => setMonth((m) => m.add(1, "month"))}
              className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
            >
              &rarr;
            </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-primary-50 p-3">
            <p className="text-xl font-bold text-primary-700">{clockIns.length}</p>
            <p className="text-xs text-primary-600">Total days recorded</p>
          </div>
          {Object.entries(STATUS_CONFIG)
            .filter(([key]) => (statusCounts[key] ?? 0) > 0)
            .map(([key, cfg]) => (
              <div key={key} className={`rounded-lg p-3 ${cfg.badge.replace("text-", "").replace(/\S+$/, "")} bg-opacity-30`}>
                <p className={`text-xl font-bold ${cfg.badge.split(" ")[1]}`}>{statusCounts[key]}</p>
                <p className={`text-xs ${cfg.badge.split(" ")[1]} opacity-80`}>{cfg.label}</p>
              </div>
            ))}
        </div>

        {isLoading ? (
          <p className="text-center text-gray-500">Loading...</p>
        ) : clockIns.length === 0 ? (
          <p className="text-center text-gray-500">No attendance recorded this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {clockIns.map((event: any) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">
                    {dayjs(event.serverTimestamp ?? event.server_ts).format("ddd, MMM D")}
                  </td>
                  <td className="py-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {event.source}
                    </span>
                  </td>
                  <td className="py-2">
                    <StatusBadge notes={event.notes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
