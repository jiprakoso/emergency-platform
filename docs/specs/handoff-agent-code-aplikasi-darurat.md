# Dokumen Serah Terima untuk Agent Code v1

> Status: draft v1
> Tanggal: 5 Oktober 2026
> Tujuan: membekali agent code (dan manusia yang meninjau) agar dapat membangun **aplikasi sampel** dari seluruh spesifikasi yang sudah disusun, dengan urutan yang aman, kriteria selesai yang jelas, dan batasan yang tegas.
> Cakupan: sampel yang dapat didemokan (bukan produksi). Hal yang menunggu keputusan client memakai asumsi default dari dokumen sumber.
> Tanda 🔶 = perlu ditinjau.

---

## 1. Cara Memakai Dokumen Ini

1. Baca **`AGENTS.md`** (berkas konteks ringkas di akar repositori). Berkas itu merangkum aturan wajib dan menunjuk ke dokumen ini.
2. Kerjakan **per fase** (bagian 6). Jangan membangun semuanya sekaligus.
3. Tiap fase punya **gerbang** (skenario uji yang harus lulus). Fase berikutnya tidak dimulai sebelum gerbang lulus.
4. Setiap fase diakhiri `PROGRESS.md` dan, di titik tinjau (bagian 13), dihentikan menunggu persetujuan manusia.

---

## 2. Sumber Kebenaran dan Urutan Prioritas

| Urutan | Sumber | Isi | Kapan dipakai |
|---|---|---|---|
| 1 | `contracts/openapi.yaml`, `contracts/asyncapi.yaml` | Kontrak mesin-baca REST dan WebSocket | Setelah disetujui di Fase 0. Menjadi acuan utama |
| 2 | Dokumen spesifikasi di `docs/` | Rincian perilaku (lihat tabel di bawah) | Sebelum kontrak ada, dan untuk perilaku yang tidak tertangkap skema |
| 3 | `konsep-aplikasi-darurat.md` | Konsep, keputusan, alasan | Konteks dan alasan desain |

Bila dua sumber bertentangan: **berhenti, catat di `docs/CONTRACT_CHANGES.md`, dan minta keputusan manusia.** Jangan menyimpang diam-diam.

### 2.1 Peta dokumen

| Dokumen | Dipakai oleh | Isi utama |
|---|---|---|
| `konsep-aplikasi-darurat.md` | Semua | Keputusan, prinsip, alur bisnis, peran, langkah berikutnya |
| `erd-aplikasi-darurat.md` | Backend | Skema basis data (31 tabel + `outbox_events`), index, nilai status |
| `rest-api-aplikasi-darurat.md` | Backend, dashboard, mobile | Endpoint, permission, view per role, transisi status, error, rate limit, skenario S1-S8 |
| `websocket-aplikasi-darurat.md` | Backend, dashboard, mobile | Room, amplop event, katalog event, kebijakan pengiriman, skenario W1-W13 |
| `fcm-aplikasi-darurat.md` | Backend, mobile | Topic, jenis pesan, channel Android, siklus token, skenario F1-F15 |
| `flutter-aplikasi-darurat.md` | Mobile | GetX + MVC/services, struktur, outbox, skenario A1-A10 dan B1-B13 |
| `dashboard-aplikasi-darurat.md` | Dashboard | Vite + React, console, alur dispatcher, skenario D1-D20 |
| `seed-demo-aplikasi-darurat.md` | Backend, semua | Data seed, simulator, skrip demo, `seed:verify` V1-V14 |
| `deployment-aplikasi-darurat.md` | Infrastruktur/backend (Fase 7) | Topologi produksi, keamanan, cadangan dan DR, observabilitas, rilis, uji beban/kekacauan, go-live |

---

## 3. Aturan Kerja Agent

### 3.1 Wajib

| # | Aturan |
|---|---|
| 1 | **Jangan mengarang endpoint, field, event, atau status.** Bila dibutuhkan sesuatu yang tidak ada: catat usulan di `docs/CONTRACT_CHANGES.md`, perbarui kontrak dan dokumen sumber **bersama-sama**, tandai untuk tinjauan |
| 2 | **Asumsi dicatat.** Gunakan nilai default dari dokumen sumber (bagian "Asumsi Default"). Asumsi baru dicatat di `docs/ASSUMPTIONS.md` dengan id (`A-001`, ...) dan alasan. Bertanya hanya untuk hal yang benar-benar memblokir |
| 3 | **Irisan kecil.** Satu modul atau fitur per perubahan, beserta tes dan pembaruan dokumen |
| 4 | **Tes dulu untuk logika kritis:** mesin status, permission/kebijakan, serializer view, idempotensi, penguncian, balapan (race). Gunakan skenario S/W/F/A/B/D sebagai tes penerimaan |
| 5 | **REST adalah satu-satunya jalur tulis.** WebSocket hanya mengantar event. Klien → server hanya `ack`, `auth.refresh`, `app.state`, `unit.location` |
| 6 | **Satu tempat untuk visibilitas data.** Serializer view (CitizenView, OfferView, UnitView, DispatcherView) dipakai bersama oleh REST dan proyeksi WebSocket/FCM. Dilarang membuat aturan visibilitas terpisah |
| 7 | **Event dikirim setelah commit** (outbox). Tidak boleh emit di tengah transaksi |
| 8 | **Jangan pernah** mencatat token, kata sandi, OTP, nomor telepon pelapor, `description`, koordinat presisi, atau token FCM di log, pesan galat, payload push, atau `audit_logs.before/after` (mask) |
| 9 | Migrasi basis data hanya lewat berkas migrasi (tanpa `synchronize`). Status/tipe berupa `varchar` + `CHECK`, **bukan enum PostgreSQL** |
| 10 | Seed dan akun demo **menolak berjalan** bila `ENV=prod`. Nomor darurat sampel adalah nomor contoh |
| 11 | Rahasia tidak masuk repositori. Hanya `.env.example` |
| 12 | Berhenti di setiap titik tinjau (bagian 13) dan menunggu persetujuan manusia |

### 3.2 Gaya kerja

- Commit mengikuti *Conventional Commits* (`feat(dispatch): ...`, `fix(auth): ...`, `test(...)`, `docs(...)`).
- Perubahan yang menyentuh kontrak (REST/WS) selalu ikut memperbarui `contracts/*` dan dokumen sumber di commit yang sama.
- Tidak ada `TODO` tanpa nomor catatan di `PROGRESS.md`.
- Pesan galat ke pengguna dalam Bahasa Indonesia, `code` galat tetap bahasa Inggris dan stabil.

