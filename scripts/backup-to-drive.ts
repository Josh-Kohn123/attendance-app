/**
 * Upload a file to a Google Drive folder using a service account.
 *
 * Usage:
 *   npx tsx scripts/backup-to-drive.ts <local-file-path>
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  JSON string of the service account key
 *   DRIVE_FOLDER_ID              Drive folder ID (the part after /folders/ in the URL)
 *
 * The folder must be shared with the service account's client_email
 * (Editor access) for the upload to succeed.
 */

import { google } from "googleapis";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

function die(msg: string): never {
  console.error(`[backup-to-drive] ${msg}`);
  process.exit(1);
}

const localPath = process.argv[2];
if (!localPath) die("Missing argument: <local-file-path>");
if (!SERVICE_ACCOUNT_JSON) die("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");
if (!DRIVE_FOLDER_ID) die("DRIVE_FOLDER_ID env var is not set");

const stat = statSync(localPath);
if (!stat.isFile()) die(`Not a file: ${localPath}`);

let credentials: { client_email: string; private_key: string };
try {
  credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch {
  die("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
}

const auth = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});

const drive = google.drive({ version: "v3", auth });

const fileName = basename(localPath);
const mimeType = fileName.endsWith(".gz") ? "application/gzip" : "application/octet-stream";

console.log(`[backup-to-drive] Uploading ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);
console.log(`[backup-to-drive] Service account: ${credentials.client_email}`);
console.log(`[backup-to-drive] Folder: ${DRIVE_FOLDER_ID}`);

const start = Date.now();
const response = await drive.files.create({
  requestBody: {
    name: fileName,
    parents: [DRIVE_FOLDER_ID],
  },
  media: {
    mimeType,
    body: createReadStream(localPath),
  },
  fields: "id, name, size, webViewLink",
  supportsAllDrives: true,
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[backup-to-drive] ✔ Uploaded in ${elapsed}s`);
console.log(`[backup-to-drive] File ID: ${response.data.id}`);
console.log(`[backup-to-drive] View: ${response.data.webViewLink}`);
