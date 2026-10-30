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
- Sisa 1c: CRUD administrasi `organizations`/`units`/`settings`/`staff` (REST §5.12) — milik jalur dashboard/administrasi (Dx6); baca role/permission sudah dibuat (lihat 1d).
- Status: SELESAI (1c sebagian) — gerbang Fase 1 **tertutup penuh 2026-10-28** (lihat "Status gerbang Fase 1" dan 1e)
- Asumsi: A-014, A-015, A-016, A-017, A-018
- Catatan: `seed:verify` lulus V1-V11 di DB dev (2026-10-26 dan 2026-10-27); seluruh pemeriksaan memakai query/layanan nyata, bukan nilai dipatok.
- Verifikasi akhir 2026-10-27: `typecheck`/`build`/`make lint` (0 warning, 0 error)/`make contract` (114 endpoint, 63 contoh REST) hijau; `make up` → `make verify` → `make reset-live` → `make verify` sukses; smoke test HTTP hijau: `/api/v1/health` 200, `/api/v1/health/ready` 200 (`db/redis/storage: ok`), `/config/public` (sampleMode=true, nomor contoh), `/regions/resolve` dalam/kota luar kota + 401 tanpa token, alur 2FA staf penuh (setup → rahasia `enc:v1` di DB → enable kode salah 401 / benar 204 → login challenge → `login/2fa` salah 401 / benar 200).
- Perbaikan pada verifikasi: `/health` & `/health/ready` kini ikut prefix `api/v1` sesuai kontrak (sebelumnya dikecualikan → 404 pada URL kontrak); `MINIO_USE_SSL` diparse eksplisit (`enableImplicitConversion` mengubah `'false'` menjadi `true` sehingga probe memakai HTTPS dan selalu gagal).

### 1d - Endpoint admin baca + penegakan `@RequirePermission` (2026-10-27)
- Konteks: 61 `x-permission` di kontrak semuanya milik endpoint yang BELUM dibuat; endpoint yang sudah ada (`/auth/*`, `/config/public`, `/incident-types`, `/regions*`, `/me*`, `/health*`) hanya mensyaratkan `auth` (kolom Izin `-`/`auth`), sehingga memasang `@RequirePermission` di sana = mengarang izin. Keputusan pemilik (2026-10-27): implementasikan dua endpoint admin baca yang sudah ada di kontrak dengan izin jelas agar penegakan teruji lewat HTTP.
- [x] `GET /roles` dan `GET /permissions` (kontrak `GETRoles`/`GETPermissions`, `x-permission: role.manage`, contoh `contracts/examples/rest/GETRoles.json` + `GETPermissions.json`): `AdminController` di `PermissionsModule` dengan `@RequirePermission('role.manage')`; isi dibaca dari tabel `roles`/`permissions` (sumber penegakan), bukan katalog statis.
- [x] Uji e2e 403: dispatcher & responder → `403 FORBIDDEN` (amplop galat + `requestId`), tanpa token → `401`, super admin → `200` berisi 7 role dan 38 kode izin (== katalog). Diverifikasi juga langsung pada server berjalan.
- Status: SELESAI (1d) — penegakan `@RequirePermission` pada endpoint lain menyusul bersama pembuatan endpointnya (Dx6 CRUD administrasi, incidents/dispatch/alerts/shifts).

### 1e - Keputusan C0 + penerapan CC-003..CC-006 (2026-10-28)

**Keputusan pemilik (rekaman: `DECISIONS.md` bagian 0-1; `QUESTIONS.md` semua terjawab):**
- **C0 disetujui**: `openapi.yaml` (114 endpoint) + `asyncapi.yaml` (42 pesan) + contoh; struktur repo & nama `make` (D-007) ditetapkan; CC-001/002/007 DIKONFIRMASI; CC-003..006 disetujui penerapannya.
- `Q-001`..`Q-005` → **D-008** (GitHub Actions + Docker + GHCR), **D-010** (GitHub `jiprakoso/emergency-platform`), **D-011** (Linux), **D-012** (push langsung ke `main` setelah gerbang hijau).
- **A-018 → D-013**: pertahankan nama env implementasi (`DB_*`/`REDIS_*`/`NODE_ENV`); handoff §5.2 dilabeli default yang diganti.