### 3.3 Template instruksi tugas (untuk manusia)

```
Konteks:   Kita membangun aplikasi sampel (lihat AGENTS.md).
Tugas:     <Fase / modul>, mis. "Fase 3: modul dispatch".
Acuan:     <dokumen + bagian>, mis. rest-api §5.6 dan §6.2/6.3, websocket §5.3.
Keluaran:  <kode, tes, migrasi, pembaruan kontrak, PROGRESS.md>.
Selesai bila: <gerbang fase + skenario>, mis. S1, S2, S6.
Batasan:   Jangan mengubah kontrak tanpa mencatat di CONTRACT_CHANGES.md.
```

---

## 4. Struktur Repositori (monorepo sederhana)

```
emergency-platform/
├── AGENTS.md                     # konteks ringkas untuk agent (wajib dibaca)
├── CLAUDE.md                     # menunjuk AGENTS.md (untuk Claude Code)
├── Makefile                      # target standar (bagian 5.3)
├── docs/
│   ├── spec/                     # 8 dokumen spesifikasi (salinan dari hasil perancangan)
│   ├── CONTRACT_CHANGES.md       # usulan/perubahan kontrak, menunggu keputusan
│   ├── ASSUMPTIONS.md            # asumsi yang diambil agent (A-001, ...)
│   ├── DECISIONS.md              # keputusan pemilik proyek (dijaga manusia, agent hanya membaca)
│   ├── QUESTIONS.md              # pertanyaan agent yang dikelompokkan (bagian 13.3)
│   └── PROGRESS.md               # laporan per fase
├── contracts/
│   ├── openapi.yaml              # REST (OpenAPI 3.1)
│   ├── asyncapi.yaml             # WebSocket (AsyncAPI 3)
│   ├── .spectral.yaml            # aturan lint kontrak
│   ├── examples/                 # contoh JSON (bahan quicktype untuk model Dart, bagian 6.5)
│   └── README.md
├── backend/                      # NestJS (TypeScript)
├── dashboard/                    # Vite + React (TypeScript)
├── mobile/                       # Flutter: flavor citizen dan staff
├── infra/
│   ├── docker-compose.yml        # lingkungan pengembangan
│   ├── env/                      # contoh .env per komponen
│   ├── nginx/                    # reverse proxy (dev/staging)
│   └── scripts/                  # skrip bantu (inisialisasi bucket, dsb.)
└── .github/ (atau CI setara)
```

Aturan:
- Dokumen spesifikasi disalin ke `docs/spec/` dengan nama yang sama. Perubahan dilakukan di salinan itu (dan tercatat di `CONTRACT_CHANGES.md` bila menyentuh kontrak).
- Setiap aplikasi (`backend`, `dashboard`, `mobile`) mandiri, dengan manajer paketnya sendiri. Tidak ada kode bersama lintas aplikasi selain **kontrak** (dan tipe yang dihasilkan darinya).

---

## 5. Lingkungan Pengembangan

### 5.1 Layanan (`infra/docker-compose.yml`)

| Layanan | Citra/komponen | Port dev (usulan) | Keterangan |
|---|---|---|---|
| `postgres` | PostgreSQL 15+ dengan PostGIS | 5432 | Ekstensi `postgis` diaktifkan lewat migrasi awal |
| `redis` | Redis 7 (atau Valkey) | 6379 | Adapter Socket.IO, BullMQ, idempotensi, rate limit, presence |
| `minio` | MinIO | 9000 (API), 9001 (konsol) | Bucket `attachments` dibuat oleh skrip inisialisasi |
| `backend` | NestJS | 3000 | REST `/api/v1`, WebSocket `/realtime`, dokumentasi `/docs` (non-prod) |
| `dashboard` | Vite dev server (atau Nginx untuk build) | 5173 | Mengakses API lewat proxy |
| `nginx` (opsional) | Reverse proxy | 8080 | Satu origin: `/` dashboard, `/api` dan `/realtime` ke backend |

Persyaratan: **`make up` dari klon bersih** menghasilkan lingkungan yang berjalan, termasuk migrasi dan `seed:base`.

### 5.2 Variabel lingkungan backend (`.env.example`)

