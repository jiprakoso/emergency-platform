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
- [x] `GET /health/ready` probe nyata: DB (`SELECT 1`), Redis (`PING`), object storage (`/minio/health/live`) → 200 bila siap, 503 bila ada dependensi bermasalah (kontrak `GETHealthReady`)
- Status: SELESAI (1a)

### 1b - Permission dan autentikasi
- [x] Modul permission: katalog 38 kode + matriks `ROLE_PERMISSIONS`, `PermissionService` (cache Redis 60s), `@RequirePermission`, `PermissionGuard`
- [x] Modul auth: OTP mock (`123456`), registrasi/login warga, login staf (kata sandi + 2FA TOTP opsional), refresh opaque berotasi + deteksi pemakaian ulang (cabut sesi + `REFRESH_TOKEN_REUSED`), logout, daftar/cabut sesi, ganti kata sandi, setup/enable 2FA
- [x] `JwtAuthGuard` global (verifikasi access token, `@Public()`, cek Redis `session:revoked:<sid>`) + `PermissionGuard` global
- [x] Modul me: `GET/PATCH /me` (profil + roles + org/unit + homeRegion + `permissions[]`), `POST/DELETE /me/devices`, `GET /me/alert-topics`; resolusi wilayah PostGIS (`ST_Contains`) + sinkronisasi topik FCM (`{env}_city`, `{env}_kec_{kode}`, `{env}_staff_alerts`)
- [x] `/health` publik (dikecualikan dari guard)
- [x] Boot diperbaiki: `express` menjadi dependensi langsung (layout pnpm ketat) — `node dist/main.js` berjalan tanpa jalan pintas
- [x] Kata sandi memakai **Argon2id** (handoff §9.5, A-014); hash bcrypt lama tetap diverifikasi dan ditingkatkan saat `seed:base`
- [x] Rahasia TOTP **terenkripsi AES-256-GCM** dengan `TOTP_ENCRYPTION_KEY` (handoff §9.5, A-015)
- Status: SELESAI (1b) - smoke test end-to-end hijau (OTP/register/login warga, login staf tanpa & dengan 2FA, setup/enable 2FA, ganti sandi, refresh rotasi + reuse, logout + penolakan token pasca-logout, `/me` warga & staf, `homeRegion` + topik distrik, `/me/devices`, `/me/alert-topics`)
- Asumsi: A-010..A-013
- Catatan: CRUD administrasi (organizations/units/settings/staff/roles + `/config/public` tulis) masih lanjutan 1c. Tes otomatis (Jest) ditambahkan 2026-10-27 — lihat "Tes otomatis" di bawah.

### 1c - Data referensi, config publik, seed (sebagian selesai)
- [x] `GET /config/public`: kunci `system_settings` diselaraskan dengan seed §8 (`min_app_version`, `operating_hours`, `emergency_contacts`, `limits`, `disclaimer`, `sample_mode`) — sebelumnya semua pengaturan seed terlewat dan fallback memakai **nomor darurat asli**
- [x] Nomor darurat di respons = nomor contoh (`000-112`, dst.); `sampleMode` ditambahkan (CC-007, diputuskan pemilik 2026-10-26)
- [x] `operatingNow` memakai `ClockService` dan mendukung `mode: "24x7"`
- [x] `GET /regions` tanpa `boundary`/`centroid`, `page` `{nextCursor, hasMore, limit}` dengan kursor opaque
- [x] `GET /regions/resolve?lat=&lng=` (PostGIS `ST_Contains`) → `{inServiceArea, district, village}` (A-016)
- [x] `GET /regions/{id}` (tidak ada di kontrak/dokumen) **dihapus**
- [x] `seed:base` sesuai seed §3-§8: 10 wilayah + geometri (bbox/centroid), 7 organisasi + lokasi + wilayah layanan + `service_polygon`, 12 unit berposisi, 5 jenis kejadian + `suggested_resources`, 7 role + 38 permission dari katalog `ROLE_PERMISSIONS`, 21 staf + 4 warga (Argon2, OTP mock), 19 pengaturan; idempoten; normalisasi data luar-daftar (A-017)
- [x] `seed:verify` V1-V11 **nyata tanpa hardcode**: hitungan persis, geometri (`ST_IsValid`/`ST_Covers`/`ST_Overlaps`), lokasi di dalam kota, relasi (service area, profil staf, CC), matriks permission == katalog, login 21 staf, `/config/public` (sampleMode + tanpa nomor asli), topic FCM, rekomendasi `AMB-02`, idempotensi (base() dijalankan lagi), penjaga `ENV=prod`
- [x] `Makefile`: `make seed`, `make verify`, `make reset-live` terhubung ke skrip; `make up` kini menunggu postgres lalu menjalankan migrasi + `seed:base` (MinIO tetap best-effort — keterbatasan registry)
- Sisa 1c: CRUD administrasi `organizations`/`units`/`settings`/`staff`/`roles` (REST §5.12) — milik jalur dashboard/administrasi (Dx6)
- Status: SELESAI (1c sebagian) — gerbang Fase 1 **belum** ditutup (lihat "Sisa gerbang Fase 1")
- Asumsi: A-014, A-015, A-016, A-017, A-018
- Catatan: `seed:verify` lulus V1-V11 di DB dev (2026-10-26 dan 2026-10-27); seluruh pemeriksaan memakai query/layanan nyata, bukan nilai dipatok.
- Verifikasi akhir 2026-10-27: `typecheck`/`build`/`make lint` (0 warning, 0 error)/`make contract` (114 endpoint, 63 contoh REST) hijau; `make up` → `make verify` → `make reset-live` → `make verify` sukses; smoke test HTTP hijau: `/api/v1/health` 200, `/api/v1/health/ready` 200 (`db/redis/storage: ok`), `/config/public` (sampleMode=true, nomor contoh), `/regions/resolve` dalam/kota luar kota + 401 tanpa token, alur 2FA staf penuh (setup → rahasia `enc:v1` di DB → enable kode salah 401 / benar 204 → login challenge → `login/2fa` salah 401 / benar 200).
- Perbaikan pada verifikasi: `/health` & `/health/ready` kini ikut prefix `api/v1` sesuai kontrak (sebelumnya dikecualikan → 404 pada URL kontrak); `MINIO_USE_SSL` diparse eksplisit (`enableImplicitConversion` mengubah `'false'` menjadi `true` sehingga probe memakai HTTPS dan selalu gagal).