**Diterapkan ke kontrak + dokumen + contoh (semua `approved — diterapkan`):**
- **CC-003**: `RegionLevel` → `[CITY, DISTRICT, VILLAGE]` (== `CHECK` migrasi + ERD §3; `PROVINCE` dibuang); contoh `GETRegions.json` kini memuat baris `CITY` (Kota Contoh).
- **CC-004**: `OrganizationType` → 9 nilai `CHECK` DB (`COMMAND_CENTER, POLICE, FIRE, HOSPITAL, BPBD, AMBULANCE_SERVICE, PRIVATE_FIRE, DISHUB, OTHER`); `AMBULANCE` → `AMBULANCE_SERVICE` di kontrak + 20 berkas contoh rest/ws; `GETOrganizations.json` kini memuat org `COMMAND_CENTER`.
- **CC-006**: **13 komponen view baru** (`AlertView`, `NotificationView`, `IncidentEventView`, `SyncEventView`, `IncidentTypeView`, `RoleView`, `RoleDetailView`, `SystemSettingsView` (19 kunci seed §8), `ActorRef`, `ShiftView`, `ShiftHandoverView`, `ConditionReportView`, `SessionView`) + **13 respons GET ditegakkan** (`/alerts`, `/alerts/{id}`, `/admin/alerts`, `/notifications`, `/incidents/{id}/events`, `/sync/events`, `/incident-types`, `/roles`, `/settings`, `/shifts/current`, `/shifts/handover`, `/condition-reports`, `/auth/sessions`). Field diturunkan dari contoh JSON yang sudah ada + ERD (tanpa mengarang).
- **CC-005**: **45 operasi mutasi 200/201 kini mengembalikan entitas ter-update** (view sesuai audiens: `DispatcherViewIncident` untuk aksi incident; `OfferView` pra-accept / `UnitView` pasca-accept untuk aksi dispatch; `AlertView`, `ShiftView`, `ResourceRequestView`, `OrganizationView`, `UnitAdminView`, `StaffView`, `UserAdminView`, `RoleDetailView`, `SettingEntryView`, `AttachmentView`, `CitizenReportView`, `IncidentLockView`, `CasualtyRecordView`, `IncidentEventView` untuk sisanya). **10 operasi 204 tetap tanpa isi** (ack/hapus) dan kini didokumentasikan eksplisit di dokumen REST **§1.7** beserta kewajiban refetch. Total skema komponen: 48 → **70**.

**Daftar contoh berubah (untuk quicktype, D-002 — bangun ulang model yang terdampak):**
- **45 contoh BARU** (satu per operasi mutasi): `PATCHIncidentsId`, `POSTIncidentsId{Verify,Invalidate,Merge,Resolve,Close,Lock,LockRenew,Notes,Casualties,Milestones,ResourceRequests,DispatchesOnBehalf,SelfInitiate}`, `PUTIncidentsIdLead`, `POSTDispatchesId{Seen,Reject,Status,Destination,Cancel}`, `POSTResourceRequestsId{Approve,Reject}`, `PUTUnitsId{Status,Location}`, `PATCHUnitsId`, `POST/PATCH/AdminAlerts*`, `POSTShifts{Start,End}`, `POST/PATCHOrganizations*`, `PUTOrganizationsIdServiceAreas`, `POSTOrganizationsId{Units,Staff}`, `PATCHStaffUserId`, `POSTStaffUserId{Deactivate,ResetPassword}`, `PATCHUsersIdStatus`, `PUTUsersIdRoles`, `PUTRolesIdPermissions`, `PUTSettingsKey`, `POSTAttachmentsIdConfirm`, `POSTReportsIdWithdraw`.
- **21 contoh DIUBAH**: 8 rest (`GETIncidents`, `GETIncidentsId.dispatcherView`, `GETIncidentsIdNearby`, `GETIncidentsIdDispatchRecommendations`, `POSTIncidents`, `GETOrganizations` — AMBULANCE_SERVICE + COMMAND_CENTER; `GETRegions` — CITY; `GETIncidentsId.dispatcherView` juga AMBULANCE_SERVICE) + 13 ws (enum `AMBULANCE_SERVICE`).
- **13 contoh GET lama kini tervalidasi ketat** terhadap skema baru (tanpa perubahan isi): `GETAlerts`, `GETAlertsId`, `GETAdminAlerts`, `GETNotifications`, `GETIncidentsIdEvents`, `GETSyncEvents`, `GETIncidentTypes`, `GETRoles`, `GETSettings`, `GETShiftsCurrent`, `GETShiftsHandover`, `GETConditionReports`, `GETAuthSessions`.

