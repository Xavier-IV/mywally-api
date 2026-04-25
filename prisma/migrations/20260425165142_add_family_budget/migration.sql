-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Family" ADD COLUMN     "budgetAmount" DECIMAL(65,30) NOT NULL DEFAULT 100,
ADD COLUMN     "budgetPeriod" "BudgetPeriod" NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "warningThresholdPercent" INTEGER NOT NULL DEFAULT 80;
