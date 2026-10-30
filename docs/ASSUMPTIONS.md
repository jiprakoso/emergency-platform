# ASUMPTIONS.md

Daftar asumsi yang diambil agent ketika dokumen tidak eksplisit. Format: `A-001`, `A-002`, ...

## A-001: Lokasi berkas meta
- `DECISIONS.md` berada di `docs/DECISIONS.md` (sesuai struktur-direktori.md). 
- Berkas meta lain (`ASSUMPTIONS.md`, `CONTRACT_CHANGES.md`, `QUESTIONS.md`, `PROGRESS.md`) juga di `docs/`.

## A-002: Struktur direktori
Mengacu pada `docs/specs/struktur-direktori.md` v1. Folder kosong diberi `.gitkeep`.

## A-003: Environment development
Menggunakan `docker-compose.dev.yml` di `infra/` untuk Postgres+PostGIS, Redis, MinIO (sesuai deployment-dev). Backend/dashboard juga bisa dijalankan via compose.

## A-004: Bentuk berkas contoh JSON (full body)
Berkas `contracts/examples/rest/<opId>[.<variasi>].json` berisi **bentuk lengkap
respons sukses** (amplop `data` + `page`/field tambahan bila ada), bukan hanya isi
`data`. Alasan: aturan handoff §6.5 #4 mewajibkan contoh `page`, dan #8 meminta
validasi langsung terhadap skema respons. Konsekuensi: model quicktype dibangkitkan
dari bentuk ini (termasuk `data`/`page`) — pemilik dapat membangkitkan tipe per
lapisan bila perlu.

## A-005: Format peristiwa WS di contoh
Peristiwa s2c ditulis dengan **amplop event lengkap** (`eid/id/type/v/ts/.../data`),
sesuai `EventEnvelope`. Perintah c2s (`ack`, `auth.refresh`, `app.state`,
`unit.location`) ditulis sebagai **isi `data`** (yang dikirim klien).

## A-006: Nama berkas audiens WS
Token audiens = jenis room (`dispatcher`, `supervisor`, `org`, `unit`, `user`,
`region`, `incident`, `connection`; `*` → `all`). Placeholder id (`{id}`, dst.)
tidak dipakai di nama berkas. Event berkelas `DYNAMIC` diberi sufiks `.critical`
dan `.standard`.

## A-007: Kelas pengiriman event yang tidak disebut dokumen WS §7
Event `connection.*`, `system.notice`, `report.timeline_updated`, dan
`unit.location_updated` tidak disebut di tabel kelas §7. Diasumsikan: `connection.*`
= per-koneksi (tidak via FCM), `system.notice` = INFO, `report.timeline_updated` =
STANDARD, `unit.location_updated` = INFO. Menunggu konfirmasi pada titik tinjau C0.

## A-008: Kontak AsyncAPI
`info.contact` tanpa email (aturan lint `asyncapi-info-contact-properties`
dimatikan) karena belum ada email resmi proyek. Diperbarui saat info kontak tersedia.

## A-009: Field respons tak-tertiping
Untuk endpoint yang di kontrak bertipe `object` longgar (alerts, notifications,
events, incident-types, roles, settings, shifts, condition-reports, auth sessions),
contoh memakai field minimal yang disebut dokumen REST. Usulan pengetatan dicatat
di `CONTRACT_CHANGES.md` (CC-006).

## A-010: Format refresh token & TTL
Refresh token sampel berbentuk opak `r1.<base64url(32 byte acak)>` (bukan JWT),
disimpan sebagai hash; rotasi setiap `POST /auth/refresh`. TTL: warga 30 hari
(2592000 s), staf 12 jam (43200 s) — mengikuti REST §11 (nilai 🔶) selama belum
dikonfirmasi. Access token JWT 15 menit. Cookie HttpOnly ditunda ke Fase 7
(deployment); sampel mengembalikan token di body.

## A-011: 2FA opsional & kode OTP mock
`twoFactorEnabled` default `false` untuk staf; login mengembalikan challenge bila
aktif. Provider OTP sampel `mock` memakai kode tetap `123456` (nomor darurat sampel
bukan nomor asli). Perubahan ke penyedia SMS nyata di Fase 7.

## A-012: DeviceInfo tanpa `fcmToken`
`device.fcmToken` opsional pada login/register (dashboard web tidak punya token FCM).
Bila kosong, sesi tetap dibuat tanpa baris `device_tokens`. `POST /me/devices`
(registrasi token) tetap mewajibkan `fcmToken`.

## A-013: Pencabutan sesi & access token
`POST /auth/logout` dan `DELETE /auth/sessions/{id}` mencabut sesi dan menandai Redis
`session:revoked:<sid>` (TTL 24 jam); `JwtAuthGuard` menolak access token yang sesinya
sudah dicabut (bukan hanya menunggu kedaluwarsa). Event WS `session.revoked` menyusul
di Fase 4.