| Kunci | Contoh/Arti |
|---|---|
| `ENV` | `dev` / `staging` / `prod` |
| `SAMPLE_MODE` | `true` pada sampel (lencana MODE SAMPEL, nomor darurat contoh) |
| `APP_TIMEZONE` | `Asia/Jakarta` |
| `DATABASE_URL` | Koneksi PostgreSQL |
| `REDIS_URL` | Koneksi Redis |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Object storage (MinIO di dev) |
| `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` | Penandatanganan token akses (15 menit) |
| `REFRESH_TTL_CITIZEN`, `REFRESH_TTL_STAFF` | 30 hari / 12 jam |
| `TOKEN_HASH_PEPPER`, `TOTP_ENCRYPTION_KEY` | Hash refresh token dan enkripsi rahasia 2FA |
| `OTP_PROVIDER` | `mock` (kode tetap `123456`) atau penyedia nyata |
| `NOTIFICATION_PROVIDER` | `mock` atau `fcm` |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS` | Hanya bila `fcm` |
| `CORS_ORIGINS` | Daftar origin yang diizinkan |
| `TWO_FACTOR_REQUIRED` | `false` pada sampel |
| `LOG_LEVEL` | `info` |

Konfigurasi divalidasi saat boot (skema), dan aplikasi **gagal start** bila ada yang hilang atau tidak valid.

### 5.3 Target `make` standar

| Target | Fungsi |
|---|---|
| `make up` / `make down` | Menjalankan/menghentikan seluruh lingkungan dev |
| `make migrate` | Menjalankan migrasi |
| `make seed` | `seed:base` (dan `seed:history` bila `HISTORY=1`) |
| `make reset-live` | `seed:reset-live` |
| `make verify` | `seed:verify` |
| `make test` | Seluruh tes (unit + integrasi) semua aplikasi |
| `make lint` | Lint dan pemeriksaan tipe |
| `make contract` | Lint kontrak + pemeriksaan kecocokan kontrak dengan dokumen dan implementasi |
| `make demo-bots` | Menjalankan `sim:bot` untuk unit tanpa ponsel |

Nama dapat disesuaikan, tetapi harus didokumentasikan di `AGENTS.md`.

---

## 6. Rencana Pembangunan

Ukuran relatif: **S** kecil, **M** sedang, **L** besar.

### 6.1 Jalur backend (berurutan)

| Fase | Ukuran | Tujuan | Cakupan | Dokumen acuan | Gerbang (harus lulus) |
|---|---|---|---|---|---|
| **0. Fondasi dan kontrak** | M | Repositori, lingkungan, dan kontrak mesin-baca | Struktur repo, Compose, CI-agnostik (target `make`), lint; migrasi dasar dari ERD; **`openapi.yaml` dan `asyncapi.yaml` dari dokumen** (bagian 6.4); **contoh JSON untuk quicktype** (bagian 6.5); mock server dari kontrak yang mengembalikan contoh tersebut | ERD, REST, WebSocket | `make up` sukses dari klon bersih; `make contract` hijau (semua endpoint dan event di dokumen ada di kontrak); migrasi naik-turun; **persetujuan manusia atas kontrak (C0)** |
| **1. Inti backend, identitas, data dasar** | L | Fondasi lintas modul dan data dasar | Modul umum (konfigurasi tervalidasi, log terstruktur, request-id, filter galat, amplop respons, validasi, idempotensi, paginasi kursor, rate limit, `ClockService`); autentikasi (OTP mock, login staf, 2FA, refresh berotasi, sesi, perangkat); kebijakan permission; wilayah, organisasi, unit, jenis kejadian, pengaturan, config publik; `seed:base` + `seed:verify` | REST §1-3, §5.1-5.2, §5.12; seed §3-8, §12; ERD | V1-V11; tes autentikasi (OTP, rotasi refresh, deteksi pemakaian ulang, 2FA); tes permission (matriks); `/config/public` benar |
| **2. Laporan dan incident** | L | Siklus hidup incident tanpa dispatch | Lampiran (presigned MinIO), laporan warga (idempoten, `CONDITION_REPORT`, flag `OUT_OF_AREA`, follow-up, withdraw), incident (antrean, kunci, verifikasi, invalid, merge, nearby, lead, resolve/close, catatan, korban, milestone), `incident_events`, serializer view, audit | REST §4, §5.3-5.5, §6.1; ERD | S5, S7 (bagian REST), tes mesin status incident, tes kunci/balapan, tes view (tanpa kebocoran), idempotensi laporan |
| **3. Dispatch dan unit** | L | Penugasan penuh | Dispatch (single, batch, atas nama, self-initiate, accept/reject/status/destination/cancel), NOTIFY IGD, resource request, unit (status/lokasi), rekomendasi (PostGIS), pewaktu offer (BullMQ + penyapu) | REST §5.6-5.8, §6.2-6.3; seed §4, §10.1 | **S1, S2, S3, S6**; tes balapan accept; tes lompat status; tes pewaktu dengan jam tiruan; `sim:bot` menyelesaikan dispatch lewat API |
| **4. Realtime dan notifikasi** | L | Event, push, sinkronisasi | Outbox + pengirim, gateway Socket.IO (handshake, room, proyeksi per audiens), katalog event, ack, `/sync/events` dan `/sync/snapshot`, modul notifikasi (`MockProvider`, `FcmProvider`), token dan topic, kebijakan pengiriman, eskalasi offer | WebSocket (seluruh), FCM (seluruh) | **W1-W13**, **F1-F15 (mode mock)**, `dispatch.offered` tidak membawa lokasi presisi (tes otomatis F9), pemulihan reconnect |
| **5. Alert, shift, ringkasan, admin** | M | Fitur pendukung | Alert (CRUD, terbit, tutup, topic/wilayah, uji), `/condition-reports`, shift dan serah terima, `/dashboard/summary`, admin lengkap (akun staf, role, pengaturan, audit), penyesuaian REST dari dashboard (`permissions[]`, `dispatchSummary`, `attentionReasons[]`) | REST §5.9-5.12, §16 dashboard | **S4**, W11, tes admin (batas Admin Org), audit membaca |
| **6. Simulator dan riwayat** | M | Pendukung demo | `sim:bot`, `sim:flood`, `sim:citizen`, `seed:history`, `seed:reset-live` | seed §9-10 | V12-V14; `sim:flood` menghasilkan laporan sesuai parameter tanpa melanggar batas laju |
| **7. Infrastruktur produksi (setelah sampel disetujui)** | L | Menjalankan sistem untuk pilot/produksi | Sesuai `deployment-aplikasi-darurat.md`: IaC (Ansible/Terraform), Compose produksi, pemisahan `ROLE=api\|worker`, graceful shutdown, health/readiness, metrik dan log terstruktur, rotasi kunci JWT (`kid`), cookie HttpOnly, penyedia SMS nyata, CI/CD dengan citra yang dipromosikan, pemantauan dan peringatan, pgBackRest + replikasi + DR, runbook | Deployment §4, §7-14 | Uji beban, uji kekacauan, **pemulihan dari cadangan**, dan **DR drill** lulus (Deployment §14). **Titik tinjau C5** |

### 6.2 Jalur dashboard (mulai setelah Fase 0; dapat memakai mock server dari kontrak)

| Tahap | Cakupan | Acuan | Gerbang |
|---|---|---|---|
| **Dx1** | Scaffolding, konfigurasi, klien API (Axios + interceptor), autentikasi (login, 2FA, refresh single-flight), penjaga izin, tata letak | Dashboard §1-4, §11 | D1, D17 |
| **Dx2** | Console **hanya baca**: snapshot, antrean (tab), kartu, detail (tab), peta | §5 | Antrean dan detail tampil dari data seed |
| **Dx3** | Aksi: kunci + heartbeat, verifikasi, composer dispatch, atas nama unit, gabung, selesai/tutup, input manual, resource request | §6 | D3, D4, D7, D9, D10, D11 |
| **Dx4** | Realtime: koneksi, event → cache, batcher, sinkronisasi, polling cadangan, **Perlu Perhatian**, suara dan alarm | §7 | D2, D5, D6, D8, D12, D13, D19, D20 |
| **Dx5** | Alert, peta laporan kondisi, shift dan serah terima, ringkasan | §8-9 | D15, D16 |
| **Dx6** | Administrasi (organisasi, unit, staf, role, pengaturan, audit) | §10 | D17 |
| **Dx7** | Pengerasan: aksesibilitas, performa banjir, E2E Playwright | §13, §15 | **D18**, seluruh D1-D20 |

### 6.3 Jalur mobile (mulai setelah Fase 0; dapat memakai mock server dari kontrak)

> Model Dart (`lib/models/**`) disiapkan **pemilik proyek** lewat quicktype dari `contracts/examples/`. Agent mengerjakan jalur mobile dengan model tersebut dan tidak menghasilkannya sendiri. Bila ada model yang belum tersedia, agent mencatatnya di `docs/QUESTIONS.md` dan melanjutkan bagian lain.

| Tahap | Cakupan | Acuan | Gerbang |
|---|---|---|---|
| **Mx1** | Proyek, flavor `citizen`/`staff`, bootstrap, konfigurasi, `ApiClient`, `SessionService`, penyimpanan, tema | Flutter §1-5, §7 | Aplikasi berjalan di kedua flavor, sesi dipulihkan |
| **Mx2** | Warga: autentikasi OTP, beranda, **nomor darurat offline/tanpa login**, config | §6, §8.2, §9.1 | A4 |
| **Mx3** | Warga: wizard laporan, lokasi, media, **outbox**, idempotensi | §6.8-6.9, §10.1, §11 | A1, A2, A3, A6, A7, A10 |
| **Mx4** | Warga: detail laporan, timeline, WebSocket, sinkronisasi, `ServerClock` | §6.3-6.5, §10.2 | A5 |
| **Mx5** | Push: FCM, channel, deep link, alert warga, izin notifikasi | §6.6-6.7, §10.3; FCM | A8, A9 |
| **Mx6** | Staf: autentikasi, penugasan, **offer** (hitung mundur jam server, alarm, terima/tolak), status | §10.4 | B1, B2, B3, B4, B5, B13 |
| **Mx7** | Staf: detail incident, korban, milestone (lead), resource request (lead), RS tujuan, IGD, status unit | §8.3, §10.4-10.6 | B6, B11, B12 |
| **Mx8** | Pengerasan: kesehatan izin, `session.revoked`, dedup WS/FCM, uji perangkat nyata | §13 | B7-B10 (di perangkat nyata) |

### 6.4 Fase 0: konversi kontrak (rincian)

**OpenAPI 3.1 (`contracts/openapi.yaml`)**
- Satu `path` + `operation` untuk **setiap baris tabel endpoint** di dokumen REST (bagian 5). Parameter, body, dan respons dari dokumen.
- Komponen bersama: amplop (`Envelope`, `PageEnvelope`, `ErrorEnvelope`), `Coordinates`, enum (status, jenis, level) dengan nilai tak dikenal diizinkan di klien, `Error` dengan `code` dari katalog (bagian 7 REST).
- View: `CitizenReportView`, `OfferView`, `UnitView`, `DispatcherView`, `IncidentSummary` (dengan `dispatchSummary` dan `attentionReasons[]`).
- Keamanan: skema `bearerAuth`. Ekstensi `x-permission` (kode permission), `x-policy` (`lead`/`related`/`own`), `x-idempotent` (memakai `Idempotency-Key`), `x-rate-limit`, `x-audit` (aksi tercatat di audit).
- Header umum: `Idempotency-Key`, `X-Request-Id`, `Retry-After`.
- Contoh (`examples`) diambil dari dokumen.

**AsyncAPI 3 (`contracts/asyncapi.yaml`)**
- Satu pesan per event di katalog WebSocket (bagian 5), dengan amplop (`eid`, `id`, `type`, `v`, `ts`, `class`, `ackRequired`, `data`).
- Ekstensi `x-rooms` (audiens), `x-class` (kelas pengiriman), `x-fcm` (padanan pesan FCM bila ada).
- Pesan klien → server: `ack`, `auth.refresh`, `app.state`, `unit.location`.

**Alat dan pemeriksaan (`make contract`)**
- Lint dengan Spectral (aturan di `.spectral.yaml`: semua operasi punya `x-permission`, respons galat memakai `ErrorEnvelope`, dst.).
- **Pemeriksaan cakupan:** skrip membandingkan tabel endpoint di `docs/spec/rest-api-aplikasi-darurat.md` dengan `paths` pada kontrak, dan katalog event WebSocket dengan `asyncapi.yaml`. Selisih apa pun = gagal.
- Mock server dari kontrak (mis. Prism) untuk dashboard dan mobile.
- Tipe TypeScript untuk dashboard dihasilkan dari OpenAPI.
- **Model Dart dibuat oleh pemilik proyek dengan quicktype (keputusan D-001/D-002 di `DECISIONS.md`). Agent tidak membuat model Dart**, tetapi wajib menyediakan **contoh JSON** sebagai bahan quicktype (bagian 6.5).
- Selama Fase 1-6, **tes kontrak** memvalidasi respons backend terhadap skema OpenAPI.

### 6.5 Contoh JSON untuk quicktype (`contracts/examples/`)

Karena model Dart dibuat dari JSON, **kualitas contoh menentukan kualitas model.** quicktype menyimpulkan tipe dari sampel, sehingga sampel yang miskin menghasilkan model yang keliru (mis. field yang kadang `null` dianggap selalu ada).

**Struktur dan penamaan**

```
contracts/examples/
├── rest/
│   ├── <operationId>.<variasi>.json         # contoh respons data (isi di dalam "data")
│   └── errors/<code>.json                   # contoh galat per kode
├── ws/
│   └── <event.type>.<audiens>.json          # contoh amplop event per audiens
└── README.md                                # petunjuk pemakaian dengan quicktype
```

Contoh: `rest/getDispatch.offerView.json`, `rest/getDispatch.unitView.json`, `ws/dispatch.offered.unit.json`.

**Aturan isi contoh (wajib dipenuhi agent)**

| # | Aturan |
|---|---|
| 1 | **Satu berkas per bentuk (view)**: `OfferView` dan `UnitView` dipisah, `CitizenReportView` dan `DispatcherView` dipisah, karena field berbeda per audiens |
| 2 | Untuk field opsional, sediakan **varian**: satu contoh dengan field terisi, satu dengan `null`, satu dengan field **tidak ada**. Pemilik proyek menggabungkannya sehingga quicktype mendeteksi `nullable`/opsional |
| 3 | Sertakan **semua nilai enum yang sah** minimal sekali di seluruh kumpulan contoh (status dispatch, jenis kejadian, `publicStatus`, dll.) |
| 4 | Daftar (`data[]`) diberi **lebih dari satu elemen** dan contoh `page` (`nextCursor`, `hasMore`) |
| 5 | Tipe angka dibedakan nyata (`distanceM` bulat, `accuracyM` desimal) agar `int`/`double` terinferensi benar. Waktu memakai ISO 8601 UTC |
| 6 | Amplop event WebSocket lengkap (`eid`, `id`, `type`, `v`, `ts`, `class`, `ackRequired`, `data`) per jenis dan per audiens, termasuk event ber-`id: null` |
| 7 | Data contoh memakai **data seed fiktif** (bukan data nyata) dan tidak memuat PII sungguhan |
| 8 | Contoh **divalidasi terhadap skema OpenAPI/AsyncAPI** di `make contract`, dan **dihasilkan dari respons backend yang sebenarnya** (disalin dari tes integrasi) agar tidak melenceng dari implementasi |

**Pemeriksaan otomatis (`make contract`)**
- Setiap operasi di OpenAPI punya minimal satu contoh sukses, dan setiap kode galat di katalog punya contoh.
- Setiap event di AsyncAPI punya contoh untuk tiap audiens yang tercantum di `x-rooms`.
- Semua contoh lolos validasi skema.
- Tes integrasi backend membandingkan **bentuk** (nama field dan tipe) respons nyata dengan contoh. Perbedaan = tes gagal, sehingga contoh tidak basi.

**Catatan untuk pemilik proyek (pembuatan model)**
- quicktype tidak mengenal *nilai tak dikenal* pada enum. Sesuai dokumen Flutter (§5.5), penanganan `unknown` ditambahkan **manual** pada enum hasil quicktype.
- Gunakan contoh dari `contracts/examples/`, bukan keluaran API langsung, karena API langsung hanya menampilkan data saat itu (tidak mencakup varian dan enum lain).
- Setiap kali kontrak berubah, contoh diperbarui oleh agent dan pemilik membuat ulang model yang terdampak. Agent memberi daftar contoh yang berubah di `PROGRESS.md`.

---

## 7. Kriteria Selesai (Definition of Done)

### 7.1 Umum (berlaku untuk setiap modul/fitur)

- [ ] Perilaku sesuai dokumen sumber dan kontrak. Tidak ada endpoint/field/event di luar kontrak.
- [ ] Tes otomatis ditulis dan lulus: unit untuk logika murni, integrasi untuk jalur API/DB.
- [ ] Skenario penerimaan yang dirujuk pada gerbang fase lulus.
- [ ] `make lint` dan `make contract` hijau. Tidak ada peringatan tipe.
- [ ] Migrasi (bila ada) dapat naik dan turun.
- [ ] Tidak ada data pribadi, lokasi presisi, token, atau rahasia di log, galat, payload push, atau audit.
- [ ] Penanganan galat memakai katalog kode galat. Pesan Bahasa Indonesia.
- [ ] Dokumen sumber dan kontrak diperbarui bila perilaku berubah (dengan catatan di `CONTRACT_CHANGES.md`).
- [ ] `PROGRESS.md` diperbarui (selesai, penyimpangan, asumsi, pertanyaan terbuka).

### 7.2 Per modul backend (bukti selesai khusus)

| Modul | Bukti selesai |
|---|---|
| `auth` | OTP mock; login staf; 2FA; refresh berotasi **dan deteksi pemakaian ulang mencabut seluruh sesi**; batas laju OTP/login; akun nonaktif langsung ditolak |
| `permissions` (kebijakan) | Matriks permission × role diuji; kebijakan relasional (`lead`, `related`, `own`) diuji; aturan 404 vs 403 benar |
| `regions`, `organizations`, `units`, `incident-types`, `settings` | CRUD sesuai izin; `regions/resolve` benar untuk titik di dalam/luar kota; pengaturan tervalidasi tipe dan rentangnya |
| `attachments` | Alur 3 langkah; unggahan `PENDING` yang tidak dikonfirmasi dibersihkan; URL baca mengikuti visibilitas |
| `reports` | Idempotensi `clientReportId` (201 lalu 200, satu incident); `CONDITION_REPORT` tidak membuat incident; flag `OUT_OF_AREA`; batas laju (pengiriman ulang idempoten tidak dihitung) |
| `incidents` | Mesin status (semua transisi sah dan tidak sah diuji); kunci atomik + perpanjangan + override; `version` dan `VERSION_CONFLICT`; merge memindahkan laporan; view per audiens tanpa kebocoran |
| `dispatch` | Mesin status RESPOND dan NOTIFY; **balapan `accept` (satu menang, satu `409`)**; lompat tahap ke depan; `on-behalf` menyimpan `occurred_at` ≠ `recorded_at`; `destination` membuat NOTIFY ke IGD; offer kedaluwarsa (job + penyapu) |
| `resource-requests` | Hanya organisasi lead; keputusan menghasilkan dispatch `REQUESTED` |
| `realtime` | Handshake dan penolakan token; room dihitung **saat koneksi dari keadaan DB** (bukan hanya dari event); isolasi antar organisasi; ack; `connection.ready`; `auth.expiring` |
| `sync` | `/sync/events` hanya mengembalikan event yang boleh dilihat pemanggil; `resetRequired`; snapshot sesuai role |
| `notifications` | Kebijakan kelas pengiriman; dedup `eid`; eskalasi 20/60/120 detik; `MockProvider` mencatat; `FcmProvider` dapat diganti tanpa mengubah pemanggil |
| `devices` dan topic | Upsert token, pemindahan token antar pengguna, pencabutan saat logout/nonaktif, rekonsiliasi langganan |
| `alerts` | Siklus DRAFT → ACTIVE → CLOSED; pengiriman per wilayah/topic; alert uji ke `{env}_test`; batas laju alert |
| `shifts`, `dashboard` | Serah terima melepas kunci; ringkasan sesuai data |
| `audit` | Aksi wajib-audit (REST §9) tercatat; `before/after` dimask; append-only |
| `seed`, `sim` | V1-V14 |

---

## 8. Matriks Skenario Uji → Fase

Skenario didefinisikan di dokumen sumber dan menjadi **tes penerimaan otomatis**.

| Skenario | Sumber | Diuji pada |
|---|---|---|
| S1-S8 | REST §10 | S5/S7: Fase 2. S1/S2/S3/S6: Fase 3. S4: Fase 5. S8: Fase 4 |
| W1-W13 | WebSocket §12 | Fase 4 (W11: Fase 5) |
| F1-F15 | FCM §12 | Fase 4 dengan `MockProvider`. F1, F7, F14 juga di perangkat nyata (Mx5, Mx8) |
| A1-A10 | Flutter §13.1 | Mx2-Mx5 |
| B1-B13 | Flutter §13.2 | Mx6-Mx8 |
| D1-D20 | Dashboard §15 | Dx1-Dx7 |
| V1-V14 | Seed §12 | V1-V11 Fase 1; V12-V14 Fase 6 |

Prinsip tes:
- **Integrasi** memakai PostgreSQL+PostGIS dan Redis sungguhan (kontainer), bukan tiruan basis data.
- **Waktu** disuntikkan (`ClockService`) agar tes pewaktu dan kedaluwarsa deterministik.
- **WebSocket** diuji dengan klien `socket.io-client` yang menyambung ke aplikasi sungguhan.
- **Kontrak** diperiksa pada setiap respons uji terhadap skema OpenAPI.
- **Tes izin** dibangkitkan dari matriks (tabel permission × role) agar tidak ada yang terlewat.

---

## 9. Konvensi Teknis Backend (NestJS)

### 9.1 Struktur modul

```
backend/src/
├── main.ts, app.module.ts
├── common/               # config (tervalidasi), logger (pino + redaksi), request-id, filter galat,
│                         # amplop respons, validasi, idempotensi, paginasi kursor, rate limit,
│                         # ClockService, kode galat (konstanta), util geo
├── database/             # koneksi, migrasi, entitas, repositori dasar
├── modules/
│   ├── auth/  users/  staff/  roles-permissions/  organizations/  units/
│   ├── regions/  incident-types/  settings/  config-public/
│   ├── reports/  attachments/  incidents/  dispatches/  resource-requests/
│   ├── alerts/  notifications/  devices/  realtime/  sync/  shifts/  dashboard/  audit/  health/
│   └── (tiap modul: *.module.ts, controllers/, services/, repositories/, dto/, views/, policies/, events/, jobs/)
├── jobs/                 # prosesor BullMQ lintas modul
├── seed/                 # seed:base, seed:history, reset-live, verify
└── sim/                  # sim:bot, sim:flood, sim:citizen
```

### 9.2 Lapisan dan tanggung jawab

| Lapisan | Aturan |
|---|---|
| **Controller** | Tipis: validasi DTO (`whitelist` + `forbidNonWhitelisted`), penjaga autentikasi/izin, memanggil service, memakai serializer view. Tanpa logika bisnis |
| **Service** | Logika bisnis dan batas transaksi. Satu use case yang mengubah state = **satu transaksi** berisi: perubahan data + `incident_events` + `outbox_events` + `audit_logs` |
| **Repository** | Akses data (query, SQL PostGIS). Konversi koordinat `(lat,lng)` ↔ PostGIS `(lng,lat)` **hanya di sini** |
| **Mesin status** | `IncidentStateMachine`, `DispatchStateMachine` sebagai kelas murni berbasis tabel transisi (REST §6). Diuji penuh. Service memanggilnya, tidak mengulang aturan |
| **Kebijakan** | `PermissionService` (role → permission) + kebijakan relasional di `policies/` (`isLead`, `isRelated`, `isOwner`). Dekorator `@RequirePermission('incident.verify')` + `@Policy(...)` |
| **View/serializer** | `views/` per audiens (`CitizenReportView`, `OfferView`, `UnitView`, `DispatcherView`). **Satu-satunya** tempat aturan visibilitas. Dipakai REST, proyeksi WebSocket, dan payload FCM |
| **Event** | Service menulis `outbox_events` dalam transaksi. Pengirim outbox membaca, memproyeksikan per audiens, lalu emit/antre FCM (bagian 9.4) |

### 9.3 Pola data penting

| Topik | Pola |
|---|---|
| ORM dan migrasi | TypeORM (dukungan `geography`) dengan SQL mentah untuk fungsi PostGIS 🔶. Alternatif: Prisma + SQL mentah, atau Kysely. Migrasi berurutan, **tanpa `synchronize`** |
| Primary key | UUIDv7 (dibuat aplikasi). `incident_events` dan `audit_logs` memakai `bigint identity` |
| Status/tipe | `varchar` + `CHECK`, bukan enum PostgreSQL |
| Optimistic locking | Kolom `version`. `UPDATE ... WHERE id = :id AND version = :v`, periksa jumlah baris terdampak, bila 0 → `VERSION_CONFLICT` |
| Kunci incident (atomik) | `UPDATE incidents SET locked_by=:me, locked_at=now(), lock_expires_at=... WHERE id=:id AND (locked_by IS NULL OR lock_expires_at < now() OR locked_by=:me)`. Baris terdampak 0 → `INCIDENT_LOCKED` |
| Balapan accept | `UPDATE dispatches SET status='ACCEPTED', ... WHERE id=:id AND status='OFFERED'`. Terdampak 0 → `DISPATCH_ALREADY_ACCEPTED` atau `OFFER_NO_LONGER_AVAILABLE` (periksa status saat ini) |
| Idempotensi | Laporan: unique `client_report_id` (200 untuk pengulangan). Aksi lain: `Idempotency-Key` di Redis 24 jam (kunci sama + isi beda → `IDEMPOTENCY_CONFLICT`) |
| Paginasi kursor | Kursor opaque (base64 dari kunci urut + `id` sebagai pemutus seri). Urutan stabil |
| PostGIS | Kolom `geography(Point,4326)`. Jarak: `ST_Distance` pada `geography`. Radius: `ST_DWithin`. Penentuan wilayah: `ST_Covers` pada `boundary`. Index GiST pada semua kolom lokasi |
| Waktu | Simpan UTC (`timestamptz`). `ClockService` untuk semua pembacaan waktu. Validasi `occurredAt` (REST §1.5) |
| PII | Kolom pribadi hanya di `users` dan `incident_reports`. Log dan audit dimask. Anonimisasi mengikuti kebijakan retensi |

### 9.4 Outbox dan pengiriman event

```
Use case ──► transaksi: ubah data + incident_events + outbox_events + audit ──► COMMIT
                                                            │
                          Pengirim outbox (pekerja) membaca baris belum diproses
                                                            │
                              Proyeksi per audiens (EventProjector, memakai views)
                                    ├── emit WebSocket ke room
                                    └── antre FCM (DeliveryPolicyService) + notification_deliveries
                                                            │
                                          tandai outbox_events.processed_at
```

- Pengirim berjalan dengan *polling* singkat dan/atau notifikasi `LISTEN/NOTIFY`. Pemrosesan **at-least-once**, klien membuang duplikat dengan `eid`.
- `eid` dibuat saat outbox ditulis (satu `eid` per pengiriman logis, sama untuk WebSocket dan FCM).
- Baris outbox yang gagal diproses diulang dengan backoff dan ditandai bermasalah setelah N kali.

### 9.5 Keamanan

| Hal | Aturan |
|---|---|
| Kata sandi | Argon2 |
| Token akses | JWT dengan klaim `sub`, `sid`, `roles`, `orgId`, `unitId`. Izin dihitung di server dari role |
| Refresh token | Opaque, disimpan sebagai hash. Rotasi dalam transaksi. Pemakaian ulang token lama → cabut seluruh sesi + audit `auth.refresh_reuse_detected` |
| OTP | Disimpan sebagai hash, kedaluwarsa, batas percobaan. Mode `mock` hanya bila `OTP_PROVIDER=mock` dan bukan `prod` |
| 2FA | TOTP (mis. `otplib`). Rahasia dienkripsi (AES-GCM) |
| Rate limit | Penghitung di Redis (mis. throttler dengan store Redis). Pengiriman ulang idempoten tidak dihitung |
| Header | `helmet`, CORS terbatas |
| Log | `pino` dengan redaksi (`authorization`, `phone`, `fcmToken`, `description`, `location`) |
| Dokumentasi API | Swagger UI dari kontrak di `/docs` hanya non-produksi |

---

## 10. Antrean Job (BullMQ)

| Job | Pemicu | Tindakan | Catatan |
|---|---|---|---|
| `offer-timeout` | Tertunda sampai `offer_expires_at` | `OFFERED → EXPIRED`, event `dispatch.expired`, `DISPATCH_UPDATE` | Idempoten (periksa status saat dijalankan) |
| `offer-resend` | t = `fcm.resend_after_seconds` | Kirim ulang FCM **sekali** bila belum ada ack | |
| `offer-unseen` | t = `offer_unseen_seconds` | Event `dispatch.offer_unseen` bila belum `seen` | |
| `offer-sweeper` | Berkala (30 detik) | Menyapu dispatch `OFFERED` yang lewat batas (penjaga bila job hilang atau server restart) | Penyelamat, bukan jalur utama |
| `incident-escalation` | Berkala | Incident `SUBMITTED` melewati batas → `incident.escalation_due` ke supervisor | Satu kali per incident |
| `incident-autoclose` | Berkala | `RESOLVED` melewati `auto_close_hours` → `CLOSED` | |
| `lock-release` | Berkala | Melepas kunci kedaluwarsa (event `incident.unlocked`) | |
| `attachment-cleanup` | Harian | Menghapus lampiran `PENDING` > 24 jam dan berkas yatim | |
| `topic-reconcile` | Harian | Menyelaraskan `device_topic_subscriptions` dengan keadaan seharusnya | |
| `fcm-send` | Antrean | Mengirim pesan FCM (retry ≤ 3, backoff) | Atau `MockProvider` |
| `outbox-dispatcher` | Berkala/`LISTEN` | Memproses `outbox_events` | Bagian 9.4 |
| `retention` | Harian | Anonimisasi/penghapusan menurut kebijakan retensi | Default sampel: dimatikan 🔶 |

Seluruh job **idempoten** dan dapat diuji dengan jam tiruan.

---

## 11. Perangkap Umum (Periksa Sebelum Menyatakan Selesai)

1. **Emit event sebelum commit** → klien menerima kabar tentang data yang batal.
2. **Kebocoran lokasi presisi/kontak** lewat serializer, proyeksi WebSocket, payload FCM, log, pesan galat, atau `audit_logs.before/after`.
3. Lupa memeriksa **`version`** atau balapan (`accept`, kunci, ubah status).
4. Memakai **enum PostgreSQL** atau mengubah status tanpa mesin status.
5. **Urutan koordinat tertukar** (API `{lat,lng}` vs PostGIS `(lng,lat)`).
6. Waktu lokal vs UTC, dan `occurredAt` tanpa batas.
7. **Pewaktu offer hanya di memori** (hilang saat restart). Wajib job + penyapu.
8. Transisi **mundur** atau melompati tahap yang tidak diperiksa.
9. Idempotensi laporan: mengembalikan `201` ganda atau membuat incident ganda; pengulangan idempoten dihitung ke rate limit.
10. N+1 query pada daftar antrean, tidak ada index GiST/komposit sesuai ERD.
11. **Room WebSocket hanya dihitung dari event.** Koneksi baru (atau setelah restart) harus menghitung room dari keadaan DB (dispatch aktif, lead).
12. `incident_events.payload` atau `visibility` salah sehingga event terlihat oleh audiens yang tidak berhak.
13. Deteksi pemakaian ulang refresh token tidak atomik.
14. 404 vs 403 tidak konsisten (membocorkan keberadaan resource).
15. Langganan topic FCM tidak dibersihkan saat logout/nonaktif.
16. `eid` berbeda antara WebSocket dan FCM sehingga klien tidak bisa dedup.
17. Seed berjalan di `prod`, atau nomor darurat asli ada di data sampel.
18. Tes pewaktu memakai `sleep` sungguhan (rapuh). Gunakan jam tiruan.
19. Respons tidak cocok dengan kontrak (field ekstra/hilang, enum tak terdaftar).
20. Menyimpan token/PII di `localStorage`, cache persisten, atau URL (dashboard/mobile).

---

## 12. CI dan Mutu

| Tahap | Isi |
|---|---|
| Lint dan tipe | ESLint, Prettier, `tsc --noEmit` (backend, dashboard). `dart analyze` dan `dart format` (mobile) |
| Kontrak | Spectral + pemeriksaan cakupan dokumen ↔ kontrak + tes kontrak terhadap backend |
| Unit | Backend (Jest/Vitest), dashboard (Vitest), mobile (`flutter test`) |
| Integrasi | Backend dengan PostgreSQL+PostGIS, Redis, MinIO (kontainer). Skenario S/W/F |
| E2E | Dashboard (Playwright) terhadap backend sampel. Mobile: tes integrasi terhadap backend sampel |
| Keamanan | Audit dependensi, pemindaian rahasia, pemeriksaan "tidak ada PII di log" pada tes |
| Artefak | Citra Docker backend/dashboard, APK debug per flavor (opsional) |

Gerbang gabung: lint, tipe, kontrak, dan seluruh tes hijau.

---

## 13. Pelaporan Kemajuan dan Titik Tinjau Manusia

### 13.1 `PROGRESS.md` per fase

Berisi: apa yang selesai, tes yang lulus (ringkas), **penyimpangan dari dokumen** (dengan id di `CONTRACT_CHANGES.md`/`ASSUMPTIONS.md`), pertanyaan terbuka, risiko, dan langkah berikutnya.

### 13.2 Titik tinjau (agent berhenti dan menunggu)

| Kode | Setelah | Yang ditinjau manusia |
|---|---|---|
| **C0** | Fase 0 | `openapi.yaml` dan `asyncapi.yaml` (kecocokan dengan dokumen), struktur repo, lingkungan dev |
| **C1** | Fase 2 | Perilaku API melalui Swagger/seed: laporan, incident, view per audiens |
| **C2** | Fase 3 | Demo headless adegan 1-3 dengan `sim:bot`; kebenaran mesin status dan balapan |
| **C3** | Fase 4 | Demo realtime dengan perangkat nyata (adegan 1), push dalam mode `mock` dan `fcm` |
| **C4** | Fase 5-6 + jalur dashboard/mobile | Latihan penuh skrip demo (±45 menit) |
| **C5** | Fase 7 (setelah sampel disetujui) | Hasil uji beban, kekacauan, pemulihan cadangan, DR drill, daftar periksa go-live (Deployment §15) |

Perubahan yang diusulkan agent pada kontrak diputuskan manusia di `DECISIONS.md` sebelum diterapkan.

### 13.3 Protokol pertanyaan (pemilik keputusan tunggal)

Karena keputusan dipegang satu orang, beban peninjauan dijaga ringan:

| Jenis | Perlakuan agent |
|---|---|
| **Tidak memblokir** (ada default di dokumen) | Ambil default, catat di `docs/ASSUMPTIONS.md`, **lanjut bekerja**. Dibahas pada titik tinjau berikutnya |
| **Memblokir sebagian** (satu bagian tidak bisa lanjut) | Tulis di `docs/QUESTIONS.md` (konteks, opsi, rekomendasi agent), kerjakan bagian lain |
| **Memblokir total / pertentangan antar-dokumen / perubahan kontrak** | Berhenti, tulis di `docs/CONTRACT_CHANGES.md` atau `QUESTIONS.md`, tunggu keputusan |
| **Titik tinjau C0-C4** | Selalu berhenti dan menunggu |

Pertanyaan **dikelompokkan** dan diberikan sekaligus di akhir tiap fase (dengan rekomendasi), bukan satu per satu. Format `QUESTIONS.md`: `Q-xxx`, fase, pertanyaan, opsi, rekomendasi agent, dampak bila tidak dijawab.

---

## 14. Perubahan ERD yang Dipicu Dokumen Ini

Pola outbox (bagian 9.4) membutuhkan satu tabel tambahan, dicatat di ERD v1.3:

**`outbox_events`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | bigint identity | Urutan |
| eid | uuid | Identitas pengiriman logis (dipakai WebSocket dan FCM) |
| event_type | varchar(40) | Jenis event |
| incident_id | uuid (null) | |
| payload | jsonb | Data domain untuk proyeksi (bukan payload final per audiens) |
| created_at | timestamptz | |
| processed_at | timestamptz (null) | Diisi setelah diproyeksikan dan dikirim |
| attempts | smallint | Percobaan pemrosesan |
| last_error | text (null) | |

Index: partial (`id`) where `processed_at is null`. Baris lama yang sudah diproses dibersihkan berkala.

---

## 15. Asumsi Default dan Hal yang Perlu Ditinjau 🔶

| Hal | Default |
|---|---|
| ORM | **TypeORM + SQL mentah untuk PostGIS (D-001, ditetapkan)** |
| Manajer paket Node | pnpm 🔶 |
| Model Dart | **Dibuat pemilik proyek dengan quicktype** dari `contracts/examples/` (D-002). Agent menyediakan contoh JSON |
| Mock server | Prism dari OpenAPI 🔶 |
| Outbox | Tabel `outbox_events` + pekerja (polling, `LISTEN/NOTIFY` opsional) |
| Retensi | Job `retention` dimatikan pada sampel |
| Docker | Compose untuk dev. Produksi di luar cakupan |
| Versi paket | Dipin saat inisialisasi (jangan menyalin versi dari dokumen) dan dicek kompatibilitasnya |

Status keputusan sebelum Fase 0 (rincian di `DECISIONS.md`):

| # | Hal | Status |
|---|---|---|
| 1 | Struktur repositori dan nama target `make` | Belum diketahui pemilik. **Default bagian 4-5 berlaku**, ditetapkan paling lambat di C0 (D-007) |
| 2 | ORM | **Ditetapkan:** TypeORM + SQL mentah PostGIS (D-001) |
| 3 | Model Dart | **Ditetapkan:** dibuat pemilik dengan quicktype (D-002) |
| 4 | Penanggung jawab keputusan | **Ditetapkan:** pemilik proyek sendiri (D-003) |
| 5 | Tempat repositori dan alat CI | Belum diketahui. Akan ditanyakan (Q-001..Q-005). Agent menulis **CI-agnostik** sampai terjawab (D-008) |

---

## 16. Di Luar Cakupan Dokumen Ini

- Deployment produksi: dirancang di `deployment-aplikasi-darurat.md` dan dikerjakan pada **Fase 7**, **setelah sampel disetujui**. Fase 0-6 hanya memakai lingkungan dev (Compose).
- Integrasi SMS/WhatsApp nyata dan penyedia OTP nyata.
- Impor data wilayah, organisasi, dan akun nyata.
- Fitur fase 2-3 (BMKG otomatis, live tracking, Disaster Event, web push dispatcher, geofence alert).
- Pelatihan petugas dan materi presentasi.
