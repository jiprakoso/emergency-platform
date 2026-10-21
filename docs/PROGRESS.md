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
- [x] `contracts/asyncapi.yaml` AsyncAPI 3.1.0: 42 pesan (38 event s2c + 4 perintah c2s)
- [x] Ekstensi x-rooms, x-class (+DYNAMIC), x-ack-required, x-direction, x-fcm; envelope EventEnvelope
- [x] `contracts/scripts/gen-asyncapi.py`: generator dari katalog dokumen WS §5-§6
- [x] `contracts/scripts/check-asyncapi-coverage.py`: cakupan 38 s2c + 4 c2s OK
- [x] Lint AsyncAPI (Spectral, ruleset asyncapi bawaan) 0 error/warning
- [x] `contracts/examples/`: 63 respons REST (+ varian), 29 contoh galat, 64 contoh WS (amplop s2c, data c2s)
- [x] `contracts/scripts/gen-examples.py` + `check-examples.mjs` (ajv 2020-12, validasi + cakupan)
- [x] Mock server Prism (target `make` di `contracts/scripts/package.json`: `mock`, port 4010) — terverifikasi
- [x] `make contract` diperluas: lint OpenAPI + AsyncAPI + cakupan REST + cakupan AsyncAPI + validasi contoh
- Status: SELESAI (0c) - berhenti di sini (titik tinjau C0: OpenAPI + AsyncAPI + contoh menunggu persetujuan manusia)
- Penyimpangan: memperbaiki 2 cacat OpenAPI yang membuat respons mustahil/taksa-eksklusif (lihat CC-001, CC-002)
- Asumsi: A-004..A-008
- Pertanyaan terbuka: -
- Catatan: mock Prism belum dijadikan target Makefile tersendiri (dijalankan via `pnpm --dir contracts/scripts mock`); pertimbangkan menambah target `mock` bila diinginkan.

## Fase 1 - Inti backend, identitas, data dasar
### 1a - Skema, entitas, lapisan umum
- [x] Migrasi `1700000001000-core-schema.ts`: 32 tabel ERD + indeks GiST + partial index + `CHECK` (status/tipe `varchar`, bukan enum PG); naik→turun→naik bersih di PostGIS 15-3.3
- [x] Runner migrasi sendiri `src/database/migrate.ts` (run/revert/show) + `tsconfig.migrations.json` + DataSource barrel (`synchronize:false`)
- [x] 32 entitas TypeORM di `src/database/entities/` + barrel; `typecheck` hijau
- [x] Lapisan umum: katalog galat REST §7 + `AppError` + filter amplop galat (`Retry-After`), amplop sukses, `X-Request-Id` middleware, paginasi kursor, kripto (`sha256Hex`/`hashPayload`/`stableStringify`), idempotensi Redis (TTL 24 jam, konflik 422), rate limit (seluruh batas REST §8), occurred-at, `main.ts` (helmet, body 1 MB, prefix `api/v1`), `ClockModule` `@Global`
- Status: SELESAI (1a)

### 1b - Permission dan autentikasi
- [x] Modul permission: katalog 38 kode + matriks `ROLE_PERMISSIONS`, `PermissionService` (cache Redis 60s), `@RequirePermission`, `PermissionGuard`
- [x] Modul auth: OTP mock (`123456`), registrasi/login warga, login staf (kata sandi + 2FA TOTP opsional), refresh opaque berotasi + deteksi pemakaian ulang (cabut sesi + `REFRESH_TOKEN_REUSED`), logout, daftar/cabut sesi, ganti kata sandi, setup/enable 2FA
- [x] `JwtAuthGuard` global (verifikasi access token, `@Public()`, cek Redis `session:revoked:<sid>`) + `PermissionGuard` global
- [x] Modul me: `GET/PATCH /me` (profil + roles + org/unit + homeRegion + `permissions[]`), `POST/DELETE /me/devices`, `GET /me/alert-topics`; resolusi wilayah PostGIS (`ST_Contains`) + sinkronisasi topik FCM (`{env}_city`, `{env}_kec_{kode}`, `{env}_staff_alerts`)
- [x] `/health` publik (dikecualikan dari guard)
- Status: SELESAI (1b) - smoke test end-to-end hijau (OTP/register/login warga, login staf tanpa & dengan 2FA, setup/enable 2FA, ganti sandi, refresh rotasi + reuse, logout + penolakan token pasca-logout, `/me` warga & staf, `homeRegion` + topik distrik, `/me/devices`, `/me/alert-topics`)
- Asumsi: A-010..A-013
- Catatan: `GET /health/ready` masih stub (`pending`) - menunggu probe DB/Redis/storage. CRUD referensi (regions/organizations/units/incident-types/settings + `/config/public`) dan `seed:base`/`seed:verify` BELUM dikerjakan (lanjutan 1c). Belum ada framework tes otomatis (`backend` `test` masih placeholder).

### 1c - BELUM DIKERJAKAN
- [ ] CRUD referensi: regions, organizations, units, incident-types, settings, `GET /config/public`
- [ ] Devices per REST §5.2 (bila ada endpoint berbeda dari `/me/devices`)
- [ ] `seed:base` + `seed:verify` (V1-V11)
