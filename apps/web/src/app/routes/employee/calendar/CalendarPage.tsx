import { useState, useMemo } from "react";
import { useAuth } from "../../../../auth/AuthProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
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
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import dayjs from "dayjs";
import { getReportingPeriod } from "@orbs/shared";

// ─── Types & Constants ──────────────────────────────────────────────────────

type DayStatus = "PRESENT" | "SICK" | "CHILD_SICK" | "VACATION" | "RESERVES" | "HALF_DAY" | "WORK_FROM_HOME" | "PUBLIC_HOLIDAY" | "PUBLIC_HOLIDAY_HALF" | "HOLIDAY_EVE" | "HOLIDAY_EVE_VACATION" | "HOLIDAY_EVE_SICK" | "CHOICE_DAY" | "ADVANCED_STUDY" | "DAY_OFF";
type ReportStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

// Statuses that the employee can manually pick
const PICKABLE_STATUSES: DayStatus[] = ["PRESENT", "SICK", "CHILD_SICK", "VACATION", "RESERVES", "HALF_DAY", "WORK_FROM_HOME", "CHOICE_DAY", "ADVANCED_STUDY"];

// Statuses shown only on Holiday Eve days (employee takes remaining half off)
const HOLIDAY_EVE_STATUSES: DayStatus[] = ["HOLIDAY_EVE_VACATION", "HOLIDAY_EVE_SICK"];

// Auto-filled statuses that cannot be changed by employees
const AUTO_STATUSES: DayStatus[] = ["PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY_HALF", "DAY_OFF"];

// Statuses that are auto-filled but allow override (holiday eve → employee can take half day off)
const OVERRIDABLE_AUTO_STATUSES: DayStatus[] = ["HOLIDAY_EVE", "HOLIDAY_EVE_VACATION", "HOLIDAY_EVE_SICK"];

