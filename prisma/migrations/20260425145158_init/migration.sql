-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PARENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "GuardianshipStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('RECEIVED', 'SCORED', 'HELD', 'NOTIFIED', 'CALLING', 'RELEASED', 'BLOCKED', 'ABORTED');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('APPROVE', 'REJECT', 'CALL_PARENT', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "DecisionChannel" AS ENUM ('PUSH', 'VOICE', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pinHash" TEXT,
    "expoPushToken" TEXT,
    "pinLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "agreementSignedAt" TIMESTAMP(3),
    "dailyAutoApproveLimit" DECIMAL(65,30) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardianship" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "status" "GuardianshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "sunsetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guardianship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "recipientName" TEXT NOT NULL,
    "recipientHandle" TEXT NOT NULL,
    "merchantCategory" TEXT,
    "isFirstTimeRecipient" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER,
    "riskReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "TransactionState" NOT NULL DEFAULT 'RECEIVED',
    "heldAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionEvent" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "channel" "DecisionChannel" NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "dtmf" TEXT,
    "pinAttempts" INTEGER NOT NULL DEFAULT 0,
    "twilioCallSid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 50,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Guardianship_familyId_guardianId_key" ON "Guardianship"("familyId", "guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalRef_key" ON "Transaction"("externalRef");

-- CreateIndex
CREATE INDEX "Transaction_state_idx" ON "Transaction"("state");

-- CreateIndex
CREATE INDEX "Transaction_familyId_createdAt_idx" ON "Transaction"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionEvent_transactionId_createdAt_idx" ON "TransactionEvent"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionLog_transactionId_idx" ON "DecisionLog"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRule_name_key" ON "RiskRule"("name");

-- CreateIndex
CREATE INDEX "IdempotencyKey_scope_createdAt_idx" ON "IdempotencyKey"("scope", "createdAt");

-- AddForeignKey
ALTER TABLE "Family" ADD CONSTRAINT "Family_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionEvent" ADD CONSTRAINT "TransactionEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