## A-014: Kata sandi Argon2id (+ jalur hash bcrypt lama)
Kata sandi memakai **Argon2id** (`argon2`, handoff §9.5) — diputuskan pemilik
2026-10-26. Hash bcrypt (`$2*`) dari iterasi seed awal tetap diverifikasi agar
akun demo lama tidak terkunci, dan ditingkatkan ke Argon2 saat `seed:base`
berikutnya. `bcryptjs` tetap dipertahankan hanya untuk jalur verifikasi lama.

## A-015: Enkripsi rahasia TOTP
Rahasia TOTP disimpan terenkripsi AES-256-GCM dengan kunci env
`TOTP_ENCRYPTION_KEY` (64 heksadesimal, base64 32 byte, atau frasa bebas yang
mendapat hash SHA-256) — handoff §9.5. Bentuk nilai tersimpan:
`enc:v1.<iv>.<tag>.<cipher>` (base64url). Nilai tanpa awalan dianggap plaintext
(data sebelum enkripsi) sehingga tidak perlu migrasi data. `TOTP_ENCRYPTION_KEY`
wajib diisi dan aplikasi gagal start bila kosong (`.env.example` berisi nilai
contoh dev).

## A-016: Arti `inServiceArea` pada `GET /regions/resolve`
`inServiceArea` = titik berada di dalam kelurahan (cakupan Kota Contoh), bukan
pengecekan per-organisasi. Bila kelurahan tidak ditemukan, `district`/`village`
bernilai `null` dan `inServiceArea: false`.

## A-017: `seed:base` menormalkan data dasar
`seed:base` mengisi **dan menormalkan** data dasar terhadap daftar seed §3-§8:
akun/unit/jenis kejadian di luar daftar dihapus **bila belum menjadi rujukan
data domain** (laporan, incident, dispatch, lampiran, audit, shift) dan dilewati
dengan peringatan bila sudah. Posisi serta status unit yang sudah ada tidak
ditimpa agar keadaan demo berjalan tidak terganggu. Normalisasi ini yang
memungkinkan V1 memeriksa jumlah persis.

## A-018: Nama variabel lingkungan backend
Implementasi memakai `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_NAME`,
`REDIS_HOST`/`REDIS_PORT`, `MINIO_*`, dan `NODE_ENV` — bukan `DATABASE_URL`,
`REDIS_URL`, dan `ENV` pada handoff §5.2. `SAMPLE_MODE` diwakili oleh
`system_settings.sample_mode` (dibaca oleh `/config/public`).
**Diputuskan pemilik 2026-10-28 (D-013 di `DECISIONS.md`): pertahankan nama env
implementasi**; handoff §5.2 dilabeli sebagai default yang diganti. Bukan
perubahan kontrak.

## A-019: Infrastruktur uji end-to-end (e2e)
Uji e2e (`pnpm test:e2e`, 2 berkas di `backend/test/`) memakai Postgres/Redis
nyata dengan keputusan berikut. (a) Basis data **terpisah**
`emergency_platform_test` disiapkan otomatis oleh `global-setup.ts` (buat DB →
migrasi → `seed:base`, semua idempoten) sehingga data dev tidak tersentuh dan
`make verify` tetap stabil; tanpa infra pesan galat menyarankan `make up`.
(b) Redis memakai milik dev, tetapi tes hanya memakai kunci miliknya (uuid/
nomor telepon unik tiap run); penghitung laju per-IP lokal (`rl:otp:ip:*`)
dibersihkan sebelum suite karena identitasnya tetap antar run — tanpa flush
seluruh Redis. (c) Suite dijalankan satu per satu (`maxWorkers: 1`) agar
penghitung laju dan sesi tidak saling mengganggu. (d) Efek samping tes
dibersihkan: 2FA akun `dispatcher2` dinonaktifkan kembali dan warga uji
dihapus setelah suite selesai.

## A-020: Batas laju laporan dari `system_settings`, tanpa pengetatan reputasi
- Konteks: REST §8 — `POST /reports` HELP_REQUEST 3 per 10 menit + 10 per hari, CONDITION_REPORT 10 per 10 menit; "pengguna dengan skor reputasi rendah dibatasi lebih ketat" tanpa angka.
- Asumsi: angka dibaca dari `system_settings.report_rate_limit` (seed §8) dengan aturan bawaan `RateLimitRules` sebagai cadangan. Pengetatan berdasarkan `reputationScore` **belum** diterapkan sampai angkanya ditetapkan. Jatah diambil hanya untuk laporan baru (setelah kunci advisory + cek duplikat); pengulangan `clientReportId` dan permintaan yang gagal tidak dihitung (jatah dikembalikan).
- Dampak bila salah: penyetelan angka cukup lewat pengaturan; aturan reputasi ditambahkan di `ReportsService.reportRules` tanpa mengubah pemanggil.

