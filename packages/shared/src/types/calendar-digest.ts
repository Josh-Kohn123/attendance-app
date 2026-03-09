// ─── Calendar Digest Types ───────────────────────────────────────────
// Shared between the worker (creates digests) and the API/frontend (reviews them)

export type DigestMatchType =
  | "MATCHED"            // single employee matched + known absence status
  | "AMBIGUOUS_NAME"     // multiple employees share the same first name
  | "UNMATCHED"          // no employee found (typo, nickname, unknown person)
  | "INACTIVE_EMPLOYEE"  // matched but employee is marked inactive
  | "UNCLEAR_STATUS"     // employee matched but no recognizable absence keyword
  | "MANUAL";            // added directly by the admin on the review page

export type DigestDecision = "PENDING" | "CONFIRMED" | "DECLINED";

export type DigestStatus = "PENDING" | "SUBMITTED";

export interface DigestEntryCandidate {
  id: string;
  firstName: string;
  lastName: string;
}

export interface DigestEntry {
  id: string;
  eventTitle: string;
  eventId: string | null;
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD (inclusive)
  matchType: DigestMatchType;
  proposedEmployeeId: string | null;
  proposedEmployeeName: string | null;
  proposedStatus: string | null;
  candidateEmployees: DigestEntryCandidate[];
  decision: DigestDecision;
  resolvedEmployeeId: string | null;
  resolvedStatus: string | null;
  hasExistingEntry: boolean; // live-checked: employee already has attendance for this date
}

export interface DigestEmployee {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

export interface CalendarDigestData {
  id: string;
  orgId: string;
  orgName: string;
  date: string;
  status: DigestStatus;
  entries: DigestEntry[];
  employees: DigestEmployee[]; // all active employees, for dropdowns
}

export interface DigestConfirmDecision {
  entryId: string;
  decision: "CONFIRMED" | "DECLINED";
  resolvedEmployeeId?: string;
  resolvedStatus?: string;
}

export interface DigestAdditionalEntry {
  employeeId: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface DigestConfirmRequest {
  decisions: DigestConfirmDecision[];
  additionalEntries: DigestAdditionalEntry[];
}