**Verifikasi 2026-10-28**: `make contract` hijau (Spectral 0 error/warning kedua berkas, cakupan 114↔114 & 38+4 event, **108 contoh rest valid**), `make lint` 0/0, `typecheck`/`build` 0, `make test` 50 unit + 14 e2e, `make verify` V1-V11.

**Temuan baru (usulan, `proposed`, tidak memblokir)**: `CC-008` (notifications.kind `REPORT_UPDATE` vs CHECK DB), `CC-009` (severity `MASS` vs `CRITICAL`), `CC-010` (level/category alert bebas-konfigurasi vs enum/CHECK), `CC-011` (event_type ERD UPPERCASE vs contoh dot-lowercase), `CC-012` (`AttachmentRef.kind` `IMAGE..` vs CHECK `PHOTO..`). Kontrak sementara memakai bentuk netral (`string`) untuk yang diperselisihkan.
- Status: SELESAI (1e) — **gerbang Fase 1 tertutup penuh**; titik tinjau berikutnya **C1 (setelah Fase 2)**.

## Sisa gerbang Fase 1 (semua TERTUTUP 2026-10-28)
- [x] **Tes otomatis** (2026-10-27): Jest + ts-jest + supertest terpasang; 7 berkas `*.spec.ts` (**50 tes** unit hermetic) + 2 berkas `*.e2e-spec.ts` (**14 tes** HTTP end-to-end terhadap DB/Redis nyata); `make test` = `pnpm test` (unit) + `pnpm test:e2e` — memenuhi gerbang "tes autentikasi (OTP, rotasi refresh, deteksi pemakaian ulang, 2FA)" dan "tes permission (matriks)" (rincian di "Tes otomatis").
- [x] Titik tinjau **C0 disetujui & tercatat di `DECISIONS.md`** (2026-10-28); `CC-003`..`CC-006` kini `approved — diterapkan`; `Q-001`..`Q-005` dijawab (D-008, D-010..D-012) — lihat 1e
- [x] Lingkungan: image MinIO resmi tak dapat ditarik (keterbatasan registry) — **diasingkan lokal** dengan menag ulang gambar `bitnamilegacy/minio` menjadi `minio/minio:latest` + `minio/mc:latest` (isi gambar sama, memuat `minio` dan `mc`) dan `chown` volume ke uid 1001; `make up` kini menjalankan MinIO dan `/health/ready` melaporkan `200` dengan `storage: "ok"`. Compose tetap menunjuk gambar resmi; di lingkungan dengan akses registry normal tidak diperlukan langkah ini.
- [x] Penamaan env: **diputuskan memakai nama env implementasi** (D-013, 2026-10-28); A-018 diperbarui, handoff §5.2 dilabeli default yang diganti
- [x] **Catatan keamanan (diperbaiki 2026-10-27)**: mencabut sesi kini juga mematikan access token yang sudah terbit. `SessionService.revokeSession` menulis penyangga Redis `session:revoked:<sid>` (TTL 24 jam) yang dibaca `JwtAuthGuard`; kunci itu sebelumnya hanya ditulis `AuthService.logout`/`revokeSession`, sehingga deteksi pemakaian ulang (dan cabut sesi lewat rotasi kedaluwarsa) membiarkan access token hidup ≤15 menit. Diverifikasi ujung-ke-ujung: setelah pemakaian ulang, `GET /me` memakai token lama membalas 401 "Sesi sudah dicabut."
- [x] `make lint` bersih: 0 warning, 0 error (2026-10-27; diulang 2026-10-28)

## Status gerbang Fase 1 & titik tinjau berikutnya (diperiksa 2026-10-28)

