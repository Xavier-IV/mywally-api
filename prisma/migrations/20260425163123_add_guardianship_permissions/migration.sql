-- AlterTable
ALTER TABLE "Guardianship" ADD COLUMN     "canReceiveAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canViewBalance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canViewTransactions" BOOLEAN NOT NULL DEFAULT true;
