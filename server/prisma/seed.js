
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const run = async () => {
  try {
    // 1. Find or create Demo Mess
    let mess = await prisma.mess.findFirst({
      where: { name: 'Demo Mess' }
    });

    if (!mess) {
      mess = await prisma.mess.create({
        data: {
          name: 'Demo Mess',
          joinCode: 'MESSMATE-JOIN',
          settings: {
            create: { mealRate: 55 }
          }
        }
      });
    }

    // 2. Find or create Admin
    const hash = await bcrypt.hash('ChangeMe123!', 12);

    let admin = await prisma.user.findUnique({
      where: { email: 'admin@messmate.local' }
    });

    if (!admin) {
      admin = await prisma.user.create({
        data: {
          messId: mess.id,
          name: 'Mess Admin',
          email: 'admin@messmate.local',
          passwordHash: hash,
          role: 'ADMIN'
        }
      });
    } else {
      // Connect existing admin to Demo Mess
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          messId: mess.id,
          role: 'ADMIN'
        }
      });
    }

    // 3. New six members
    const names = [
      'Nur',
      'Ifty',
      'Ove',
      'Towhid',
      'Vai',
      'Rahat'
    ];

    // 4. Reset old accounting data and members
    await prisma.$transaction(async (tx) => {

      await tx.mealEntry.deleteMany({
        where: { messId: mess.id }
      });

      await tx.transaction.deleteMany({
        where: { messId: mess.id }
      });

      // Delete old member profiles
      await tx.member.deleteMany({
        where: { messId: mess.id }
      });

      // Delete old member login accounts
      await tx.user.deleteMany({
        where: {
          messId: mess.id,
          role: 'MEMBER'
        }
      });

      // Create new members
      await tx.member.createMany({
        data: names.map(name => ({
          messId: mess.id,
          name
        }))
      });
    });

    console.log('\n================================');
    console.log('MESSMATE RESET SUCCESSFUL');
    console.log('================================');
    console.log('Mess: Demo Mess');
    console.log('Admin: admin@messmate.local');
    console.log('Admin password: Existing password retained');
    console.log('Total members: 6');
    console.log('Members:', names.join(', '));
    console.log('Accounting period: November 2026 - October 2027');
    console.log('================================\n');

  } catch (error) {
    console.error('Seed error:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

run();
