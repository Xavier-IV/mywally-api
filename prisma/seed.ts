import { PrismaClient, UserRole, GuardianshipStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const guardianPhone = process.env.SEED_GUARDIAN_PHONE ?? '+60138155761';
  const parentPhone = process.env.SEED_PARENT_PHONE ?? '+60123456789';

  const parent = await prisma.user.upsert({
    where: { phone: parentPhone },
    update: {},
    create: {
      role: UserRole.PARENT,
      fullName: 'Aishah binti Rahman',
      phone: parentPhone,
    },
  });

  const guardian = await prisma.user.upsert({
    where: { phone: guardianPhone },
    update: {},
    create: {
      role: UserRole.GUARDIAN,
      fullName: 'Adam binti Aishah',
      phone: guardianPhone,
    },
  });

  let family = await prisma.family.findFirst({ where: { parentId: parent.id } });
  if (!family) {
    family = await prisma.family.create({
      data: {
        parentId: parent.id,
        agreementSignedAt: new Date(),
        balance: 1568.97,
      },
    });
  } else {
    family = await prisma.family.update({
      where: { id: family.id },
      data: { balance: 1568.97 },
    });
  }

  await prisma.guardianship.upsert({
    where: { familyId_guardianId: { familyId: family.id, guardianId: guardian.id } },
    update: { status: GuardianshipStatus.ACTIVE, relationshipLabel: 'Daughter' },
    create: {
      familyId: family.id,
      guardianId: guardian.id,
      status: GuardianshipStatus.ACTIVE,
      relationshipLabel: 'Daughter',
    },
  });

  console.log('Seeded:');
  console.log(`  Family ${family.id}`);
  console.log(`  Parent  ${parent.fullName} ${parent.phone}`);
  console.log(`  Guardian ${guardian.fullName} ${guardian.phone}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
