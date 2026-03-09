-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "calendar_digest_admin_user_id" UUID;

-- CreateTable
CREATE TABLE "calendar_digests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "token" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_digest_entries" (
    "id" UUID NOT NULL,
    "digest_id" UUID NOT NULL,
    "event_title" VARCHAR(500) NOT NULL,
    "event_id" VARCHAR(255),
    "start_date" VARCHAR(10) NOT NULL,
    "end_date" VARCHAR(10) NOT NULL,
    "match_type" VARCHAR(30) NOT NULL,
    "proposed_employee_id" UUID,
    "proposed_status" VARCHAR(20),
    "candidate_employee_ids" TEXT[],
    "decision" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "resolved_employee_id" UUID,
    "resolved_status" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_digest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_digests_token_key" ON "calendar_digests"("token");

-- CreateIndex
CREATE INDEX "calendar_digests_org_id_idx" ON "calendar_digests"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_digests_org_id_date_key" ON "calendar_digests"("org_id", "date");

-- CreateIndex
CREATE INDEX "calendar_digest_entries_digest_id_idx" ON "calendar_digest_entries"("digest_id");

-- CreateIndex
CREATE INDEX "calendar_digest_entries_event_id_idx" ON "calendar_digest_entries"("event_id");

-- AddForeignKey
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_calendar_digest_admin_user_id_fkey" FOREIGN KEY ("calendar_digest_admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_digests" ADD CONSTRAINT "calendar_digests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_digest_entries" ADD CONSTRAINT "calendar_digest_entries_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "calendar_digests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
