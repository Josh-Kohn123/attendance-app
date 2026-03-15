/**
 * Calendar Digest Review Page
 *
 * Accessible via /digest/:token — no login required (the token is authentication).
 * The admin reviews each calendar event, confirms or declines the proposed
 * attendance change, resolves ambiguous cases, and can add extra entries
 * before submitting.
 */

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import type {
  CalendarDigestData,
  DigestEntry,
  DigestConfirmDecision,
  DigestAdditionalEntry,
} from "@orbs/shared";

// Local UI state — includes "PENDING" for unreviewed entries (not sent to API)
interface LocalDecision {
  entryId: string;
  decision: "CONFIRMED" | "DECLINED" | "PENDING";
  resolvedEmployeeId?: string;
  resolvedStatus?: string;
  startDate?: string;
  endDate?: string;
}

const API_BASE = "/api";

async function fetchDigest(token: string): Promise<CalendarDigestData> {
  const res = await fetch(`${API_BASE}/calendar-digest/${token}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Failed to load digest");
  return json.data;
}

async function submitDigest(
  token: string,
  decisions: DigestConfirmDecision[],
  additionalEntries: DigestAdditionalEntry[],
): Promise<{ applied: number; declined: number }> {
  const res = await fetch(`${API_BASE}/calendar-digest/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions, additionalEntries }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Submission failed");
  return json.data;
}

// ─── Status options ───────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "SICK", label: "Sick" },
  { value: "CHILD_SICK", label: "Child Sick" },
  { value: "VACATION", label: "Vacation" },
  { value: "RESERVES", label: "Reserves (Miluim)" },
  { value: "HALF_DAY", label: "Half Day" },
  { value: "PRESENT", label: "Present" },
  { value: "WORK_FROM_HOME", label: "Work From Home" },
];

// ─── Match type badge ─────────────────────────────────────────────────

