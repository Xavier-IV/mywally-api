-- AlterTable
ALTER TABLE "Family" ADD COLUMN     "balance" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Guardianship" ADD COLUMN     "relationshipLabel" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT;
