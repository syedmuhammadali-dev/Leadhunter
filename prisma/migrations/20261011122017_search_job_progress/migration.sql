-- AlterTable
ALTER TABLE "SearchJob" ADD COLUMN     "auditsFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "auditsPlanned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "step" TEXT;
