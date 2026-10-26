import { Command } from 'commander';
import { AppDataSource } from '../database/data-source';
import { SeedService } from '../modules/seed/seed.service';

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
    const svc = new SeedService(ds);
    try {
      await svc.verify();
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
