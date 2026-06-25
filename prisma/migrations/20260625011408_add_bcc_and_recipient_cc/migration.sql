-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "bcc" TEXT;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN "bcc" TEXT;
ALTER TABLE "Recipient" ADD COLUMN "cc" TEXT;
