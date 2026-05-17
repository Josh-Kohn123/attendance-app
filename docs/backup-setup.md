# Monthly Database Backup Setup

This repo runs a monthly job that dumps the Neon Postgres database and uploads
the compressed dump to a Google Drive folder.

- Workflow: `.github/workflows/monthly-backup.yml`
- Upload script: `scripts/backup-to-drive.ts`
- Schedule: 03:00 UTC on the 1st of every month (also triggerable manually)

## One-time setup

### 1. Create a Google Cloud service account

A service account is a non-human Google identity that can act on the workflow's
behalf. We give it permission to upload files to one specific Drive folder.

1. Open https://console.cloud.google.com/iam-admin/serviceaccounts
2. Pick a project (you can reuse the one that hosts your Calendar service
   account, or create a new one — e.g. `orbs-backups`).
3. Click **Create Service Account**.
   - Name: `orbs-db-backup`
   - ID: `orbs-db-backup` (auto-filled)
   - Description: "Monthly DB backup uploader"
4. Skip the optional "Grant access to project" and "Grant users access" steps.
5. On the service account list, click the account → **Keys** tab → **Add Key →
   Create new key → JSON**. A `.json` file downloads. **Treat this like a
   password** — it grants full access to anything the service account can do.

### 2. Enable the Google Drive API on that project

1. https://console.cloud.google.com/apis/library/drive.googleapis.com
2. Make sure the right project is selected (top bar).
3. Click **Enable**.

### 3. Create the Drive folder and share it

1. In Google Drive, create a folder. Suggested name: `Orbs DB Backups`.
2. Open the folder, copy the **folder ID** from the URL — the part after
   `/folders/`. Example:
   `https://drive.google.com/drive/folders/1AbCdEfGhIjK...` →
   folder ID is `1AbCdEfGhIjK...`.
3. Right-click the folder → **Share**. Add the service account's
   `client_email` (from the JSON file, looks like
   `orbs-db-backup@<project>.iam.gserviceaccount.com`). Give it **Editor**
   access. Uncheck "Notify people".

### 4. Add the three GitHub repository secrets

In GitHub, go to **Settings → Secrets and variables → Actions → New repository
secret** and add:

| Name                          | Value                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | The **unpooled** Neon connection string (the one without `-pooler` in the host).       |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The entire contents of the service account JSON file. Paste the whole `{...}` object. |
| `DRIVE_FOLDER_ID`             | The folder ID from step 3.                                                             |

Use the unpooled URL because `pg_dump` opens a long-running transaction, and
PgBouncer in transaction mode breaks that.

### 5. Test the workflow manually

1. Go to the repo's **Actions** tab → **Monthly Database Backup** → **Run
   workflow**.
2. Pick the branch and click the green **Run workflow** button.
3. Watch the run. The final step prints the Drive file URL.
4. Open your Drive folder — `orbs-db-backup-<date>.sql.gz` should be there.

## What's in a backup

The `.sql.gz` is a `pg_dump --format=plain` of the entire `neondb` database:
schema, indexes, foreign keys, constraints, all rows. To restore:

```bash
gunzip -c orbs-db-backup-YYYY-MM-DD.sql.gz | psql "$DATABASE_URL"
```

## What's NOT in a backup

- Vercel environment variables (`JWT_SECRET`, OAuth secrets, Gmail OAuth
  refresh token, Hikvision creds, etc.). Snapshot these separately with
  `vercel env pull` whenever they change.
- The source-of-truth events in Google Calendar (the dump contains your
  processed `attendance_events`, but not the raw calendar entries).
- User avatar image bytes (only the URL is stored).

## Rotating the service account key

If the JSON key ever leaks, revoke it immediately in the Cloud Console
(service account → Keys → trash icon) and generate a new one. Update the
`GOOGLE_SERVICE_ACCOUNT_JSON` GitHub secret with the new JSON.
