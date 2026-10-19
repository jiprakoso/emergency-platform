# PROGRESS.md

Laporan kemajuan per fase. Update realtime saat mengerjakan.

## Fase 0
### 0a - Fondasi repositori & lingkungan
- [x] Struktur repo sesuai struktur-direktori.md
- [x] infra/docker-compose.dev.yml (Postgres+PostGIS, Redis, MinIO)
- [x] Makefile (target up/down/migrate/seed/reset-live/verify/test/lint/contract/demo-bots)
- [x] Backend NestJS kerangka (config validasi, pino redact PII, /health, /health/ready, TypeORM, Redis)
- [x] Migrasi dasar (ekstensi + 8 tabel inti) naik/turun tervalidasi di PostGIS sungguhan (sisa tabel ERD menyusul Fase 1)
- [x] Dashboard Vite+React+TS kerangka
- [x] .env.example backend
- [x] Berkas meta diperbarui
- Status: SELESAI (0a) - berhenti di sini, tunggu persetujuan lanjut ke 0b
- Penyimpangan: -
- Asumsi: A-001,A-002,A-003
- Pertanyaan terbuka: Q-001..Q-005
- Catatan: image `minio/minio` tidak dapat ditarik di lingkungan ini (registry restriction); compose menyertakan MinIO untuk kompatibilitas, verifikasi penuh menunggu env dengan akses registry MinIO. Port host dipindah: PG 5433, Redis 6379, MinIO 9000/9001 (hindari bentrok 5432).

### 0b - Kontrak OpenAPI
- [x] `contracts/openapi.yaml` OpenAPI 3.1: 114 endpoint (semua baris REST §5.1-5.14)
- [x] Komponen: amplop (Envelope/PageEnvelope/ErrorEnvelope), Coordinates, enum domain, 5 view (CitizenReportView/OfferView/UnitView/DispatcherView/IncidentSummary), ErrorCode katalog §7
- [x] Ekstensi x-permission, x-audit, x-idempotent, security bearerAuth
- [x] `contracts/scripts/check-coverage.py`: pemeriksaan cakupan dokumen ↔ kontrak
- [x] `make contract`: Spectral (0 error/warning) + cakupan 114↔114 OK
- [x] operationId untuk semua operasi (dipakai penamaan contoh quicktype §6.5)
- Status: SELESAI (0b) - berhenti di sini (titik tinjau C0: kontrak menunggu persetujuan manusia)
- Penyimpangan: -
- Asumsi: -
- Pertanyaan terbuka: -
- Catatan: contoh JSON (`contracts/examples/`) dan mock server dikerjakan di 0c; `asyncapi.yaml` di 0c.

### 0c - AsyncAPI, contoh JSON, mock server
- Status: menunggu 0b disetujui (C0)