## Sisa gerbang Fase 1 (BELUM)
- [x] **Tes otomatis** (2026-10-27): Jest + ts-jest terpasang; 6 berkas `*.spec.ts`, **45 tes** hijau; `make test` = `pnpm test` — memenuhi gerbang "tes autentikasi (OTP, rotasi refresh, deteksi pemakaian ulang, 2FA)" dan "tes permission (matriks)" (rincian di "Tes otomatis").
- [ ] Titik tinjau **C0** belum tercatat disetujui di `DECISIONS.md`; `CC-003`..`CC-006` masih `proposed`, `Q-001`..`Q-005` belum dijawab
- [x] Lingkungan: image MinIO resmi tak dapat ditarik (keterbatasan registry) — **diasingkan lokal** dengan menag ulang gambar `bitnamilegacy/minio` menjadi `minio/minio:latest` + `minio/mc:latest` (isi gambar sama, memuat `minio` dan `mc`) dan `chown` volume ke uid 1001; `make up` kini menjalankan MinIO dan `/health/ready` melaporkan `200` dengan `storage: "ok"`. Compose tetap menunjuk gambar resmi; di lingkungan dengan akses registry normal tidak diperlukan langkah ini.
- [ ] Penamaan env masih berbeda dari handoff §5.2 (A-018) — perlu keputusan titik tinjau
- [ ] **Catatan keamanan (non-blokir)**: deteksi pemakaian ulang refresh hanya mencabut baris sesi di basis data; penyangga Redis `session:revoked:<sid>` tidak ditulis, sehingga access token yang sudah terbit tetap berlaku sampai kedaluwarsa (≤15 menit). Putuskan apakah cabut sesi juga harus menghapus token akses.
- [x] `make lint` bersih: 0 warning, 0 error (2026-10-27)

## Tes otomatis (Jest) — 2026-10-27
- Infrastruktur: `jest` + `ts-jest` + `@types/jest` (dev dependency), `backend/jest.config.js`, `tsconfig.spec.json`, `make test` → `pnpm test`; `src/testing/` dikeluarkan dari build (`tsconfig.build.json`).
- Strategi: **hermetic** (tanpa Postgres/Redis sungguhan) — lapisan persistensi di-*fake* di `src/testing/fakes.ts` (repository in-memory dengan pencocokan `where`, query-builder mini, Redis in-memory), sedangkan layanan yang diuji tetap nyata (Argon2, TOTP, JWT, hash SHA-256, logika rotasi & matriks).
- Paket ESM di node_modules: `@scure/base`/`@noble`/`@otplib` ditransformasi ts-jest; `@nestjs/terminus` dipetakan ke stub (`moduleNameMapper`) karena tidak terpakai pada jalur yang diuji.
- Cakupan (6 suite, 45 tes):
  - `permissions.catalog.spec.ts` — integritas matriks: 38 izin unik, 7 role ber-nama, tanpa duplikat, seluruh izin terdistribusi, jumlah izin per role, SUPERVISOR ⊇ DISPATCHER, batasan kerahasiaan (CITIZEN/RESPONDER tanpa `pii.reveal_reporter`/`incident.read_all`), `role.manage`/`settings.manage` hanya SUPER_ADMIN.
  - `permission.service.spec.ts` — peran pengguna, gabungan izin lintas role, cache Redis (hit tidak menyentuh DB), `hasPermission`/`hasAnyPermission`, `invalidate`.
  - `permission.guard.spec.ts` — lewat tanpa `@RequirePermission`, 401 tanpa pengguna, 403 saat izin kurang, pemanggilan `hasAnyPermission` dengan daftar izin yang benar.
  - `otp.service.spec.ts` — kode disimpan sebagai hash (tidak plaintext), verifikasi benar/salah, tujuan berbeda ditolak, kedaluwarsa, batas 5 percobaan, kode terpakai tidak bisa dipakai ulang.
  - `session.service.spec.ts` — hash disimpan, rotasi (hash baru + tanda hash lama), deteksi pemakaian ulang → `REFRESH_TOKEN_REUSED` + sesi dicabut, token tak dikenal/kedaluwarsa, logout mencabut sesi + token perangkat, daftar sesi aktif.
  - `auth.service.spec.ts` — login staf (token tanpa `permissions` di payload), kata sandi salah, akun ditangguhkan, 2FA: setup tersimpan terenkripsi `enc:v1.`, enable kode salah/benar, challenge vs token, `login/2fa` (kode benar/salah, challenge rusak, rahasia hilang), rotasi refresh + pemakaian ulang mematikan rantai refresh.
- Keterbatasan: cakupan setara-layanan (unit), bukan uji HTTP end-to-end; uji integrasi dengan DB/Redis sungguhan belum ada.
- Hasil: `make test` 45/45 hijau; `make lint`, `typecheck`, `build` tetap hijau (2026-10-27).