**Cakupan gerbang Fase 1 (handoff §6.1) vs bukti:**

| Syarat gerbang | Bukti | Status |
|---|---|---|
| V1-V11 | `make verify` diulang 2026-10-28: seluruh V1-V11 OK (infra dev sempat berhenti sendiri 41 menit — dijalankan ulang dengan `make up`, migrasi 0, seed idempoten) | LULUS |
| Tes autentikasi (OTP, rotasi refresh, deteksi pemakaian ulang, 2FA) | `auth.e2e-spec.ts` (5 tes HTTP) + `auth.service.spec.ts`/`session.service.spec.ts`/`otp.service.spec.ts` | LULUS |
| Tes permission (matriks) | `permission.e2e-spec.ts` (8 tes, termasuk 403/200 `@RequirePermission` via HTTP) + `permissions.catalog.spec.ts`/`permission.service.spec.ts`/`permission.guard.spec.ts` | LULUS |
| `/config/public` benar | V7 (sampleMode=true, nomor contoh, tanpa nomor asli) + e2e | LULUS |
| Kelengkapan umum §7.1 | `make lint` 0/0, `make contract` OK (114 endpoint, 38+4 event, **108 contoh REST**), `typecheck`/`build` 0, `make test` = **50 unit + 14 e2e** — semua diulang 2026-10-28 | LULUS |

- **Gerbang Fase 1: LULUS — dan seluruh item non-teknisnya diselesaikan 2026-10-28** (rekaman C0, `Q-001`..`Q-005`, `CC-003`..`CC-006`, A-018 — lihat 1e). Tidak ada pekerjaan tersisa untuk gerbang ini.
- **Titik tinjau formal berikutnya: C1 (setelah Fase 2)** — perilaku API laporan/incident, view per audiens (handoff §13.2).
- Usulan baru menunggu keputusan pemilik di titik tinjau berikutnya: `CC-008`..`CC-012` (temuan kontrak-vs-DB saat penerapan; tidak memblokir Fase 2 karena kontrak memakai bentuk netral sementara).

