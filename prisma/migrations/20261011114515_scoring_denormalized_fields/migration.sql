-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "lastAuditedAt" TIMESTAMP(3),
ADD COLUMN     "websiteScore" INTEGER;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "maximumScore" INTEGER,
ADD COLUMN     "priority" "PriorityLevel",
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Business_websiteScore_idx" ON "Business"("websiteScore");

-- CreateIndex
CREATE INDEX "Lead_priority_idx" ON "Lead"("priority");

-- CreateIndex
CREATE INDEX "Lead_score_idx" ON "Lead"("score");
