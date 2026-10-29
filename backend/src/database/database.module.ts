import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { entities } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        // Daftar lengkap 32 entitas (== barrel `entities` dan DataSource migrasi).
        // `autoLoadEntities` hanya mendaftarkan entitas lewat `forFeature` sehingga
        // relasi ke entitas yang belum punya modul (mis. `Dispatch`) gagal saat
        // pembangunan metadata — daftar eksplisit mencegah itu.
        entities,
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