## Tes otomatis (Jest) — 2026-10-27
- Infrastruktur: `jest` + `ts-jest` + `@types/jest` + `supertest` (dev dependency), `backend/jest.config.js` (unit), `backend/test/jest-e2e.js` (e2e), `tsconfig.spec.json`, `make test` → `pnpm test` + `pnpm test:e2e`; `src/testing/` dan `test/` dikeluarkan dari build (`tsconfig.build.json`).
- Strategi unit: **hermetic** (tanpa Postgres/Redis sungguhan) — lapisan persistensi di-*fake* di `src/testing/fakes.ts` (repository in-memory dengan pencocokan `where`, query-builder mini, Redis in-memory), sedangkan layanan yang diuji tetap nyata (Argon2, TOTP, JWT, hash SHA-256, logika rotasi & matriks).
- Paket ESM di node_modules: `@scure/base`/`@noble`/`@otplib` ditransformasi ts-jest; `@nestjs/terminus` dipetakan ke stub (`moduleNameMapper`) karena tidak terpakai pada jalur yang diuji.
- Cakupan (7 suite, 50 tes):
  - `permissions.catalog.spec.ts` — integritas matriks: 38 izin unik, 7 role ber-nama, tanpa duplikat, seluruh izin terdistribusi, jumlah izin per role, SUPERVISOR ⊇ DISPATCHER, batasan kerahasiaan (CITIZEN/RESPONDER tanpa `pii.reveal_reporter`/`incident.read_all`), `role.manage`/`settings.manage` hanya SUPER_ADMIN.
  - `permission.service.spec.ts` — peran pengguna, gabungan izin lintas role, cache Redis (hit tidak menyentuh DB), `hasPermission`/`hasAnyPermission`, `invalidate`.
  - `permission.guard.spec.ts` — lewat tanpa `@RequirePermission`, 401 tanpa pengguna, 403 saat izin kurang, pemanggilan `hasAnyPermission` dengan daftar izin yang benar.
  - `otp.service.spec.ts` — kode disimpan sebagai hash (tidak plaintext), verifikasi benar/salah, tujuan berbeda ditolak, kedaluwarsa, batas 5 percobaan, kode terpakai tidak bisa dipakai ulang.
  - `session.service.spec.ts` — hash disimpan, rotasi (hash baru + tanda hash lama), deteksi pemakaian ulang → `REFRESH_TOKEN_REUSED` + sesi dicabut + penyangga `session:revoked:<sid>`, token tak dikenal/kedaluwarsa, logout mencabut sesi + token perangkat + penyangga, daftar sesi aktif.
  - `jwt-auth.guard.spec.ts` — principal diisi dari access token sah, token sesi yang dicabut di Redis ditolak 401, rute publik tanpa token dilewati, tanpa token/token rusak pada rute terproteksi → 401.
  - **e2e HTTP (supertest)** — `test/auth.e2e-spec.ts`: kredensial salah → amplop galat 401, login staf + token berlaku di `/me`, rotasi refresh → pemakaian ulang `REFRESH_TOKEN_REUSED` + access token lama mati + rantai refresh mati, alur 2FA penuh (setup → enable kode salah/benar → challenge → `login/2fa`), OTP warga (permintaan 202, daftar 201, kode terpakai 401, login OTP benar/salah). `test/permission.e2e-spec.ts`: matriks `/me` per role persis == katalog (dispatcher, responder, super admin), token akses tanpa `permissions`, responder tanpa `incident.read_all`/`pii.reveal_reporter`/`settings.manage`, warga tanpa daftar permission, endpoint terproteksi 401 tanpa token vs `/config/public` terbuka (sampleMode + nomor contoh), token rusak 401. `GET /roles` & `GET /permissions`: 401 tanpa token, **403 `FORBIDDEN`** untuk dispatcher/responder (tanpa `role.manage`), 200 untuk super admin dengan isi == katalog (7 role, 38 kode izin).
  - `auth.service.spec.ts` — login staf (token tanpa `permissions` di payload), kata sandi salah, akun ditangguhkan, 2FA: setup tersimpan terenkripsi `enc:v1.`, enable kode salah/benar, challenge vs token, `login/2fa` (kode benar/salah, challenge rusak, rahasia hilang), rotasi refresh + pemakaian ulang mematikan rantai refresh dan menulis penyangga cabut sesi.
- Keterbatasan: cakupan e2e baru dua berkas (autentikasi + permission); endpoint lain (reports/incidents/dispatch/attachments/shifts) belum punya uji e2e, dan uji 403 lewat HTTP baru mencakup `GET /roles`/`GET /permissions` karena hanya dua endpoint terpasang `@RequirePermission`.
- Hasil: `pnpm test` 50/50 dan `pnpm test:e2e` 14/14 hijau; `make test` = keduanya; `make lint`, `typecheck`, `build` tetap hijau (2026-10-27, diulang 2026-10-28).

## Fase 2 - Laporan & Insiden
### 2a - Reports, Incidents, locking & lifecycle (completed 2026-10-29)
- [x] Modul `attachments`, `reports`, `incidents` ditambahkan dan didaftarkan di `AppModule` (branch `fase-2-reports-incidents`).
- [x] **Reports**: `POST /reports` (idempoten via `clientReportId`, 201/200), `GET /reports/mine`, `GET /reports/{id}`, `GET /reports/{id}/timeline` (hanya `visibility: PUBLIC`), `POST /reports/{id}/follow-ups`, `POST /reports/{id}/withdraw`, `POST /reports/{id}/reveal-contact` — seluruh endpoint ada dan terdaftar.
- [x] **Incidents**: `GET /incidents`, `GET /incidents/{id}` ada dengan percabangan dispatcher/supervisor vs responder (tapi bentuk respons belum sesuai kontrak — lihat koreksi di bawah).
- [x] **Locking**: `POST /incidents/{id}/lock`, `DELETE /incidents/{id}/lock` (204), `POST /incidents/{id}/lock/renew`. Atomik dengan `version`, `force` + `incident.lock_override`, lock kedaluwarsa bisa diambil kembali. (terverifikasi benar saat review)
- [x] **Lifecycle**: `POST /incidents/{id}/verify`, `POST /incidents/{id}/invalidate`, `POST /incidents/{id}/merge`, `PUT /incidents/{id}/lead`, `POST /incidents/{id}/resolve`, `POST /incidents/{id}/close` — transisi dicek status per-method, ditulis ke `incident_events` + `outbox_events` dalam 1 transaksi, `version` + `VERSION_CONFLICT`.
- [x] **Update & tracking**: `PATCH /incidents/{id}` (wajib kunci + `version`), `GET /incidents/{id}/events`, `GET /incidents/{id}/reports` (kontak pelapor dimask), `POST /incidents/{id}/notes`, `POST /incidents/{id}/milestones`.
- [x] **Nearby**: `GET /incidents/{id}/nearby` memakai PostGIS `ST_Distance` + filter `radiusM`/`hours` (`radiusM` sebelumnya diterima tapi diabaikan — diperbaiki 2026-10-29).

