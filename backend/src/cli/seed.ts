import 'dotenv/config';
import { Command } from 'commander';
import { AppDataSource } from '../database/data-source';
import { SeedService } from '../modules/seed/seed.service';
import { SeedVerifyService } from '../modules/seed/seed-verify.service';

const program = new Command();
program.name('seed').description('Seed data untuk aplikasi darurat');

program
  .command('base')
  .description('Jalankan seed:base (ditolak jika ENV=prod)')
  .action(async () => {
    const ds = await AppDataSource.initialize();
    const svc = new SeedService(ds);
    try {
      await svc.base();
    } finally {
      await ds.destroy();
    }
  });

program
  .command('verify')
  .description('Verifikasi seed V1-V11')
  .action(async () => {
    const ds = await AppDataSource.initialize();
    try {
      const ok = await new SeedVerifyService(ds).verify();
      if (!ok) process.exitCode = 1;
    } finally {
      await ds.destroy();
    }
  });

program
  .command('reset-live')
  .description('Hapus data operasional, pertahankan data dasar')
  .action(async () => {
    const ds = await AppDataSource.initialize();
    const svc = new SeedService(ds);
    try {
      await svc.resetLive();
    } finally {
      await ds.destroy();
    }
  });

program.parseAsync(process.argv);