function MatchBadge({ type }: { type: DigestEntry["matchType"] }) {
  const styles: Record<string, string> = {
    MATCHED: "bg-green-100 text-green-800",
    AMBIGUOUS_NAME: "bg-amber-100 text-amber-800",
    UNMATCHED: "bg-gray-100 text-gray-700",
    INACTIVE_EMPLOYEE: "bg-red-100 text-red-700",
    UNCLEAR_STATUS: "bg-blue-100 text-blue-800",
    MANUAL: "bg-purple-100 text-purple-800",
  };
  const labels: Record<string, string> = {
    MATCHED: "Matched",
    AMBIGUOUS_NAME: "Ambiguous name",
    UNMATCHED: "Not found",
    INACTIVE_EMPLOYEE: "Inactive employee",
    UNCLEAR_STATUS: "Status unclear",
    MANUAL: "Manual",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[type] ?? "bg-gray-100 text-gray-700"}`}>
      {labels[type] ?? type}
    </span>
  );
}

// ─── Individual entry row ─────────────────────────────────────────────

interface EntryRowProps {
  entry: DigestEntry;
  digestDate: string;
  employees: CalendarDigestData["employees"];
  decision: LocalDecision;
  onChange: (updated: LocalDecision) => void;
}

function EntryRow({ entry, digestDate, employees, decision, onChange }: EntryRowProps) {
  const isLocked = entry.hasExistingEntry || entry.matchType === "INACTIVE_EMPLOYEE";
  const dateRange = entry.startDate === entry.endDate
    ? entry.startDate
    : `${entry.startDate} → ${entry.endDate}`;

  const activeEmployees = employees.filter((e) => e.isActive);
  const isCreating = decision.decision === "CONFIRMED";
  const isIgnored = decision.decision === "DECLINED";

  // When "Create Entry" is clicked, pre-populate fields from matched data
  const handleCreateEntry = () => {
    onChange({
      ...decision,
      decision: "CONFIRMED",
      resolvedEmployeeId: decision.resolvedEmployeeId ?? entry.proposedEmployeeId ?? undefined,
      resolvedStatus: decision.resolvedStatus ?? entry.proposedStatus ?? undefined,
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

          {/* Already entered */}
          {entry.hasExistingEntry && (
            <p className="text-xs text-gray-500 mt-1">Attendance already recorded — no changes needed.</p>
          )}

          {/* Inactive employee warning */}
          {entry.matchType === "INACTIVE_EMPLOYEE" && !entry.hasExistingEntry && (
            <p className="text-xs text-red-600 mt-1">
              This employee is inactive. Ignore or reassign to another employee.
            </p>
          )}

          {/* Create Entry fields — shown when "Create Entry" is clicked */}
          {!isLocked && isCreating && (
            <div className="mt-3 flex flex-wrap gap-3 items-end">
              {/* Employee selector — always shown */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <select
                  value={decision.resolvedEmployeeId ?? ""}
                  onChange={(e) => onChange({ ...decision, resolvedEmployeeId: e.target.value || undefined })}
                  className="rounded-lg border px-2 py-1.5 text-sm min-w-[200px]"
                >
                  <option value="">— Select employee —</option>
                  {(entry.matchType === "AMBIGUOUS_NAME" && entry.candidateEmployees.length > 0
                    ? entry.candidateEmployees
                    : activeEmployees
                  ).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status selector — always shown */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Status</label>
                <select
                  value={decision.resolvedStatus ?? ""}
                  onChange={(e) => onChange({ ...decision, resolvedStatus: e.target.value || undefined })}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                >
                  <option value="">— Select —</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Date range — always shown */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={decision.startDate ?? entry.startDate}
                  onChange={(e) => onChange({ ...decision, startDate: e.target.value })}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={decision.endDate ?? entry.endDate}
                  onChange={(e) => onChange({ ...decision, endDate: e.target.value })}
                  min={decision.startDate ?? entry.startDate}
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Create Entry / Ignore buttons */}
        {!isLocked && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleCreateEntry}
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

// ─── Add Extra Entry form ─────────────────────────────────────────────

interface AddEntryFormProps {
  employees: CalendarDigestData["employees"];
  digestDate: string;
  onAdd: (entry: DigestAdditionalEntry) => void;
}

function AddEntryForm({ employees, digestDate, onAdd }: AddEntryFormProps) {
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("VACATION");
  const [startDate, setStartDate] = useState(digestDate);
  const [endDate, setEndDate] = useState(digestDate);
  const [error, setError] = useState("");

  const activeEmployees = employees.filter((e) => e.isActive);

  function handleAdd() {
    if (!employeeId) { setError("Select an employee"); return; }
    if (!status) { setError("Select a status"); return; }
    setError("");
    onAdd({ employeeId, status, startDate, endDate });
    setEmployeeId("");
    setStatus("VACATION");
    setStartDate(digestDate);
    setEndDate(digestDate);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-4 bg-gray-50">
      <p className="text-sm font-medium text-gray-700 mb-3">Add entry not on calendar</p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm min-w-[200px]"
          >
            <option value="">— Select —</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={handleAdd}
          className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Staged additional entries list ──────────────────────────────────

interface StagedEntry extends DigestAdditionalEntry {
  _key: number;
}

// ─── Main page ───────────────────────────────────────────────────────

export function CalendarDigestPage() {
  const { token } = useParams<{ token: string }>();

  const { data: digest, isLoading, error } = useQuery<CalendarDigestData>({
    queryKey: ["digest", token],
    queryFn: () => fetchDigest(token!),
    enabled: !!token,
  });

  // Track each entry's decision state keyed by entryId
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});
  const [stagedExtras, setStagedExtras] = useState<StagedEntry[]>([]);
  const [nextKey, setNextKey] = useState(0);

  // Initialise decisions when digest loads
  const getDecision = (entry: DigestEntry): LocalDecision => {
    if (decisions[entry.id]) return decisions[entry.id];
    return {
      entryId: entry.id,
      decision: "PENDING",
      resolvedEmployeeId: entry.resolvedEmployeeId ?? entry.proposedEmployeeId ?? undefined,
      resolvedStatus: entry.resolvedStatus ?? entry.proposedStatus ?? undefined,
      startDate: entry.startDate,
      endDate: entry.endDate,
    };
  };

  const updateDecision = (updated: LocalDecision) => {
    setDecisions((prev) => ({ ...prev, [updated.entryId]: updated }));
  };

  const submitMutation = useMutation({
    mutationFn: () => {
      const allDecisions: DigestConfirmDecision[] = (digest?.entries ?? [])
        .filter((e) => !e.hasExistingEntry && e.matchType !== "INACTIVE_EMPLOYEE")
        .map(getDecision)
        .filter((d) => d.decision === "CONFIRMED" || d.decision === "DECLINED")
        .map((d) => ({
          entryId: d.entryId,
          decision: d.decision as "CONFIRMED" | "DECLINED",
          resolvedEmployeeId: d.resolvedEmployeeId,
          resolvedStatus: d.resolvedStatus,
          startDate: d.startDate,
          endDate: d.endDate,
        }));

      return submitDigest(token!, allDecisions, stagedExtras);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !digest) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-gray-900 font-medium text-lg">Digest not found</p>
          <p className="text-gray-500 text-sm mt-1">This link may be invalid or the digest was already processed.</p>
        </div>
      </div>
    );
  }

  if (submitMutation.isSuccess) {
    const { applied, declined } = submitMutation.data;
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl bg-white shadow-sm p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Changes applied</h2>
          <p className="text-gray-500 text-sm">
            {applied} entr{applied === 1 ? "y" : "ies"} created
            {declined > 0 ? `, ${declined} ignored` : ""}.
          </p>
        </div>
      </div>
    );
  }

  if (digest.status === "SUBMITTED") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl bg-white shadow-sm p-8 max-w-md text-center">
          <p className="text-gray-900 font-medium">This digest has already been submitted.</p>
        </div>
      </div>
    );
  }

  const actionableEntries = digest.entries.filter(
    (e) => !e.hasExistingEntry && e.matchType !== "INACTIVE_EMPLOYEE",
  );
  const pendingCount = actionableEntries.filter(
    (e) => getDecision(e).decision === "PENDING",
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{digest.orgName} — Attendance</h1>
          <p className="text-gray-500 text-sm mt-1">
            Calendar digest for <span className="font-medium text-gray-700">{digest.date}</span>
            {" · "}{digest.entries.length} event{digest.entries.length === 1 ? "" : "s"}
          </p>
        </div>

        {/* Event entries */}
        <div className="space-y-3 mb-6">
          {digest.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              digestDate={digest.date}
              employees={digest.employees}
              decision={getDecision(entry)}
              onChange={updateDecision}
            />
          ))}
        </div>

        {/* Staged extra entries */}
        {stagedExtras.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Added entries</p>
            {stagedExtras.map((extra) => {
              const emp = digest.employees.find((e) => e.id === extra.employeeId);
              const label = STATUS_OPTIONS.find((s) => s.value === extra.status)?.label ?? extra.status;
              const dateRange = extra.startDate === extra.endDate
                ? extra.startDate
                : `${extra.startDate} → ${extra.endDate}`;
              return (
                <div key={extra._key} className="flex items-center justify-between rounded-lg border bg-white px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{emp ? `${emp.firstName} ${emp.lastName}` : extra.employeeId}</span>
                    {" — "}{label}{" "}<span className="text-gray-400">({dateRange})</span>
                  </span>
                  <button
                    onClick={() => setStagedExtras((prev) => prev.filter((e) => e._key !== extra._key))}
                    className="text-gray-400 hover:text-red-500 ml-3"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add extra entry */}
        <div className="mb-6">
          <AddEntryForm
            employees={digest.employees}
            digestDate={digest.date}
            onAdd={(entry) => {
              setStagedExtras((prev) => [...prev, { ...entry, _key: nextKey }]);
              setNextKey((k) => k + 1);
            }}
          />
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between rounded-xl bg-white border p-4 shadow-sm">
          <div>
            {pendingCount > 0 ? (
              <p className="text-sm text-amber-700 font-medium">
                {pendingCount} event{pendingCount === 1 ? "" : "s"} still need a decision
              </p>
            ) : (
              <p className="text-sm text-gray-500">All events reviewed</p>
            )}
          </div>
          <button
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || pendingCount > 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitMutation.isPending ? "Applying..." : "Apply Changes"}
          </button>
        </div>

        {submitMutation.isError && (
          <p className="mt-3 text-sm text-red-600 text-center">
            {(submitMutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