## A-021: Penurunan reputasi saat `invalidate`
- Konteks: REST §5.5 — `POST /incidents/{id}/invalidate` "menurunkan `reputationScore` pelapor", tanpa besaran.
- Asumsi: −1 per pelapor warga berbeda (`user_type = CITIZEN`) yang laporannya tertaut ke incident tersebut, di transaksi yang sama. Laporan input manual (tanpa akun) tidak berdampak.
- Dampak bila salah: ubah besaran di `IncidentsService.invalidate`; belum ada aturan yang membaca skor (pengetatan batas laju A-020 menunggu angka).

## A-022: `resolve` dengan `forceCloseDispatches`
- Konteks: REST §5.5 — `resolve` menolak dengan `409 ACTIVE_DISPATCHES_EXIST` bila masih ada dispatch aktif, kecuali `forceCloseDispatches = true`; cara menutupnya tidak dirinci.
- Asumsi: dispatch aktif ditutup hanya lewat transisi sah §6.2/§6.3 — `OFFERED/ACCEPTED/EN_ROUTE/NOTIFIED/READY/FULL → CANCELLED` (`cancel_reason` "Incident diselesaikan dispatcher"), `ON_SCENE/PATIENT_ARRIVED → DONE` (tidak ada jalur CANCELLED). Event/notifikasi per dispatch menyusul bersama modul dispatch (Fase 3).
- Dampak bila salah: pemetaan ada di satu konstanta `FORCE_CLOSE_TARGET`.

## A-023: Pemeriksaan status akun di setiap permintaan
- Konteks: syarat selesai §7.2 `auth` ("akun nonaktif langsung ditolak") dan S7.
- Asumsi: `JwtAuthGuard` membaca `users.status` (pencarian PK) di setiap permintaan terautentikasi, tanpa cache, agar berlaku seketika; akun `SUSPENDED`/`DEACTIVATED` → `403 ACCOUNT_DEACTIVATED` (kode yang sama dengan login). Untuk skala pilot dapat diganti penanda Redis yang ditulis saat penonaktifan (Fase 5) tanpa mengubah perilaku.

## A-024: View responder pada `GET /incidents/{id}`
- Konteks: kontrak `GET /incidents/{id}` → `DispatcherViewIncident | OfferView | UnitView`; `OfferView`/`UnitView` berpusat pada dispatch (`dispatchId` wajib). REST §4.1 tidak merinci organisasi lead tanpa dispatch, maupun dispatch NOTIFY.
- Asumsi: responder melihat incident lewat dispatch milik unit/organisasinya (prioritas: unitnya sendiri, lalu yang sudah diterima, lalu terbaru). Tanpa dispatch → 404, termasuk organisasi lead (aksi lead seperti milestone tetap lewat endpointnya). `UnitView` hanya untuk dispatch RESPOND yang sudah diterima (`accepted_at` atau status ACCEPTED/EN_ROUTE/ON_SCENE/DONE); dispatch NOTIFY (IGD) selalu `OfferView` — tanpa lokasi kejadian. `note` dispatch = `null` (kolom belum ada; Fase 3). `distanceM` dari `units.last_location` bila diketahui.

## A-025: `dispatchSummary`, `attentionReasons`, batas `nearby`
- Konteks: REST §5.5 hanya menyebut nama field dan contoh alasan.
- Asumsi: `active` = ACCEPTED/EN_ROUTE/ON_SCENE + NOTIFY yang belum final; `byOrganization` = organisasi dengan dispatch aktif. Alasan perhatian (hanya incident SUBMITTED/VERIFIED/IN_PROGRESS): `NEEDS_REPLACEMENT` = ada dispatch RESPOND REJECTED/EXPIRED tanpa dispatch RESPOND baru sesudahnya; `UNSEEN_OFFER` = OFFERED belum dilihat lewat `offer_unseen_seconds` (seed: 60 s, = W4); `PENDING_RESOURCE_REQUEST` = resource request PENDING; `SUGGESTED_DUPLICATE` = incident SUBMITTED yang laporannya punya `suggested_incident_id`. `nearby`: `radiusM` 1–10.000, `hours` 1–168, hanya incident aktif.

## A-026: Visibilitas event dan timeline warga
- Konteks: REST §5.4 timeline warga = event `PUBLIC`; ERD `visibility`; kosakata `event_type` masih CC-011.
- Asumsi: event `incident.created`, `incident.verified`, `incident.invalidated`, `incident.resolved` ditulis `PUBLIC`; timeline menampilkan teks baku §4.2 ("Laporan diterima.", "Laporan diverifikasi.", "Laporan tidak dapat ditindaklanjuti.", "Penanganan selesai.") tanpa aktor/payload. Catatan resolve/close disimpan sebagai `payload.resolutionNote` (tidak ditampilkan di event view). Milestone ditulis `UNITS` (koordinasi lapangan terlihat unit terkait). Responder terkait melihat event `UNITS`/`PUBLIC` (+`LEAD` bila organisasinya lead).