const STATUS_CONFIG: Record<
  DayStatus,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  PRESENT:        { label: "In Office",              bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500",  border: "border-green-300"  },
  SICK:           { label: "Sick",                 bg: "bg-amber-100",  text: "text-amber-800",  dot: "bg-amber-500",  border: "border-amber-300"  },
  CHILD_SICK:     { label: "Child Sick",           bg: "bg-rose-100",   text: "text-rose-800",   dot: "bg-rose-500",   border: "border-rose-300"   },
  VACATION:       { label: "Vacation",             bg: "bg-sky-100",    text: "text-sky-800",    dot: "bg-sky-500",    border: "border-sky-300"    },
  RESERVES:       { label: "Reserves",             bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500", border: "border-purple-300" },
  HALF_DAY:       { label: "Half Day Off",         bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500", border: "border-orange-300" },
  WORK_FROM_HOME: { label: "Work From Home",       bg: "bg-teal-100",   text: "text-teal-800",   dot: "bg-teal-500",   border: "border-teal-300"   },
  PUBLIC_HOLIDAY: { label: "Holiday - Paid",       bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-500", border: "border-indigo-300" },
  PUBLIC_HOLIDAY_HALF: { label: "Holiday (Half)",   bg: "bg-indigo-50",  text: "text-indigo-700", dot: "bg-indigo-400", border: "border-indigo-200" },
  HOLIDAY_EVE:    { label: "Holiday Eve",          bg: "bg-indigo-50",  text: "text-indigo-700", dot: "bg-indigo-400", border: "border-indigo-200" },
  HOLIDAY_EVE_VACATION: { label: "Holiday Eve + Vacation", bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-sky-500",    border: "border-indigo-300" },
  HOLIDAY_EVE_SICK:     { label: "Holiday Eve + Sick",     bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-amber-500",  border: "border-indigo-300" },
  CHOICE_DAY:     { label: "Choice Day",           bg: "bg-cyan-100",   text: "text-cyan-800",   dot: "bg-cyan-500",   border: "border-cyan-300"   },
  ADVANCED_STUDY: { label: "Study",                bg: "bg-lime-100",   text: "text-lime-800",   dot: "bg-lime-500",   border: "border-lime-300"   },
  DAY_OFF:        { label: "Day Off",              bg: "bg-gray-100",   text: "text-gray-600",   dot: "bg-gray-400",   border: "border-gray-300"   },
};

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000010";

// Map day-of-week number (0=Sun) to weekday name used in employee.daysOff
const DOW_TO_WEEKDAY: Record<number, string> = {
  0: "SUNDAY", 1: "MONDAY", 2: "TUESDAY", 3: "WEDNESDAY", 4: "THURSDAY",
};

// ─── Status Picker Popup ─────────────────────────────────────────────────────

function StatusPicker({
  onSelect,
  onClear,
  onClose,
  current,
  isHolidayEve,
}: {
  onSelect: (status: DayStatus) => void;
  onClear: () => void;
  onClose: () => void;
  current?: DayStatus;
  isHolidayEve?: boolean;
}) {
  const statuses = isHolidayEve ? HOLIDAY_EVE_STATUSES : PICKABLE_STATUSES;
  return (
    <div className="absolute z-50 mt-2 w-44 rounded-xl bg-white shadow-lg ring-1 ring-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {isHolidayEve ? "Holiday Eve — take half day?" : "Set status"}
        </span>
        <button onClick={onClose} className="rounded p-0.5 hover:bg-gray-100">
          <X size={14} className="text-gray-400" />
        </button>
      </div>
      <div className="p-1">
        {statuses.map((key) => {
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
        {current && !AUTO_STATUSES.includes(current) && !OVERRIDABLE_AUTO_STATUSES.includes(current) && (
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
        {isHolidayEve && current && OVERRIDABLE_AUTO_STATUSES.includes(current) && current !== "HOLIDAY_EVE" && (
          <>
            <div className="my-1 border-t border-gray-100" />
            <button
              onClick={onClear}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              <X size={14} />
              Revert to Holiday Eve
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
                cfg.bg, cfg.text, `border ${cfg.border}`,
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

function SummaryLine({ counts }: { counts: { worked: number; vacation: number; sick: number } }) {
  return (
    <p className="mt-1 text-xs text-gray-500">
      Worked: <span className="font-medium text-gray-700">{counts.worked}</span>
      {" · "}Vacation: <span className="font-medium text-gray-700">{counts.vacation}</span>
      {" · "}Sick: <span className="font-medium text-gray-700">{counts.sick}</span>
    </p>
  );
}

function ReportBanner({
  reportStatus,
  onSubmit,
  isSubmitting,
  periodLabel,
  isPeriodEnded,
  periodEndDate,
  summaryCounts,
}: {
  reportStatus: { status: ReportStatus; reviewerName?: string | null; reviewComment?: string | null };
  onSubmit: () => void;
  isSubmitting: boolean;
  periodLabel: string;
  isPeriodEnded: boolean;
  periodEndDate: string;
  summaryCounts: { worked: number; vacation: number; sick: number };
}) {
  const st = reportStatus.status;

  if (st === "DRAFT") {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start gap-2">
          <Send size={16} className="mt-0.5 text-gray-400" />
          <div>
            <span className="text-sm text-gray-600">
              {isPeriodEnded
                ? "Report not yet submitted. Fill in your attendance and submit when ready."
                : `Submission opens after the reporting period ends (${dayjs(periodEndDate).format("MMM D, YYYY")}).`}
            </span>
            <SummaryLine counts={summaryCounts} />
          </div>
        </div>
        <button
          onClick={onSubmit}
          disabled={isSubmitting || !isPeriodEnded}
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
          <p className="text-xs text-blue-600">Your report has been submitted and is pending review. Calendar is locked until reviewed.</p>
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
            Approved{reportStatus.reviewerName ? ` by ${reportStatus.reviewerName}` : ""}. This period is now locked.
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
            <p className="text-sm font-medium text-red-800">Corrections needed</p>
            {reportStatus.reviewComment && (
              <div className="mt-2 rounded-lg border border-red-200 bg-white p-3">
                <p className="text-xs text-gray-500">
                  {reportStatus.reviewerName ? `${reportStatus.reviewerName}: ` : "Manager: "}
                </p>
                <p className="mt-0.5 text-sm text-red-700">"{reportStatus.reviewComment}"</p>
              </div>
            )}
            <p className="mt-2 text-xs text-red-600">Please update your calendar and resubmit.</p>
            <SummaryLine counts={summaryCounts} />
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
  open, title, message, onConfirm, onCancel,
}: { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-96 rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Submit</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

export function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf("month"));
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [openPickerDate, setOpenPickerDate] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const monthNum = currentMonth.month() + 1;
  const yearNum = currentMonth.year();

  // ── Fetch org config to get monthStartDay (public endpoint, all roles) ──
  const { data: orgConfig } = useQuery({
    queryKey: ["org-config"],
    queryFn: () => api.get<{ monthStartDay: number }>("/admin/policies/public"),
  });
  const monthStartDay: number = (orgConfig as any)?.monthStartDay ?? 26;

  // ── Compute reporting period ──
  const { from, to } = useMemo(
    () => getReportingPeriod(monthNum, yearNum, monthStartDay),
    [monthNum, yearNum, monthStartDay]
  );

  const periodLabel = `${dayjs(from).format("MMM D")} - ${dayjs(to).format("MMM D, YYYY")}`;

  // ── Current user's days off (from auth context) ──
  const { user } = useAuth();
  const employeeDaysOff: string[] = user?.employee?.daysOff ?? [];

  // ── Fetch holidays for this period ──
  const { data: holidays, isPending: holidaysPending } = useQuery({
    queryKey: ["holidays", "dates", from, to],
    queryFn: () => api.get<any>(`/admin/holidays/dates?from=${from}&to=${to}`),
    enabled: !!from && !!to,
  });
  const holidayDates = useMemo(() => {
    const set = new Map<string, { name: string; halfDay: boolean }>();
    const items = (holidays as any)?.data ?? holidays ?? [];
    for (const h of items) {
      set.set(h.date, { name: h.name, halfDay: !!h.halfDay });
    }
    return set;
  }, [holidays]);

  // ── Fetch attendance ──
  const { data: attendance, isPending: attendancePending } = useQuery({
    queryKey: ["attendance", "self", from, to],
    queryFn: () =>
      api.get<{ items: Array<{ serverTimestamp: string; notes: string | null }> }>(
        `/attendance/self?from=${from}&to=${to}&limit=100`
      ),
    enabled: !!from && !!to,
  });

  // ── Initial load gate — prevents the "all-red unfilled" flash before data arrives ──
  const isCalendarLoading = !!from && !!to && (holidaysPending || attendancePending);

  // ── Fetch report status ──
  const { data: reportStatus } = useQuery({
    queryKey: ["monthly-reports", "status", monthNum, yearNum],
    queryFn: () =>
      api.get<{
        id: string | null;
        status: ReportStatus;
        submittedAt: string | null;
        reviewedAt: string | null;
        reviewerName: string | null;
        reviewComment: string | null;
        lockedAt: string | null;
        noEmployeeRecord?: boolean;
      }>(`/monthly-reports/status?month=${monthNum}&year=${yearNum}`),
    retry: false,
  });

  const effectiveStatus: ReportStatus = reportStatus?.status ?? "DRAFT";
  const isEditable = ["DRAFT", "REJECTED"].includes(effectiveStatus);

  // Submission is only allowed after the reporting period has ended
  const isPeriodEnded = useMemo(() => {
    if (!to) return false;
    return dayjs().isAfter(dayjs(to), "day");
  }, [to]);

  // ── Map date → status (merge attendance + auto-filled holidays/daysOff) ──
  const statusByDate = useMemo(() => {
    const map = new Map<string, DayStatus>();

    // First, fill in holidays (full-day or holiday eve)
    for (const [dateStr, info] of holidayDates) {
      map.set(dateStr, info.halfDay ? "HOLIDAY_EVE" : "PUBLIC_HOLIDAY");
    }

    // Then, fill in employee days off
    if (employeeDaysOff.length > 0) {
      let cursor = dayjs(from);
      const end = dayjs(to);
      while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
        const dow = cursor.day();
        const weekday = DOW_TO_WEEKDAY[dow];
        if (weekday && employeeDaysOff.includes(weekday) && !map.has(cursor.format("YYYY-MM-DD"))) {
          map.set(cursor.format("YYYY-MM-DD"), "DAY_OFF");
        }
        cursor = cursor.add(1, "day");
      }
    }

    // Then, overlay actual attendance (but don't override auto-filled)
    if (attendance?.items) {
      for (const event of attendance.items) {
        const dateStr = dayjs(event.serverTimestamp).format("YYYY-MM-DD");
        if (event.notes && (event.notes as string) in STATUS_CONFIG) {
          // Don't override auto-filled holidays or days off
          const existing = map.get(dateStr);
          if (!existing || !AUTO_STATUSES.includes(existing)) {
            map.set(dateStr, event.notes as DayStatus);
          }
        }
      }
    }
    return map;
  }, [attendance, holidayDates, employeeDaysOff, from, to]);

  // ── Auto-filled dates (non-editable) — holiday eves are excluded so employees can override ──
  const autoFilledDates = useMemo(() => {
    const set = new Set<string>();
    for (const [dateStr, status] of statusByDate) {
      if (AUTO_STATUSES.includes(status) && !OVERRIDABLE_AUTO_STATUSES.includes(status)) {
        set.add(dateStr);
      }
    }
    return set;
  }, [statusByDate]);

  // ── Single-day mutation ──
  const setEntry = useMutation({
    mutationFn: (payload: { date: string; status: DayStatus }) =>
      api.post("/attendance/calendar-entry", {
        date: payload.date,
        status: payload.status,
        siteId: DEFAULT_SITE_ID,
        source: "MANUAL",
        requestId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setOpenPickerDate(null);
    },
  });

  const clearEntry = useMutation({
    mutationFn: (date: string) => api.delete(`/attendance/calendar-entry?date=${date}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setOpenPickerDate(null);
    },
  });

  const bulkSet = useMutation({
    mutationFn: (payload: { dates: string[]; status: DayStatus }) =>
      api.post("/attendance/calendar-bulk", {
        dates: payload.dates,
        status: payload.status,
        siteId: DEFAULT_SITE_ID,
        source: "MANUAL",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setSelectedDates(new Set());
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Counts for the pre-submission summary (Worked / Vacation / Sick) ──
  const summaryCounts = useMemo(() => {
    let worked = 0, vacation = 0, sick = 0;
    for (const status of statusByDate.values()) {
      if (status === "PRESENT" || status === "WORK_FROM_HOME") worked++;
      else if (status === "VACATION") vacation++;
      else if (status === "SICK") sick++;
    }
    return { worked, vacation, sick };
  }, [statusByDate]);

  // ── Compute unfilled workdays for validation ──
  // Returns empty while data is still loading so the grid doesn't flash red on first paint.
  const unfilledWorkdays = useMemo(() => {
    if (isCalendarLoading) return new Set<string>();
    const missing: string[] = [];
    const today = dayjs();
    let cursor = dayjs(from);
    const end = dayjs(to);

    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      // Skip future dates
      if (cursor.isAfter(today, "day")) break;
      const dateStr = cursor.format("YYYY-MM-DD");
      const dow = cursor.day();
      // Skip weekends (Fri=5, Sat=6)
      if (dow !== 5 && dow !== 6) {
        const status = statusByDate.get(dateStr);
        if (!status) {
          missing.push(dateStr);
        }
      }
      cursor = cursor.add(1, "day");
    }
    return new Set(missing);
  }, [statusByDate, from, to, isCalendarLoading]);

  // ── Submit with validation ──
  const handleSubmitClick = () => {
    if (!isPeriodEnded) {
      setValidationError(`Submission is not available until the reporting period ends (after ${dayjs(to).format("MMM D, YYYY")}).`);
      return;
    }
    if (unfilledWorkdays.size > 0) {
      setValidationError(`Please fill in all workdays in the reporting period before submitting. ${unfilledWorkdays.size} day(s) still need a status.`);
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    setShowConfirm(true);
  };

  const submitReport = useMutation({
    mutationFn: () =>
      api.post("/monthly-reports/submit", { month: monthNum, year: yearNum }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
      setShowConfirm(false);
      setSubmitError(null);
      setValidationError(null);
      exitMultiSelect();
    },
    onError: (err: Error) => {
      setShowConfirm(false);
      setSubmitError(err.message);
    },
  });

  // ── Calendar grid — build days for the reporting period ──
  const days = useMemo(() => {
    const arr: (dayjs.Dayjs | null)[] = [];
    const start = dayjs(from);
    const end = dayjs(to);

    // Pad the beginning so the first day falls on the correct weekday column
    const startDow = start.day(); // 0=Sun
    for (let i = 0; i < startDow; i++) arr.push(null);

    let cursor = start;
    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      arr.push(cursor);
      cursor = cursor.add(1, "day");
    }
    return arr;
  }, [from, to]);

  const isToday = (d: dayjs.Dayjs) => d.isSame(dayjs(), "day");
  const isFuture = (d: dayjs.Dayjs) => d.isAfter(dayjs(), "day");
  const isWeekend = (d: dayjs.Dayjs) => d.day() === 5 || d.day() === 6;

  function handleDayClick(dateStr: string) {
    if (!isEditable) return;
    if (autoFilledDates.has(dateStr)) return; // Can't change auto-filled days
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

  // Pre-compute which dates in the period belong to each weekday and are
  // candidates for selection (editable, not in the future, not auto-filled).
  // Used by the clickable column headers for "select all Mondays" behavior.
  const selectableDatesByWeekday = useMemo(() => {
    const map: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    if (!isEditable) return map;
    const today = dayjs();
    for (const day of days) {
      if (!day) continue;
      if (day.isAfter(today, "day")) continue;
      const dateStr = day.format("YYYY-MM-DD");
      if (autoFilledDates.has(dateStr)) continue;
      map[day.day()].push(dateStr);
    }
    return map;
  }, [days, isEditable, autoFilledDates]);

  // Click on a weekday column header → toggle all selectable dates of that weekday.
  // Auto-enables multi-select mode so the bulk-apply bar appears immediately.
  function handleWeekdayHeaderClick(dow: number) {
    if (!isEditable) return;
    const candidates = selectableDatesByWeekday[dow];
    if (candidates.length === 0) return;
    if (!multiSelectMode) {
      setMultiSelectMode(true);
      setOpenPickerDate(null);
    }
    setSelectedDates((prev) => {
      const next = new Set(prev);
      const allSelected = candidates.every((d) => next.has(d));
      if (allSelected) {
        for (const d of candidates) next.delete(d);
      } else {
        for (const d of candidates) next.add(d);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        {/* Report status banner */}
        <ReportBanner
          reportStatus={{ ...(reportStatus ?? {}), status: effectiveStatus }}
          onSubmit={handleSubmitClick}
          isSubmitting={submitReport.isPending}
          periodLabel={periodLabel}
          isPeriodEnded={isPeriodEnded}
          periodEndDate={to}
          summaryCounts={summaryCounts}
        />

        {/* Validation error */}
        {validationError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Cannot submit report</p>
              <p className="text-xs text-red-600">{validationError}</p>
            </div>
            <button onClick={() => setValidationError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

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
              onClick={() => setCurrentMonth((m) => m.subtract(1, "month"))}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-center">
              <h3 className="text-lg font-semibold">
                {currentMonth.format("MMMM YYYY")}
              </h3>
              <p className="text-xs text-gray-500">{periodLabel}</p>
            </div>
            <button
              onClick={() => setCurrentMonth((m) => m.add(1, "month"))}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {isEditable && (
            <button
              onClick={() => {
                if (multiSelectMode) exitMultiSelect();
                else { setMultiSelectMode(true); setOpenPickerDate(null); }
              }}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                multiSelectMode ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              {multiSelectMode ? (<><CheckSquare size={16} /> Multi-select on</>) : (<><Square size={16} /> Select multiple</>)}
            </button>
          )}

          {!isEditable && (
            <span className="flex items-center gap-1.5 text-sm text-gray-400">
              <Lock size={14} /> Read-only
            </span>
          )}
        </div>

        {/* Day headers + grid (relative wrapper so the loading curtain can overlay both) */}
        <div className="relative">
          {/* Day headers — clickable to toggle all of that weekday into multi-select */}
          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-gray-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, dow) => {
              const candidates = selectableDatesByWeekday[dow];
              const interactive = isEditable && candidates.length > 0;
              const allSelected = interactive && candidates.every((dt) => selectedDates.has(dt));
              const someSelected = interactive && !allSelected && candidates.some((dt) => selectedDates.has(dt));
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleWeekdayHeaderClick(dow)}
                  disabled={!interactive}
                  title={interactive ? `Select all ${d}s in this period` : undefined}
                  className={clsx(
                    "rounded py-1 transition-colors",
                    interactive ? "cursor-pointer hover:bg-blue-50 hover:text-blue-700" : "cursor-default",
                    allSelected && "bg-blue-600 text-white hover:bg-blue-600 hover:text-white",
                    someSelected && "bg-blue-100 text-blue-700",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Loading curtain — shown until holidays + attendance arrive */}
          {isCalendarLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-gray-500">
                <Loader2 size={28} className="animate-spin" />
                <span className="text-xs">Loading calendar…</span>
              </div>
            </div>
          )}

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
            const isUnfilled = unfilledWorkdays.has(dateStr);

            return (
              <div key={dateStr} className="relative">
                <button
                  onClick={() => clickable && handleDayClick(dateStr)}
                  disabled={!clickable}
                  title={cfg ? cfg.label : isUnfilled ? "Unfilled — needs status" : isAutoFilled ? "Auto-filled" : undefined}
                  className={clsx(
                    "relative flex h-14 w-full flex-col items-center justify-center rounded-xl text-sm transition-colors",
                    weekend && !cfg && !selected && "bg-gray-50 text-gray-500",
                    future && "text-gray-300",
                    today && "ring-2 ring-blue-400",
                    isUnfilled && !selected && "bg-red-50 text-red-700 ring-1 ring-red-300",
                    cfg && !selected && !isUnfilled && `${cfg.bg} ${cfg.text}`,
                    selected && "bg-blue-600 text-white ring-2 ring-blue-600",
                    clickable && !cfg && !selected && !isUnfilled && "hover:bg-gray-50",
                    clickable && cfg && !selected && "hover:opacity-80",
                    clickable && isUnfilled && !selected && "hover:bg-red-100",
                    !isEditable && !weekend && !future && !cfg && "opacity-60",
                    isPickerOpen && "ring-2 ring-blue-400",
                  )}
                >
                  <span className="font-medium leading-none">{day.date()}</span>
                  {cfg && !selected && (
                    <span className={clsx("mt-1 text-[9px] font-semibold uppercase tracking-wide", cfg.text)}>
                      {cfg.label}
                    </span>
                  )}
                  {isUnfilled && !selected && (
                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-500">
                      unfilled
                    </span>
                  )}
                  {selected && (
                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-100">
                      ✓
                    </span>
                  )}
                </button>

                {isPickerOpen && !multiSelectMode && isEditable && (!isAutoFilled || (status && OVERRIDABLE_AUTO_STATUSES.includes(status))) && (
                  <div className="absolute left-1/2 top-full z-50 -translate-x-1/2">
                    <StatusPicker
                      current={status}
                      isHolidayEve={!!(status && OVERRIDABLE_AUTO_STATUSES.includes(status))}
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
          {unfilledWorkdays.size > 0 && (
            <span className="flex items-center gap-1 text-red-500 font-medium">
              <span className="inline-block h-3 w-3 rounded-full bg-red-200 ring-1 ring-red-300" />
              {unfilledWorkdays.size} unfilled
            </span>
          )}
          <span className="ml-auto text-gray-400">
            {!isEditable
              ? "Calendar is locked"
              : multiSelectMode
              ? "Click days to select, then apply status below"
              : "Click a day to set status"}
          </span>
        </div>

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

      {openPickerDate && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenPickerDate(null)} />
      )}

      <ConfirmDialog
        open={showConfirm}
        title="Submit Monthly Report"
        message={`Submit your attendance report for ${periodLabel} to your manager for approval? You won't be able to make changes until it's reviewed.`}
        onConfirm={() => submitReport.mutate()}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
