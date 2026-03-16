-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "days_off" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "employment_percentage" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "orgs" ALTER COLUMN "month_start_day" SET DEFAULT 26;
