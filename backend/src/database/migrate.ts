import 'reflect-metadata';
import { AppDataSource } from './data-source';

async function main(): Promise<void> {
  const command = process.argv[2] || 'run';
  await AppDataSource.initialize();
  try {
    switch (command) {
      case 'run': {
        const applied = await AppDataSource.runMigrations();
        console.log(`Migrasi diterapkan: ${applied.length}`);
        applied.forEach((m) => console.log(`  - ${m.name}`));
        break;
      }
      case 'revert': {
        await AppDataSource.undoLastMigration();
        console.log('Migrasi terakhir dibatalkan.');
        break;
      }
      case 'show': {
        const migrations = await AppDataSource.showMigrations();
        console.log(`Ada migrasi tertunda: ${migrations}`);
        break;
      }
      default:
        throw new Error(`Perintah tidak dikenal: ${command}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
