import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../../../../api/client";
import { getReportingPeriod } from "@orbs/shared";
import {
  ChevronLeft,
  ChevronRight,
  X,
  CheckSquare,
  Square,
  Send,
  Lock,
  AlertCircle,
  Clock,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import clsx from "clsx";
import dayjs from "dayjs";

// ─── Types & Constants ──────────────────────────────────────────────────────

type DayStatus = "PRESENT" | "SICK" | "CHILD_SICK" | "VACATION" | "RESERVES" | "HALF_DAY" | "WORK_FROM_HOME" | "PUBLIC_HOLIDAY" | "DAY_OFF";
type ReportStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

const STATUS_CONFIG: Record<
  DayStatus,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  PRESENT:        { label: "Present",        bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500",  border: "border-green-300"  },
  SICK:           { label: "Sick",           bg: "bg-amber-100",  text: "text-amber-800",  dot: "bg-amber-500",  border: "border-amber-300"  },
  CHILD_SICK:     { label: "Child Sick",     bg: "bg-rose-100",   text: "text-rose-800",   dot: "bg-rose-500",   border: "border-rose-300"   },
  VACATION:       { label: "Vacation",       bg: "bg-sky-100",    text: "text-sky-800",    dot: "bg-sky-500",    border: "border-sky-300"    },
  RESERVES:       { label: "Reserves",       bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500", border: "border-purple-300" },
  HALF_DAY:       { label: "Half Day Off",   bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500", border: "border-orange-300" },
  WORK_FROM_HOME: { label: "WFH",           bg: "bg-teal-100",   text: "text-teal-800",   dot: "bg-teal-500",   border: "border-teal-300"   },
  PUBLIC_HOLIDAY: { label: "Public Holiday", bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-500", border: "border-indigo-300" },
  DAY_OFF:        { label: "Day Off",        bg: "bg-gray-100",   text: "text-gray-600",   dot: "bg-gray-400",   border: "border-gray-300"   },
};

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000010";

// Statuses the user can manually pick (excludes auto-filled ones)
const PICKABLE_STATUSES: DayStatus[] = ["PRESENT", "SICK", "CHILD_SICK", "VACATION", "RESERVES", "HALF_DAY", "WORK_FROM_HOME"];

// ─── Status Picker Popup ─────────────────────────────────────────────────────

function StatusPicker({
  onSelect,
  onClear,
  onClose,
  current,
}: {
  onSelect: (status: DayStatus) => void;
  onClear: () => void;
  onClose: () => void;
  current?: DayStatus;
}) {
  return (
    <div className="absolute z-50 mt-2 w-44 rounded-xl bg-white shadow-lg ring-1 ring-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Set status</span>
        <button onClick={onClose} className="rounded p-0.5 hover:bg-gray-100">
          <X size={14} className="text-gray-400" />
        </button>
      </div>
      <div className="p-1">
        {PICKABLE_STATUSES.map((key) => {
          const cfg = STATUS_CONFIG[key];
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-gray-50",
                current === key && `${cfg.bg} ${cfg.text} font-medium`
              )}
            >
              <span className={clsx("h-2.5 w-2.5 rounded-full flex-shrink-0", cfg.dot)} />
              {cfg.label}
            </button>
          );
        })}
        {current && (
          <>
            <div className="my-1 border-t border-gray-100" />
            <button
              onClick={onClear}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              <X size={14} />
              Clear status
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Bulk Status Panel ────────────────────────────────────────────────────────

function BulkPanel({
  count,
  onApply,
  onClear,
  onCancel,
  isPending,
}: {
  count: number;
  onApply: (status: DayStatus) => void;
  onClear: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-blue-800">
          {count} day{count !== 1 ? "s" : ""} selected
        </span>
        <div className="flex gap-2">
          <button onClick={onClear} className="text-xs text-blue-600 underline hover:text-blue-800">
            Clear selection
          </button>
          <button onClick={onCancel} className="text-xs text-gray-500 underline hover:text-gray-700">
            Exit multi-select
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-blue-700">Apply status to all selected days:</p>
      <div className="flex flex-wrap gap-2">
        {PICKABLE_STATUSES.map((key) => {
          const cfg = STATUS_CONFIG[key];
          return (
            <button
              key={key}
              disabled={count === 0 || isPending}
              onClick={() => onApply(key)}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                cfg.bg,
                cfg.text,
                `border ${cfg.border}`,
                "hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              <span className={clsx("h-2 w-2 rounded-full", cfg.dot)} />
              {cfg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Report Status Banner ─────────────────────────────────────────────────────

function ReportBanner({
  reportStatus,
  onSubmit,
  isSubmitting,
  employeeName,
}: {
  reportStatus: { status: ReportStatus; reviewerName?: string | null; reviewComment?: string | null };
  onSubmit: () => void;
  isSubmitting: boolean;
  employeeName: string;
}) {
  const st = reportStatus.status;

  if (st === "DRAFT") {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-gray-400" />
          <span className="text-sm text-gray-600">
            Fill in attendance for <strong>{employeeName}</strong> and submit when ready.
          </span>
        </div>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send size={14} />
          {isSubmitting ? "Submitting..." : "Submit for Review"}
        </button>
      </div>
    );
  }

  if (st === "SUBMITTED") {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <Clock size={18} className="flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-sm font-medium text-blue-800">Awaiting manager approval</p>
          <p className="text-xs text-blue-600">Report for {employeeName} has been submitted and is pending review. Calendar is locked.</p>
        </div>
      </div>
    );
  }

  if (st === "APPROVED") {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
        <CheckCircle size={18} className="flex-shrink-0 text-green-500" />
        <div>
          <p className="text-sm font-medium text-green-800">Report approved</p>
          <p className="text-xs text-green-600">
            Approved{reportStatus.reviewerName ? ` by ${reportStatus.reviewerName}` : ""}. This month is now locked.
          </p>
        </div>
        <Lock size={14} className="ml-auto flex-shrink-0 text-green-400" />
      </div>
    );
  }

  if (st === "REJECTED") {
    return (
      <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Corrections needed for {employeeName}</p>
            {reportStatus.reviewComment && (
              <div className="mt-2 rounded-lg border border-red-200 bg-white p-3">
                <p className="text-xs text-gray-500">
                  {reportStatus.reviewerName ? `${reportStatus.reviewerName}: ` : "Manager: "}
                </p>
                <p className="mt-0.5 text-sm text-red-700">"{reportStatus.reviewComment}"</p>
              </div>
            )}
            <p className="mt-2 text-xs text-red-600">Please update the calendar and resubmit.</p>
          </div>
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={14} />
            {isSubmitting ? "Submitting..." : "Resubmit"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-96 rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Create Report Page ────────────────────────────────────────────────

export function CreateReportPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const initialMonth = Number(searchParams.get("month")) || dayjs().month() + 1;
  const initialYear = Number(searchParams.get("year")) || dayjs().year();

  const [monthNum, setMonthNum] = useState(initialMonth);
  const [yearNum, setYearNum] = useState(initialYear);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [openPickerDate, setOpenPickerDate] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch org policies to get monthStartDay
  const { data: orgConfig } = useQuery<{ monthStartDay: number }>({
    queryKey: ["org-config"],
    queryFn: () => api.get("/admin/policies/public"),
  });
  const monthStartDay = orgConfig?.monthStartDay ?? 26;

  // Compute reporting period
  const { from, to } = getReportingPeriod(monthNum, yearNum, monthStartDay);
  const currentMonth = dayjs().year(yearNum).month(monthNum - 1);

  // ── Fetch employee info from team status ──
  const { data: teamStatus } = useQuery({
    queryKey: ["monthly-reports", "team-status", monthNum, yearNum],
    queryFn: () => api.get<any>(`/monthly-reports/team-status?month=${monthNum}&year=${yearNum}`),
  });
  const statusItems: any[] = (teamStatus as any)?.data ?? teamStatus ?? [];
  const employeeInfo = statusItems.find((i: any) => i.employeeId === employeeId);
  const employeeName = employeeInfo?.employeeName ?? "Employee";

  // ── Fetch attendance for this employee ──
  const { data: attendance } = useQuery({
    queryKey: ["attendance", "employee", employeeId, from, to],
    queryFn: () =>
      api.get<{ items: Array<{ serverTimestamp: string; notes: string | null }> }>(
        `/attendance/employee/${employeeId}?from=${from}&to=${to}&limit=100`
      ),
    enabled: !!employeeId,
  });

  // ── Fetch holidays for the period ──
  const { data: holidays } = useQuery<{ date: string; name: string }[]>({
    queryKey: ["holidays-dates", from, to],
    queryFn: () => api.get(`/admin/holidays/dates?from=${from}&to=${to}`),
  });

  // ── Fetch employee details for daysOff ──
  const { data: employeeDetails } = useQuery<{ daysOff?: string[] }>({
    queryKey: ["employee-details", employeeId],
    queryFn: () => api.get(`/employees/${employeeId}`),
    enabled: !!employeeId,
  });

  // ── Fetch report status for this employee ──
  const { data: reportStatus } = useQuery({
    queryKey: ["monthly-reports", "status", employeeId, monthNum, yearNum],
    queryFn: () =>
      api.get<{
        id: string | null;
        status: ReportStatus;
        submittedAt: string | null;
        reviewedAt: string | null;
        reviewerName: string | null;
        reviewComment: string | null;
        lockedAt: string | null;
      }>(`/monthly-reports/status/${employeeId}?month=${monthNum}&year=${yearNum}`),
    enabled: !!employeeId,
    retry: false,
  });

  const effectiveStatus: ReportStatus = reportStatus?.status ?? "DRAFT";
  const isEditable = ["DRAFT", "REJECTED"].includes(effectiveStatus);

  // Build set of holiday dates and employee days off dates
  const holidayDates = useMemo(() => new Set((holidays ?? []).map((h) => h.date)), [holidays]);

  const WEEKDAY_MAP: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4 };
  const daysOffSet = useMemo(() => {
    const empDaysOff = employeeDetails?.daysOff ?? [];
    return new Set(empDaysOff.map((d) => WEEKDAY_MAP[d]).filter((n) => n !== undefined));
  }, [employeeDetails]);

  // Set of auto-filled dates (non-editable)
  const autoFilledDates = useMemo(() => {
    const set = new Set<string>();
    // Add holiday dates
    for (const d of holidayDates) set.add(d);
    // Add employee days off for all workdays in the period
    let cursor = dayjs(from);
    const end = dayjs(to);
    while (!cursor.isAfter(end)) {
      if (daysOffSet.has(cursor.day())) set.add(cursor.format("YYYY-MM-DD"));
      cursor = cursor.add(1, "day");
    }
    return set;
  }, [holidayDates, daysOffSet, from, to]);

  // ── Map date → status ──
  const statusByDate = useMemo(() => {
    const map = new Map<string, DayStatus>();
    // First, auto-fill holidays and days off
    for (const d of holidayDates) map.set(d, "PUBLIC_HOLIDAY");
    let cursor = dayjs(from);
    const end = dayjs(to);
    while (!cursor.isAfter(end)) {
      const dateStr = cursor.format("YYYY-MM-DD");
      if (daysOffSet.has(cursor.day()) && !holidayDates.has(dateStr)) {
        map.set(dateStr, "DAY_OFF");
      }
      cursor = cursor.add(1, "day");
    }
    // Then overlay attendance data (attendance takes precedence for non-auto-filled)
    if (attendance?.items) {
      for (const event of attendance.items) {
        const dateStr = dayjs(event.serverTimestamp).format("YYYY-MM-DD");
        if (!autoFilledDates.has(dateStr) && event.notes && (event.notes as string) in STATUS_CONFIG) {
          map.set(dateStr, event.notes as DayStatus);
        }
      }
    }
    return map;
  }, [attendance, holidayDates, daysOffSet, autoFilledDates, from, to]);

  // ── Single-day mutation (proxy) ──
  const setEntry = useMutation({
    mutationFn: (payload: { date: string; status: DayStatus }) =>
      api.post(`/attendance/employee/${employeeId}/calendar-entry`, {
        date: payload.date,
        status: payload.status,
        siteId: DEFAULT_SITE_ID,
        source: "MANUAL",
        requestId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "employee", employeeId] });
      setOpenPickerDate(null);
    },
  });

  // ── Clear single day (proxy) ──
  const clearEntry = useMutation({
    mutationFn: (date: string) =>
      api.delete(`/attendance/employee/${employeeId}/calendar-entry?date=${date}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "employee", employeeId] });
      setOpenPickerDate(null);
    },
  });

  // ── Bulk mutation (proxy) ──
  const bulkSet = useMutation({
    mutationFn: (payload: { dates: string[]; status: DayStatus }) =>
      api.post(`/attendance/employee/${employeeId}/calendar-bulk`, {
        dates: payload.dates,
        status: payload.status,
        siteId: DEFAULT_SITE_ID,
        source: "MANUAL",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "employee", employeeId] });
      setSelectedDates(new Set());
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Submit report on behalf of employee ──
  const submitReport = useMutation({
    mutationFn: () =>
      api.post("/monthly-reports/submit-for", {
        employeeId,
        month: monthNum,
        year: yearNum,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
      setShowConfirm(false);
      setSubmitError(null);
      exitMultiSelect();
    },
    onError: (err: Error) => {
      setShowConfirm(false);
      setSubmitError(err.message);
    },
  });

  // ── Calendar grid (reporting period days) ──
  const days = useMemo(() => {
    const arr: (dayjs.Dayjs | null)[] = [];
    const start = dayjs(from);
    const end = dayjs(to);
    // Pad start to align with day-of-week column
    for (let i = 0; i < start.day(); i++) arr.push(null);
    let cursor = start;
    while (!cursor.isAfter(end)) {
      arr.push(cursor);
      cursor = cursor.add(1, "day");
    }
    return arr;
  }, [from, to]);

  const isToday = (d: dayjs.Dayjs) => d.isSame(dayjs(), "day");
  const isFuture = (d: dayjs.Dayjs) => d.isAfter(dayjs(), "day");
  const isWeekend = (d: dayjs.Dayjs) => d.day() === 5 || d.day() === 6;

  function handleDayClick(dateStr: string) {
    if (!isEditable || autoFilledDates.has(dateStr)) return;
    if (multiSelectMode) {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        if (next.has(dateStr)) next.delete(dateStr);
        else next.add(dateStr);
        return next;
      });
    } else {
      setOpenPickerDate((prev) => (prev === dateStr ? null : dateStr));
    }
  }

  function handleBulkApply(status: DayStatus) {
    if (selectedDates.size === 0) return;
    bulkSet.mutate({ dates: Array.from(selectedDates), status });
  }

  function exitMultiSelect() {
    setMultiSelectMode(false);
    setSelectedDates(new Set());
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Back button */}
      <button
        onClick={() => navigate("/manager/reports")}
        className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} />
        Back to Reports
      </button>

      {/* Employee name header */}
      <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 p-3">
        <p className="text-sm font-semibold text-primary-900">
          Creating report for: <span className="text-primary-700">{employeeName}</span>
        </p>
        {employeeInfo?.departmentName && (
          <p className="text-xs text-primary-600">{employeeInfo.departmentName}</p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        {/* Report status banner */}
        <ReportBanner
          reportStatus={{ ...(reportStatus ?? {}), status: effectiveStatus }}
          onSubmit={() => { setSubmitError(null); setShowConfirm(true); }}
          isSubmitting={submitReport.isPending}
          employeeName={employeeName}
        />

        {/* Submit error */}
        {submitError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Could not submit report</p>
              <p className="text-xs text-red-600">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (monthNum === 1) { setMonthNum(12); setYearNum(yearNum - 1); }
                else setMonthNum(monthNum - 1);
              }}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="w-48 text-center">
              <h3 className="text-lg font-semibold">{currentMonth.format("MMMM YYYY")}</h3>
              {monthStartDay !== 1 && (
                <p className="text-xs text-gray-400">{from} - {to}</p>
              )}
            </div>
            <button
              onClick={() => {
                if (monthNum === 12) { setMonthNum(1); setYearNum(yearNum + 1); }
                else setMonthNum(monthNum + 1);
              }}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Multi-select toggle */}
          {isEditable && (
            <button
              onClick={() => {
                if (multiSelectMode) {
                  exitMultiSelect();
                } else {
                  setMultiSelectMode(true);
                  setOpenPickerDate(null);
                }
              }}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                multiSelectMode
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              {multiSelectMode ? (
                <>
                  <CheckSquare size={16} /> Multi-select on
                </>
              ) : (
                <>
                  <Square size={16} /> Select multiple
                </>
              )}
            </button>
          )}

          {!isEditable && (
            <span className="flex items-center gap-1.5 text-sm text-gray-400">
              <Lock size={14} /> Read-only
            </span>
          )}
        </div>

        {/* Day headers */}
        <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-gray-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} />;

            const dateStr = day.format("YYYY-MM-DD");
            const status = statusByDate.get(dateStr);
            const cfg = status ? STATUS_CONFIG[status] : null;
            const weekend = isWeekend(day);
            const today = isToday(day);
            const future = isFuture(day);
            const selected = selectedDates.has(dateStr);
            const isPickerOpen = openPickerDate === dateStr;

            const isAutoFilled = autoFilledDates.has(dateStr);
            const clickable = isEditable && !future && !isAutoFilled;

            return (
              <div key={dateStr} className="relative">
                <button
                  onClick={() => clickable && handleDayClick(dateStr)}
                  disabled={!clickable}
                  title={cfg ? cfg.label : undefined}
                  className={clsx(
                    "relative flex h-14 w-full flex-col items-center justify-center rounded-xl text-sm transition-colors",
                    weekend && !cfg && !selected && "bg-gray-50 text-gray-500",
                    future && "text-gray-300",
                    today && "ring-2 ring-blue-400",
                    cfg && !selected && `${cfg.bg} ${cfg.text}`,
                    selected && "bg-blue-600 text-white ring-2 ring-blue-600",
                    clickable && !cfg && !selected && "hover:bg-gray-50",
                    clickable && cfg && !selected && "hover:opacity-80",
                    !isEditable && !weekend && !future && !cfg && "opacity-60",
                    isPickerOpen && "ring-2 ring-blue-400"
                  )}
                >
                  <span className="font-medium leading-none">{day.date()}</span>
                  {cfg && !selected && (
                    <span className={clsx("mt-1 text-[9px] font-semibold uppercase tracking-wide", cfg.text)}>
                      {cfg.label}
                    </span>
                  )}
                  {selected && (
                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-100">
                      ✓
                    </span>
                  )}
                </button>

                {/* Status picker popup */}
                {isPickerOpen && !multiSelectMode && isEditable && (
                  <div className="absolute left-1/2 top-full z-50 -translate-x-1/2">
                    <StatusPicker
                      current={status}
                      onSelect={(s) => setEntry.mutate({ date: dateStr, status: s })}
                      onClear={() => clearEntry.mutate(dateStr)}
                      onClose={() => setOpenPickerDate(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          {(Object.entries(STATUS_CONFIG) as [DayStatus, (typeof STATUS_CONFIG)[DayStatus]][]).map(
            ([key, cfg]) => (
              <span key={key} className="flex items-center gap-1">
                <span className={clsx("inline-block h-3 w-3 rounded-full", cfg.dot)} />
                {cfg.label}
              </span>
            )
          )}
          <span className="ml-auto text-gray-400">
            {!isEditable
              ? "Calendar is locked"
              : multiSelectMode
              ? "Click days to select, then apply status below"
              : "Click a day to set status"}
          </span>
        </div>

        {/* Bulk apply panel */}
        {multiSelectMode && isEditable && (
          <BulkPanel
            count={selectedDates.size}
            onApply={handleBulkApply}
            onClear={() => setSelectedDates(new Set())}
            onCancel={exitMultiSelect}
            isPending={bulkSet.isPending}
          />
        )}
      </div>

      {/* Click outside to close picker */}
      {openPickerDate && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenPickerDate(null)}
        />
      )}

      {/* Submit confirmation dialog */}
      <ConfirmDialog
        open={showConfirm}
        title="Submit Monthly Report"
        message={`Submit the attendance report for ${employeeName} for ${currentMonth.format("MMMM YYYY")}? This report will be sent to their assigned manager for approval.`}
        onConfirm={() => submitReport.mutate()}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
