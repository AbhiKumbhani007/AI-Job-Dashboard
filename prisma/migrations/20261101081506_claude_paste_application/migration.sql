-- AlterTable
ALTER TABLE "ClaudePaste" ADD COLUMN     "applicationId" TEXT;

-- CreateIndex
CREATE INDEX "ClaudePaste_applicationId_idx" ON "ClaudePaste"("applicationId");

-- AddForeignKey
ALTER TABLE "ClaudePaste" ADD CONSTRAINT "ClaudePaste_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
