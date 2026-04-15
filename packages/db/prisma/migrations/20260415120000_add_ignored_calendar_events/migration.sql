-- CreateTable
CREATE TABLE "ignored_calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "event_title" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ignored_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ignored_calendar_events_org_id_idx" ON "ignored_calendar_events"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ignored_calendar_events_org_id_event_title_key" ON "ignored_calendar_events"("org_id", "event_title");

-- AddForeignKey
ALTER TABLE "ignored_calendar_events" ADD CONSTRAINT "ignored_calendar_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
