/**
 * Reporting Period Utility
 *
 * Computes the start and end dates of a reporting period given a month, year,
 * and the organization's monthStartDay setting.
 *
 * If monthStartDay = 26, then "March 2026" reporting period is Feb 26 – Mar 25.
 * If monthStartDay = 1,  then "March 2026" reporting period is Mar 1 – Mar 31 (standard).
 */

/**
 * Returns { from, to } date strings (YYYY-MM-DD) for a given reporting month.
 *
 * @param month 1-12 (the "label" month, e.g. 3 = March)
 * @param year  e.g. 2026
 * @param monthStartDay 1-28, the day of the month the reporting period starts
 */
export function getReportingPeriod(month: number, year: number, monthStartDay: number) {
  if (monthStartDay === 1) {
    // Standard calendar month
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    // Last day of the month
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { from, to };
  }

  // Custom start day: the period starts on monthStartDay of the previous month
  // and ends on (monthStartDay - 1) of the label month.
  // E.g. monthStartDay=26, month=3 (March), year=2026 → Feb 26 – Mar 25

  // Start: previous month's monthStartDay
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const from = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(monthStartDay).padStart(2, "0")}`;

  // End: this month's (monthStartDay - 1)
  const endDay = monthStartDay - 1;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  return { from, to };
}

/**
 * Determines which reporting month a given date falls into.
 *
 * @param dateStr YYYY-MM-DD
 * @param monthStartDay 1-28
 * @returns { month, year } where month is the reporting month label (1-12)
 */
export function getReportingMonth(dateStr: string, monthStartDay: number) {
  const [y, m, d] = dateStr.split("-").map(Number);

  if (monthStartDay === 1) {
    return { month: m, year: y };
  }

  // If the day is >= monthStartDay, we're in the "next" reporting month
  if (d >= monthStartDay) {
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    return { month: nextMonth, year: nextYear };
  }

  // Otherwise we're in the current calendar month's reporting period
  return { month: m, year: y };
}