**Koreksi klaim 2a (review ulang 2026-10-30 — koreksi 2026-10-29 TIDAK akurat terhadap kode; sebagian besar klaim [X] di bawah dibatalkan, lihat penanda):**

Kode diperiksa baris-per-baris + verifikasi ulang (unit 50/50, e2e 14/14, `make verify` V1–V11, `make lint`, `typecheck`) pada 2026-10-30. Hasil:

- [X] **Terbukti benar**: `GET /incidents/{id}` menghitung `publicStatus` via `resolvePublicStatus` dan memakai join tabel untuk `type`/`district`/`village`; lifecycle (verify/invalidate/merge/lead/resolve/close) menulis `incident_events` + `outbox_events` dalam 1 transaksi dengan `version` + `VERSION_CONFLICT`; locking atomik (`WHERE version = :v` + guard kedaluwarsa + `force` dengan `incident.lock_override`); `nearby` memakai `radiusM`/`hours` di SQL PostGIS; `POST /incidents/{id}/casualties` menulis entity `IncidentCasualty` (injured/deceased/critical/missing + catatan) dan mengembalikan id data sebenarnya; idempotensi `POST /reports` via `clientReportId` (UNIQUE di DB); timeline laporan hanya `visibility: PUBLIC`.
- [ ] **Bentuk respons BELUM sesuai kontrak**: `attachments: []` hardcode; `reporter: { name: null, phoneMasked: null }` hardcode di semua cabang (padahal `ReporterMasked` = `{name, phoneMasked}` — `maskPhone()` di `incident-views.ts` tidak pernah dipanggil); `dispatchSummary`/`attentionReasons[]` **tidak pernah** dikembalikan ke klien — agregatnya dihitung lalu dibuang; serializer bersama (`toDispatcherView`/`toResponderView`/`toIncidentSummary`/`toAttachmentRef`/`toEventView` di `incident-views.ts`, AGENTS.md #5) **belum dipakai** oleh `incidents.service.ts`.
- [ ] **`GET /incidents` TANPA FILTER**: tidak ada `status`/`typeCode`/`severity`/`districtId`/`leadOrgId`/`lockedBy`/`flag`/`from`/`to`/`q`/cursor/sort — `find({ take: 25 })`, `hasMore: false` dipatok.
- [ ] **`GET /incidents/{id}/reports` TIDAK menyaring pemilik laporan**: filter `r.reporter.name !== null` tidak pernah benar (nama selalu `null`); `reporterUserId` tidak dibaca/dibandingkan.
- [ ] **Visibilitas events menyimpang**: responder di-filter `visibility !== 'PUBLIC'` (menerima semua kecuali publik), bukan "hanya `INTERNAL`" sebagaimana klaim; konvensi `toEventView` (INTERNAL tidak dikirim) belum dipakai.
- [ ] **`POST /reports/{id}/reveal-contact` TANPA IZIN/AUDIT**: tidak ada `@RequirePermission('pii.reveal_reporter')`, **tidak menulis audit log** (komentar kode: "Hanya contoh - sesungguhnya butuh izin dan audit"). Umum: **tidak ada satu pun penulisan ke `audit_logs` di `src/modules`** (entitas ada, tak terpakai) — melanggar AGENTS.md #7 dan dokumen REST §2/§5 (reveal-contact wajib tercatat di audit).
- [ ] **`dispatch-recommendations` memakai ID karangan**: `'fire-dept-example'`/`'ambulance-example'`/`'police-example'` dan `alreadyDispatched: false` dipatok — melanggar AGENTS.md #1 (jangan mengarang); harus dari DB (seed) + jumlah dispatch nyata.
- [ ] **Mesin status belum dipakai** (koreksi 2026-10-30 sesi C1): tabel `INCIDENT_TRANSITIONS` ada di `status-engine.ts`, tetapi `assertTransition`/`canTransition` tidak dipanggil di mana pun; tiap method memakai `if` sendiri. `invalidate` menolak `VERIFIED` (tabel §6.1 mengizinkan); `merge` **tidak** mengecek status sumber, keberadaan target, dan tidak memindahkan laporan.
- [ ] **Logika kunci sebagian** (koreksi 2026-10-30 sesi C1): verify/invalidate/merge/patch wajib kunci — benar. Tetapi `setLead` tanpa cek status/kunci/`version`; `resolve`/`close` tanpa cek kunci; `unlock`/`renew` tidak atomik dan `renew` menerima kunci kedaluwarsa; `version` di body opsional sehingga optimistic locking bisa dilewati.
- [ ] **Tes Fase 2 belum ada** (koreksi 2026-10-30 sesi C1): 7 suite unit + 2 e2e yang ada seluruhnya milik Fase 1 (auth/permission); reports/incidents/attachments tanpa tes — mulai ditutup di 2b.
- Perbaikan 2026-10-30 (lint & tooling): 9 eror `pnpm lint` dibersihkan (impor/var tak terpakai, filter no-op) → `make lint` 0/0 kembali hijau; berkas WIP `backend/src/sim/` **dihapus** (menulis dispatch langsung ke repository DB — melanggar AGENTS.md #4 REST-satunya-jalur-tulis; status `'offered'/'accept'` lowercase tidak sesuai kontrak; bukan rencana Fase 3) — sim:bot akan dibangun di Fase 3 lewat API sesuai `seed-demo-aplikasi-darurat.md`; edit `Makefile` yang merusak target `demo-bots` dikembalikan ke stub HEAD; `check-coverage.py` diperkuat sehingga rujukan silang di sel deskripsi tidak dihitung sebagai path (CC-013) → `make contract` hijau.
- Status: **DALAM GERBANG (2a belum selesai)** — **C1 menunggu keputusan pemilik** (lihat `docs/QUESTIONS.md` Q-006). Tidak lanjut ke Fase 3 sampai C1 disetujui dan item [ ] tertutup.
- Penyimpangan: klaim "SELESAI (2a)" pada merge PR #1 (2026-10-29) ditarik setelah review kode + verifikasi lint/e2e; koreksi dicatat 2026-10-29.
- Catatan yang terbukti benar: event ditulis via outbox dalam transaksi setelah commit; locking atomik dengan `version`; timeline laporan hanya menampilkan `visibility: PUBLIC`.
- Perbaikan gerbang 2026-10-29 (`9054a59`): `make lint` 71 masalah → 0/0; impor `uuid` (ESM-only) diganti `node:crypto` sehingga suite e2e kembali jalan (14/14); `DatabaseModule` memakai daftar entitas eksplisit (dulu `autoLoadEntities` membuat metadata TypeORM gagal pada relasi `IncidentEvent#dispatch` dan e2e hang saat retry); `nearby` kini memakai `radiusM`; tipe `AttachmentKind` diselaraskan dengan `CHECK` hasil CC-012.

### 2b - Penutupan gerbang C1, langkah 1: keamanan/PII + audit (2026-10-30)

Rencana penutupan C1 (urutan): **(1) keamanan/PII + audit + S7** → (2) idempotensi S5 → (3) mesin status & kunci → (4) view per audiens → (5) kelengkapan fitur. Rincian per butir: lihat temuan uji langsung sesi ini di bawah.

**Temuan uji langsung (server lokal + seed, sebelum perbaikan):** warga lain `GET /reports/{id}` & `/timeline` → 200 (harus 404); warga `reveal-contact` → 201 tanpa audit; warga `GET /incidents`, `/incidents/{id}`, `/nearby` → 200; responder tanpa relasi melihat incident; `audit_logs` 0 baris; S5 paralel (3× `clientReportId` sama bersamaan) → 500/201/500; warga lain dengan `clientReportId` sama menerima laporan orang lain (200); catatan/merge ke incident tak ada → 500; respons verify/merge = entitas mentah; `verify` tanpa lead otomatis; semua POST incident 201 (kontrak 200).

**Selesai di langkah 1:**
- [x] Modul `audit` baru (`AuditService.record` — satu-satunya penulis `audit_logs`, INSERT saja, ikut transaksi pemanggil; `maskAuditData` meredaksi PII/lokasi/teks bebas di `before/after`; `@AuditCtx()` mengisi IP, user-agent, `requestId`).
- [x] Audit wajib REST §9 untuk Fase 2: `pii.view_reporter` (reveal-contact), `incident.lock_override` (lock `force` atas kunci aktif orang lain), `incident.set_lead`, `incident.invalidate`, `incident.merge` — semuanya dalam transaksi yang sama dengan perubahan data.
- [x] Reports: `@RequirePermission` sesuai REST §5.4 di semua endpoint; `GET /reports/{id}`, `/timeline`, `/withdraw`, `/follow-ups` hanya milik sendiri (lainnya **404**); `reveal-contact` wajib `pii.reveal_reporter`, 200, nama/nomor dari laporan atau akun pelapor.
- [x] Incidents: `GET /incidents` & `/nearby` wajib `incident.read_all`; `GET /incidents/{id}` wajib `incident.read_all` atau `incident.read_related` + relasi (dispatch untuk unit/organisasinya atau organisasinya lead), tanpa relasi **404**; responder pra-accept tidak menerima korban dan dispatch lain (lokasi/alamat/lampiran/pelapor memang tidak dikirim); cek nama role dihapus — penegakan hanya lewat permission.
- [x] Catatan: `visibility` hanya `INTERNAL|LEAD|UNITS` (PUBLIC → 400); incident tak ada → 404. Milestone: incident tak ada → 404; responder tak terkait → 404, terkait non-lead → `403 NOT_LEAD_ORGANIZATION`.
- [x] Attachments: `confirm` hanya pengunggah; `getUrl` pengunggah atau `incident.read_all` (lainnya 404). Akses responder pasca-accept menyusul bersama serializer view (langkah 4).
- [x] Kode sukses sesuai kontrak: `lock`, `lock/renew`, `verify`, `invalidate`, `merge`, `resolve`, `close`, `withdraw`, `reveal-contact`, `attachments/{id}/confirm` → 200.
- Tes: `src/modules/audit/audit.service.spec.ts` (3 unit) + `test/privacy.e2e-spec.ts` (23 e2e: S7 kepemilikan laporan, reveal-contact 403/200 + baris audit tanpa PII + `requestId`, 403 warga di endpoint incident, responder 404 / pra-accept tanpa data sensitif, dispatcher melihat lokasi, catatan PUBLIC ditolak, milestone lead, audit lock_override/invalidate/merge/set_lead, kepemilikan lampiran).
- Verifikasi 2026-10-30: `make lint` 0/0, `typecheck` 0, `make contract` OK, unit **53/53**, e2e **37/37**.
- Penyimpangan: tes kepemilikan lampiran memakai fixture DB karena `POST /attachments/uploads` selalu 500 (**CC-014**, Q-008). Relasi responder di tes memakai baris `dispatches` fixture (endpoint dispatch = Fase 3).
- Sisa S7: "akun responder dinonaktifkan → token ditolak, token FCM dicabut" belum ada — `JwtAuthGuard` tidak memeriksa status akun dan endpoint penonaktifan staf baru di Fase 5/Dx6. Diusulkan dikerjakan di langkah 3 (cek status akun di guard, dengan fixture DB).
- Sisa audit: `auth.refresh_reuse_detected` (REST §9, modul auth Fase 1) belum menulis `audit_logs` — tambahkan memakai `AuditService` di langkah berikutnya.
- Pertanyaan terbuka: **Q-008** (memblokir alur lampiran).
- Status: **langkah 1 selesai; C1 belum** — lanjut langkah 2 (S5).
