/**
 * HikVision Integration Service (PLACEHOLDER)
 *
 * This service will integrate with HikVision access control systems
 * to check if employees signed into the building on a given day.
 *
 * TODO: Implement when HikVision system is set up.
 *
 * Expected workflow:
 *   1. Configure HikVision API connection (URL, credentials)
 *   2. Query the HikVision API for access events by employee on a date
 *   3. Return sign-in status + timestamp
 *
 * HikVision ISAPI typically exposes endpoints like:
 *   GET /ISAPI/AccessControl/AcsEvent?searchID=...
 *   POST /ISAPI/AccessControl/AcsEvent/Capabilities
 *
 * You'll need to map employee records to HikVision person IDs,
 * likely via employee number or a dedicated hikvisionId field.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface HikVisionConfig {
  apiUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface HikVisionSignIn {
  signedIn: boolean;
  signInTime?: Date;
}

// ─── Configuration ───────────────────────────────────────────────────

export function getHikVisionConfig(): HikVisionConfig | null {
  const apiUrl = process.env.HIKVISION_API_URL;
  if (!apiUrl) {
    // HikVision not configured — this is expected during development
    return null;
  }

  return {
    apiUrl,
    apiKey: process.env.HIKVISION_API_KEY,
    username: process.env.HIKVISION_USERNAME,
    password: process.env.HIKVISION_PASSWORD,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Check if an employee signed in via HikVision on a given date.
 *
 * @param config      - HikVision API configuration
 * @param employeeId  - The employee's ID (or employee number for HikVision mapping)
 * @param date        - The date to check (YYYY-MM-DD)
 * @returns Sign-in info if found, or null if HikVision is not connected
 *
 * TODO: Replace this placeholder with actual HikVision ISAPI calls.
 *       Typical implementation:
 *       1. POST /ISAPI/AccessControl/AcsEvent/search with date range + employeeNo
 *       2. Parse response for ENTRY events
 *       3. Return earliest entry time as signInTime
 */
export async function checkEmployeeSignIn(
  _config: HikVisionConfig,
  _employeeId: string,
  _date: string,
): Promise<HikVisionSignIn | null> {
  // ── PLACEHOLDER ──────────────────────────────────────────────
  // Returns null to indicate HikVision is not connected.
  // The daily attendance job will fall through to Google Calendar
  // check when this returns null.
  //
  // When implementing, return:
  //   { signedIn: true, signInTime: new Date(...) } — if employee entered building
  //   { signedIn: false }                           — if no entry found
  //   null                                          — if HikVision is unreachable
  // ─────────────────────────────────────────────────────────────

  return null;
}
