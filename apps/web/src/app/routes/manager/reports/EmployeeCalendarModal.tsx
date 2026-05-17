import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import clsx from "clsx";
import dayjs from "dayjs";
import { api } from "../../../../api/client";

type DayStatus =
  | "PRESENT"
  | "SICK"
  | "CHILD_SICK"
  | "VACATION"
  | "RESERVES"
  | "HALF_DAY"
  | "WORK_FROM_HOME"
  | "PUBLIC_HOLIDAY"
  | "PUBLIC_HOLIDAY_HALF"
  | "HOLIDAY_EVE"
  | "HOLIDAY_EVE_VACATION"
  | "HOLIDAY_EVE_SICK"
  | "CHOICE_DAY"
  | "ADVANCED_STUDY"
  | "DAY_OFF";

const STATUS_CONFIG: Record<
  DayStatus,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  PRESENT:              { label: "In Office",              bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500",  border: "border-green-300"  },
  SICK:                 { label: "Sick",                   bg: "bg-amber-100",  text: "text-amber-800",  dot: "bg-amber-500",  border: "border-amber-300"  },
  CHILD_SICK:           { label: "Child Sick",             bg: "bg-rose-100",   text: "text-rose-800",   dot: "bg-rose-500",   border: "border-rose-300"   },
  VACATION:             { label: "Vacation",               bg: "bg-sky-100",    text: "text-sky-800",    dot: "bg-sky-500",    border: "border-sky-300"    },
  RESERVES:             { label: "Reserves",               bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500", border: "border-purple-300" },
  HALF_DAY:             { label: "Half Day Off",           bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500", border: "border-orange-300" },
  WORK_FROM_HOME:       { label: "Work From Home",         bg: "bg-teal-100",   text: "text-teal-800",   dot: "bg-teal-500",   border: "border-teal-300"   },
  PUBLIC_HOLIDAY:       { label: "Holiday - Paid",         bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-500", border: "border-indigo-300" },
  PUBLIC_HOLIDAY_HALF:  { label: "Holiday (Half)",         bg: "bg-indigo-50",  text: "text-indigo-700", dot: "bg-indigo-400", border: "border-indigo-200" },
  HOLIDAY_EVE:          { label: "Holiday Eve",            bg: "bg-indigo-50",  text: "text-indigo-700", dot: "bg-indigo-400", border: "border-indigo-200" },
  HOLIDAY_EVE_VACATION: { label: "Holiday Eve + Vacation", bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-sky-500",    border: "border-indigo-300" },
  HOLIDAY_EVE_SICK:     { label: "Holiday Eve + Sick",     bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-amber-500",  border: "border-indigo-300" },
  CHOICE_DAY:           { label: "Choice Day",             bg: "bg-cyan-100",   text: "text-cyan-800",   dot: "bg-cyan-500",   border: "border-cyan-300"   },
  ADVANCED_STUDY:       { label: "Study",                  bg: "bg-lime-100",   text: "text-lime-800",   dot: "bg-lime-500",   border: "border-lime-300"   },
  DAY_OFF:              { label: "Day Off",                bg: "bg-gray-100",   text: "text-gray-600",   dot: "bg-gray-400",   border: "border-gray-300"   },
};

const AUTO_STATUSES: DayStatus[] = ["PUBLIC_HOLIDAY", "PUBLIC_HOLIDAY_HALF", "DAY_OFF"];
const WEEKDAY_MAP: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4 };

export interface EmployeeCalendarModalProps {
  employeeId: string;
  employeeName: string;
  departmentName?: string | null;
  from: string;
  to: string;
  monthLabel: string;
  monthStartDay: number;
  totals?: {
    present?: number;
    sick?: number;
    childSick?: number;
    vacation?: number;
    reserves?: number;
    halfDay?: number;
    workFromHome?: number;
    publicHoliday?: number;
    dayOff?: number;
  };
  onClose: () => void;
}

export function EmployeeCalendarModal({
  employeeId,
  employeeName,
  departmentName,
  from,
  to,
  monthLabel,
  monthStartDay,
  totals,
  onClose,
}: EmployeeCalendarModalProps) {
  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ["attendance", "employee", employeeId, from, to],
    queryFn: () =>
      api.get<{ items: Array<{ serverTimestamp: string; notes: string | null }> }>(
        `/attendance/employee/${employeeId}?from=${from}&to=${to}&limit=100`,
      ),
  });

  const { data: holidays } = useQuery<{ date: string; name: string; halfDay?: boolean }[]>({
    queryKey: ["holidays-dates", from, to],
    queryFn: () => api.get(`/admin/holidays/dates?from=${from}&to=${to}`),
  });

  const { data: employeeDetails } = useQuery<{ daysOff?: string[] }>({
    queryKey: ["employee-details", employeeId],
    queryFn: () => api.get(`/employees/${employeeId}`),
  });

  const holidayDates = useMemo(() => {
    const map = new Map<string, { name: string; halfDay: boolean }>();
    for (const h of holidays ?? []) {
      map.set(h.date, { name: h.name, halfDay: !!h.halfDay });
    }
    return map;
  }, [holidays]);

  const daysOffSet = useMemo(() => {
    const empDaysOff = employeeDetails?.daysOff ?? [];
    return new Set(empDaysOff.map((d) => WEEKDAY_MAP[d]).filter((n) => n !== undefined));
  }, [employeeDetails]);

  const statusByDate = useMemo(() => {
    const map = new Map<string, DayStatus>();
    for (const [d, info] of holidayDates) map.set(d, info.halfDay ? "HOLIDAY_EVE" : "PUBLIC_HOLIDAY");
    let cursor = dayjs(from);
    const end = dayjs(to);
    while (!cursor.isAfter(end)) {
      const dateStr = cursor.format("YYYY-MM-DD");
      if (daysOffSet.has(cursor.day()) && !holidayDates.has(dateStr)) {
        map.set(dateStr, "DAY_OFF");
      }
      cursor = cursor.add(1, "day");
    }
    if (attendance?.items) {
      for (const event of attendance.items) {
        const dateStr = dayjs(event.serverTimestamp).format("YYYY-MM-DD");
        if (event.notes && (event.notes as string) in STATUS_CONFIG) {
          const existing = map.get(dateStr);
          if (!existing || !AUTO_STATUSES.includes(existing)) {
            map.set(dateStr, event.notes as DayStatus);
          }
        }
      }
    }
    return map;
  }, [attendance, holidayDates, daysOffSet, from, to]);

  const days = useMemo(() => {
    const arr: (dayjs.Dayjs | null)[] = [];
    const start = dayjs(from);
    const end = dayjs(to);
    for (let i = 0; i < start.day(); i++) arr.push(null);
    let cursor = start;
    while (!cursor.isAfter(end)) {
      arr.push(cursor);
      cursor = cursor.add(1, "day");
    }
    return arr;
  }, [from, to]);

  const presentStatuses = useMemo(() => {
    const set = new Set<DayStatus>();
    for (const s of statusByDate.values()) set.add(s);
    return set;
  }, [statusByDate]);

  const isToday = (d: dayjs.Dayjs) => d.isSame(dayjs(), "day");
  const isFuture = (d: dayjs.Dayjs) => d.isAfter(dayjs(), "day");
  const isWeekend = (d: dayjs.Dayjs) => d.day() === 5 || d.day() === 6;

  const totalEntries = [
    { label: "Present",        count: totals?.present ?? 0,        cls: "bg-green-100 text-green-700"   },
    { label: "Sick",           count: totals?.sick ?? 0,           cls: "bg-amber-100 text-amber-700"   },
    { label: "Child Sick",     count: totals?.childSick ?? 0,      cls: "bg-rose-100 text-rose-700"     },
    { label: "Vacation",       count: totals?.vacation ?? 0,       cls: "bg-sky-100 text-sky-700"       },
    { label: "Reserves",       count: totals?.reserves ?? 0,       cls: "bg-purple-100 text-purple-700" },
    { label: "Half Day Off",   count: totals?.halfDay ?? 0,        cls: "bg-orange-100 text-orange-700" },
    { label: "Work From Home", count: totals?.workFromHome ?? 0,   cls: "bg-teal-100 text-teal-700"     },
    { label: "Public Holiday", count: totals?.publicHoliday ?? 0,  cls: "bg-indigo-100 text-indigo-700" },
    { label: "Day Off",        count: totals?.dayOff ?? 0,         cls: "bg-gray-100 text-gray-600"     },
  ].filter((t) => t.count > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {employeeName} — {monthLabel}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {departmentName ? `${departmentName} · ` : ""}
              {monthStartDay !== 1 ? `${from} → ${to}` : monthLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-gray-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {loadingAttendance ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;

              const dateStr = day.format("YYYY-MM-DD");
              const status = statusByDate.get(dateStr);
              const cfg = status ? STATUS_CONFIG[status] : null;
              const weekend = isWeekend(day);
              const today = isToday(day);
              const future = isFuture(day);
              const holidayInfo = holidayDates.get(dateStr);

              const tooltipParts = [
                day.format("ddd, MMM D"),
                cfg ? cfg.label : null,
                holidayInfo ? `Holiday: ${holidayInfo.name}` : null,
              ].filter(Boolean);

              return (
                <div
                  key={dateStr}
                  title={tooltipParts.join(" — ")}
                  className={clsx(
                    "relative flex h-14 w-full flex-col items-center justify-center rounded-xl text-sm",
                    weekend && !cfg && "bg-gray-50 text-gray-500 dark:bg-gray-800/40 dark:text-gray-500",
                    future && !cfg && "text-gray-300 dark:text-gray-600",
                    today && "ring-2 ring-blue-400",
                    cfg && `${cfg.bg} ${cfg.text}`,
                  )}
                >
                  <span className="font-medium leading-none">{day.date()}</span>
                  {cfg && (
                    <span className={clsx("mt-1 text-[9px] font-semibold uppercase tracking-wide", cfg.text)}>
                      {cfg.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Totals strip */}
        {totalEntries.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            {totalEntries.map((t) => (
              <span
                key={t.label}
                className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", t.cls)}
              >
                {t.label}
                <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-semibold">{t.count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Legend — only statuses that appear this month */}
        {presentStatuses.size > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            {Array.from(presentStatuses).map((key) => {
              const cfg = STATUS_CONFIG[key];
              return (
                <span key={key} className="flex items-center gap-1">
                  <span className={clsx("inline-block h-2.5 w-2.5 rounded-full", cfg.dot)} />
                  {cfg.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
