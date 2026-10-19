# PROGRESS.md

Laporan kemajuan per fase. Update realtime saat mengerjakan.

## Fase 0
### 0a - Fondasi repositori & lingkungan
- [ ] Struktur repo sesuai struktur-direktori.md
- [ ] infra/docker-compose.dev.yml (Postgres+PostGIS, Redis, MinIO)
- [ ] Makefile (target up/down/migrate/seed/reset-live/verify/test/lint/contract/demo-bots)
- [ ] Backend NestJS kerangka (config validasi, pino redact PII, /health, /health/ready, TypeORM, Redis)
- [ ] Migrasi ERD v1.3 (32 tabel) naik/turun
- [ ] Dashboard Vite+React+TS kerangka
- [ ] .env.example backend
- [ ] Berkas meta diperbarui
- Status: belum dimulai
- Penyimpangan: -
- Asumsi: A-001,A-002,A-003
- Pertanyaan terbuka: Q-001..Q-005

### 0b - Kontrak OpenAPI
- Status: menunggu 0a selesai

### 0c - AsyncAPI, contoh JSON, mock server
- Status: menunggu 0b selesai
