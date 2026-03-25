/**
 * Admin Calendar Digest Page
 *
 * Replaces the daily email digest. Fetches live Google Calendar events
 * for the current reporting period, matches them to employees, and lets
 * the admin confirm/ignore each entry before applying to attendance records.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { getReportingPeriod } from "@orbs/shared";
import dayjs from "dayjs";

// ─── Types ───────────────────────────────────────────────────────────

interface DigestEmployee {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

interface DigestEntry {
  eventId: string;
  eventTitle: string;
  startDate: string;
  endDate: string;
  matchType: string;
  proposedEmployeeId: string | null;
  proposedStatus: string | null;
  candidateEmployeeIds: string[];
  hasExistingEntry: boolean;
}

interface FetchResult {
  entries: DigestEntry[];
  employees: DigestEmployee[];
}

interface LocalDecision {
  eventId: string;
  decision: "CONFIRMED" | "DECLINED" | "PENDING";
  employeeId?: string;
  status?: string;
  startDate: string;
  endDate: string;
}

// ─── Status options ──────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "SICK", label: "Sick" },
  { value: "CHILD_SICK", label: "Child Sick" },
  { value: "VACATION", label: "Vacation" },
  { value: "RESERVES", label: "Reserves (Miluim)" },
  { value: "HALF_DAY", label: "Half Day Off" },
  { value: "PRESENT", label: "Present" },
  { value: "WORK_FROM_HOME", label: "Work From Home" },
  { value: "PUBLIC_HOLIDAY", label: "Public Holiday - Paid" },
  { value: "DAY_OFF", label: "Day Off" },
];

// ─── Match type badge ────────────────────────────────────────────────

function MatchBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    MATCHED: "bg-green-100 text-green-800",
    AMBIGUOUS_NAME: "bg-amber-100 text-amber-800",
    UNMATCHED: "bg-gray-100 text-gray-700",
    INACTIVE_EMPLOYEE: "bg-red-100 text-red-700",
    UNCLEAR_STATUS: "bg-blue-100 text-blue-800",
  };
  const labels: Record<string, string> = {
    MATCHED: "Matched",
    AMBIGUOUS_NAME: "Ambiguous name",
    UNMATCHED: "Not found",
    INACTIVE_EMPLOYEE: "Inactive employee",
    UNCLEAR_STATUS: "Status unclear",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[type] ?? "bg-gray-100 text-gray-700"}`}>
      {labels[type] ?? type}
    </span>
  );
}

// ─── Entry Row ───────────────────────────────────────────────────────

interface EntryRowProps {
  entry: DigestEntry;
  employees: DigestEmployee[];
  decision: LocalDecision;
  onChange: (updated: LocalDecision) => void;
}

function EntryRow({ entry, employees, decision, onChange }: EntryRowProps) {
  const isLocked = entry.hasExistingEntry || entry.matchType === "INACTIVE_EMPLOYEE";
  const isCreating = decision.decision === "CONFIRMED";
  const isIgnored = decision.decision === "DECLINED";
  const dateRange = entry.startDate === entry.endDate
    ? entry.startDate
    : `${entry.startDate} - ${entry.endDate}`;

  const activeEmployees = employees.filter((e) => e.isActive);

  const handleCreate = () => {
    onChange({
      ...decision,
      decision: "CONFIRMED",
      employeeId: decision.employeeId ?? entry.proposedEmployeeId ?? undefined,
      status: decision.status ?? entry.proposedStatus ?? undefined,
      startDate: decision.startDate ?? entry.startDate,
      endDate: decision.endDate ?? entry.endDate,
    });
  };

  return (
    <div className={`rounded-lg border p-4 ${isLocked ? "bg-gray-50 opacity-70" : isIgnored ? "bg-gray-50" : "bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`font-medium truncate ${isIgnored ? "text-gray-400 line-through" : "text-gray-900"}`}>
              {entry.eventTitle}
            </span>
            <MatchBadge type={entry.matchType} />
            <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{dateRange}</span>
          </div>

          {entry.hasExistingEntry && (
            <p className="text-xs text-gray-500 mt-1">Already applied to attendance records.</p>
          )}

          {entry.matchType === "INACTIVE_EMPLOYEE" && !entry.hasExistingEntry && (
            <p className="text-xs text-red-600 mt-1">Inactive employee — ignore or reassign.</p>
          )}

          {!isLocked && isCreating && (
            <div className="mt-3 flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <select
                  value={decision.employeeId ?? ""}
                  onChange={(e) => onChange({ ...decision, employeeId: e.target.value || undefined })}
                  className="rounded-lg border px-2 py-1.5 text-sm min-w-[200px]"
                >
                  <option value="">-- Select --</option>
                  {(entry.matchType === "AMBIGUOUS_NAME" && entry.candidateEmployeeIds.length > 0
                    ? employees.filter((e) => entry.candidateEmployeeIds.includes(e.id))
                    : activeEmployees
                  ).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Status</label>
                <select
                  value={decision.status ?? ""}
                  onChange={(e) => onChange({ ...decision, status: e.target.value || undefined })}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                >
                  <option value="">-- Select --</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={decision.startDate}
                  onChange={(e) => onChange({ ...decision, startDate: e.target.value })}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={decision.endDate}
                  min={decision.startDate}
                  onChange={(e) => onChange({ ...decision, endDate: e.target.value })}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {!isLocked && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleCreate}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isCreating
                  ? "bg-green-600 text-white"
                  : "border border-green-300 text-green-700 hover:bg-green-50"
              }`}
            >
              Create Entry
            </button>
            <button
              onClick={() => onChange({ ...decision, decision: "DECLINED" })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isIgnored
                  ? "bg-gray-500 text-white"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Ignore
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add Extra Entry form ────────────────────────────────────────────

function AddEntryForm({
  employees,
  defaultDate,
  onAdd,
}: {
  employees: DigestEmployee[];
  defaultDate: string;
  onAdd: (entry: { employeeId: string; status: string; startDate: string; endDate: string }) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("VACATION");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [error, setError] = useState("");

  const activeEmployees = employees.filter((e) => e.isActive);

  function handleAdd() {
    if (!employeeId) { setError("Select an employee"); return; }
    if (!status) { setError("Select a status"); return; }
    setError("");
    onAdd({ employeeId, status, startDate, endDate });
    setEmployeeId("");
    setStatus("VACATION");
    setStartDate(defaultDate);
    setEndDate(defaultDate);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-4 bg-gray-50">
      <p className="text-sm font-medium text-gray-700 mb-3">Add entry not on calendar</p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm min-w-[200px]">
            <option value="">-- Select --</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
        </div>
        <button onClick={handleAdd} className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────

export function AdminCalendarDigestPage() {
  const queryClient = useQueryClient();
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

  // Clamp "to" to today if the period extends into the future
  const effectiveTo = periodTo > today ? today : periodTo;

  // Manual date range inputs — default to current reporting period
  const [fromDate, setFromDate] = useState(periodFrom);
  const [toDate, setToDate] = useState(effectiveTo);

  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});
  const [additionalEntries, setAdditionalEntries] = useState<Array<{ employeeId: string; status: string; startDate: string; endDate: string; _key: number }>>([]);
  const [nextKey, setNextKey] = useState(0);

  // Fetch events mutation
  const fetchMutation = useMutation({
    mutationFn: () => api.get<FetchResult>(`/calendar-digest/fetch?from=${fromDate}&to=${toDate}`),
    onSuccess: (data) => {
      setFetchResult(data);
      setDecisions({});
      setAdditionalEntries([]);
    },
  });

  // Apply entries mutation
  const applyMutation = useMutation({
    mutationFn: () => {
      const confirmed = Object.values(decisions)
        .filter((d) => d.decision === "CONFIRMED" && d.employeeId && d.status)
        .map((d) => ({
          employeeId: d.employeeId!,
          status: d.status!,
          startDate: d.startDate,
          endDate: d.endDate,
        }));

      const extras = additionalEntries.map(({ employeeId, status, startDate, endDate }) => ({
        employeeId,
        status,
        startDate,
        endDate,
      }));

      return api.post<{ applied: number }>("/calendar-digest/apply", {
        entries: confirmed,
        additionalEntries: extras,
      });
    },
    onSuccess: () => {
      // Refetch to update hasExistingEntry flags
      fetchMutation.mutate();
    },
  });

  const getDecision = (entry: DigestEntry): LocalDecision => {
    if (decisions[entry.eventId]) return decisions[entry.eventId];
    return {
      eventId: entry.eventId,
      decision: "PENDING",
      employeeId: entry.proposedEmployeeId ?? undefined,
      status: entry.proposedStatus ?? undefined,
      startDate: entry.startDate,
      endDate: entry.endDate,
    };
  };

  const updateDecision = (updated: LocalDecision) => {
    setDecisions((prev) => ({ ...prev, [updated.eventId]: updated }));
  };

  const actionableEntries = fetchResult?.entries.filter(
    (e) => !e.hasExistingEntry && e.matchType !== "INACTIVE_EMPLOYEE",
  ) ?? [];
  const pendingCount = actionableEntries.filter((e) => getDecision(e).decision === "PENDING").length;
  const confirmedCount = actionableEntries.filter((e) => getDecision(e).decision === "CONFIRMED").length + additionalEntries.length;

  // Group entries by date
  const entriesByDate = new Map<string, DigestEntry[]>();
  for (const entry of fetchResult?.entries ?? []) {
    const key = entry.startDate;
    if (!entriesByDate.has(key)) entriesByDate.set(key, []);
    entriesByDate.get(key)!.push(entry);
  }
  const sortedDates = Array.from(entriesByDate.keys()).sort();

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header + date range inputs */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Calendar Digest</h1>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending || !fromDate || !toDate}
            className="rounded-lg bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {fetchMutation.isPending ? "Fetching..." : "Fetch Calendar Events"}
          </button>
        </div>
        {fetchMutation.isError && (
          <p className="mt-2 text-sm text-red-600">{(fetchMutation.error as Error).message}</p>
        )}
      </div>

      {/* Results */}
      {fetchResult && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              {fetchResult.entries.length} event{fetchResult.entries.length === 1 ? "" : "s"} found
            </p>
            <button
              onClick={() => fetchMutation.mutate()}
              disabled={fetchMutation.isPending}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {fetchMutation.isPending ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {fetchResult.entries.length === 0 ? (
            <div className="rounded-lg border bg-white p-8 text-center">
              <p className="text-gray-500">No calendar events found for this period.</p>
            </div>
          ) : (
            <>
              {/* Entries grouped by date */}
              <div className="space-y-6 mb-6">
                {sortedDates.map((date) => (
                  <div key={date}>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 border-b pb-1">
                      {dayjs(date).format("ddd, MMM D, YYYY")}
                    </h3>
                    <div className="space-y-2">
                      {entriesByDate.get(date)!.map((entry) => (
                        <EntryRow
                          key={entry.eventId}
                          entry={entry}
                          employees={fetchResult.employees}
                          decision={getDecision(entry)}
                          onChange={updateDecision}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Additional entries */}
              {additionalEntries.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-sm font-medium text-gray-700">Added entries</p>
                  {additionalEntries.map((extra) => {
                    const emp = fetchResult.employees.find((e) => e.id === extra.employeeId);
                    const label = STATUS_OPTIONS.find((s) => s.value === extra.status)?.label ?? extra.status;
                    const dateRange = extra.startDate === extra.endDate
                      ? extra.startDate
                      : `${extra.startDate} - ${extra.endDate}`;
                    return (
                      <div key={extra._key} className="flex items-center justify-between rounded-lg border bg-white px-4 py-2.5 text-sm">
                        <span>
                          <span className="font-medium">{emp ? `${emp.firstName} ${emp.lastName}` : extra.employeeId}</span>
                          {" -- "}{label}{" "}<span className="text-gray-400">({dateRange})</span>
                        </span>
                        <button
                          onClick={() => setAdditionalEntries((prev) => prev.filter((e) => e._key !== extra._key))}
                          className="text-gray-400 hover:text-red-500 ml-3"
                        >
                          X
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add extra entry */}
              <div className="mb-6">
                <AddEntryForm
                  employees={fetchResult.employees}
                  defaultDate={today}
                  onAdd={(entry) => {
                    setAdditionalEntries((prev) => [...prev, { ...entry, _key: nextKey }]);
                    setNextKey((k) => k + 1);
                  }}
                />
              </div>

              {/* Apply button */}
              <div className="flex items-center justify-between rounded-xl bg-white border p-4 shadow-sm">
                <div>
                  {pendingCount > 0 ? (
                    <p className="text-sm text-amber-700 font-medium">
                      {pendingCount} event{pendingCount === 1 ? "" : "s"} still need a decision
                    </p>
                  ) : confirmedCount > 0 ? (
                    <p className="text-sm text-green-700 font-medium">
                      {confirmedCount} entr{confirmedCount === 1 ? "y" : "ies"} to apply
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">No entries to apply</p>
                  )}
                </div>
                <button
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending || confirmedCount === 0}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applyMutation.isPending ? "Applying..." : "Apply Changes"}
                </button>
              </div>

              {applyMutation.isSuccess && (
                <p className="mt-3 text-sm text-green-600 text-center">
                  Changes applied successfully. Results refreshed.
                </p>
              )}
              {applyMutation.isError && (
                <p className="mt-3 text-sm text-red-600 text-center">
                  {(applyMutation.error as Error).message}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
