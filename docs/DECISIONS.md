# DECISIONS.md: Keputusan Pemilik Proyek

> Diisi dan dijaga oleh pemilik proyek. Agent **membaca** berkas ini sebelum bekerja dan **tidak mengubah keputusan** di dalamnya. Usulan perubahan masuk ke `docs/CONTRACT_CHANGES.md`.
> Pemilik keputusan: **pemilik proyek (satu orang)**.
> Terakhir diperbarui: 28 Oktober 2026

## 0. Rekaman titik tinjau

| Titik tinjau | Tanggal | Hasil |
|---|---|---|
| **C0** (Fase 0) | 2026-10-28 | **Disetujui.** `contracts/openapi.yaml` (114 endpoint) dan `contracts/asyncapi.yaml` (42 pesan) beserta `contracts/examples/` disetujui sebagai dasar pengembangan. Perbaikan cacat CC-001, CC-002, dan penambahan CC-007 (`sampleMode`) **dikonfirmasi**; CC-003..CC-006 **disetujui penerapannya** (rincian dan keputusan teknis di `docs/CONTRACT_CHANGES.md`). Struktur repositori dan nama target `make` (D-007) ditetapkan seperti default handoff §4-5. Lingkungan dev (Compose) diterima. |

## 1. Keputusan yang sudah ditetapkan

| ID | Keputusan | Dampak bagi agent |
|---|---|---|
| D-001 | **ORM: TypeORM**, dengan **SQL mentah untuk seluruh logika geospasial (PostGIS)**. Alasan: dukungan pustaka geospasial terbatas, SQL manual lebih terkendali | Query PostGIS (jarak, radius, `ST_Covers`, rekomendasi unit, geofence) ditulis sebagai SQL mentah di repository, diberi komentar dan diuji. Jangan mencari pustaka geospasial tambahan |
| D-002 | **Model Dart dibuat oleh pemilik proyek** memakai **quicktype** dari contoh JSON keluaran API | Agent **tidak membuat** model Dart. Agent wajib menyediakan **contoh JSON lengkap** di `contracts/examples/` (lihat handoff §6.4) sebagai bahan quicktype |
| D-003 | **Penanggung jawab keputusan: pemilik proyek sendiri** | Pertanyaan agent dikumpulkan (bukan menyela terus-menerus), lihat handoff §13.3 |
| D-004 | State management Flutter: **GetX**. Struktur: **models / views / controllers / services** | Sudah tertuang di dokumen Flutter |
| D-005 | Dashboard web: **Vite + React** | Sudah tertuang di dokumen dashboard |
| D-006 | Cakupan: **aplikasi sampel** untuk didemokan. Poin yang butuh keputusan client memakai default dan ditanyakan setelah sampel | Gunakan bagian "Asumsi Default" tiap dokumen |
| D-007 | **Nama target `make` dan struktur repositori: tetap seperti default handoff §4-5** (ditetapkan di C0, 2026-10-28) | Tidak ada perubahan; target `make up/down/migrate/seed/reset-live/verify/test/lint/contract/demo-bots` dipakai sebagaimana adanya |
| D-008 | **CI: GitHub Actions** pada runner Linux dengan dukungan Docker (untuk Postgres+PostGIS, Redis, MinIO saat tes integrasi); **citra disimpan di GitHub Container Registry (GHCR)** | Agent membuat berkas CI GitHub Actions pada saatnya; seluruh pemeriksaan tetap ada di target `make` agar CI-agnostik |
| D-009 | **Rekaman C0**: kontrak Fase 0 disetujui penuh (lihat bagian 0) | `CC-001`, `CC-002`, `CC-007` berstatus dikonfirmasi; `CC-003`..`CC-006` wajib diterapkan ke kontrak + dokumen + contoh |
| D-010 | **Tempat penyimpanan kode: GitHub, repositori `jiprakoso/emergency-platform`** (menjawab Q-001) | Push dilakukan ke repositori ini |
| D-011 | **Sistem operasi mesin pengembang: Linux** (menjawab Q-003) | `Makefile` tetap mekanisme utama; tidak perlu alternatif lintas-OS |
| D-012 | **Kebijakan cabang: agent boleh meng-push langsung ke `main`** setelah seluruh gerbang (`make lint`, `make test`, `make contract`) hijau (menjawab Q-005) | Tidak wajib pull request; kebijakan dapat diubah pemilik kapan pun |
| D-013 | **Penamaan env (A-018): pertahankan nama env implementasi** (`DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_NAME`, `REDIS_HOST`/`REDIS_PORT`, `MINIO_*`, `NODE_ENV`) — bukan `DATABASE_URL`/`REDIS_URL`/`ENV` handoff §5.2; `SAMPLE_MODE` tetap diwakili `system_settings.sample_mode` | Tidak ada perubahan kode; handoff §5.2 dilabeli sebagai default yang diganti (tercatat di `ASSUMPTIONS.md` A-018) |

## 2. Keputusan yang belum diketahui pemilik (default berlaku sementara)

Tidak ada. Seluruh keputusan pada tabel sebelumnya (D-007, D-008) sudah ditetapkan pada 2026-10-28.

## 3. Pertanyaan yang sudah dijawab (2026-10-28)

Semua pertanyaan tabel ini terjawab dan dipindahkan ke bagian 1:

| ID (lama) | Pertanyaan | Jawaban pemilik | ID baru |
|---|---|---|---|
| Q-001 | Di mana kode disimpan? | GitHub — `jiprakoso/emergency-platform` | D-010 |
| Q-002 | Apakah runner CI mendukung Docker? | Ya — GitHub Actions (runner Linux + Docker) | D-008 |
| Q-003 | Sistem operasi mesin pengembang? | Linux | D-011 |
| Q-004 | Tempat menyimpan citra Docker? | GitHub Container Registry (GHCR) | D-008 |
| Q-005 | Kebijakan cabang dan peninjauan? | Push langsung ke `main` setelah gerbang hijau | D-012 |

### Pertanyaan deployment (untuk instansi/stakeholder, sebelum Fase 7)

| ID | Pertanyaan | Mengapa penting |
|---|---|---|
| Q-101 | Di mana sistem dihosting (pusat data pemda, penyedia domestik, lainnya) dan apakah ada situs kedua untuk DR? | Menentukan topologi, biaya, dan kepatuhan penempatan data |
| Q-102 | Siapa penyelenggara/pemilik sistem elektronik ini secara hukum dan siapa mengurus pendaftaran serta penilaian dampak pelindungan data? | Menentukan kewajiban hukum dan lokasi data |
| Q-103 | Siapa on-call 24 jam dan siapa penanggung jawab keputusan darurat (pengalihan DR, rollback)? | Layanan darurat butuh jalur tanggung jawab yang jelas |
| Q-104 | Standar keamanan/sertifikasi yang wajib dipenuhi instansi? | Dapat menambah persyaratan teknis |
| Q-105 | Penyedia SMS yang sudah dipakai atau diizinkan pemda? | Dibutuhkan untuk OTP produksi |
| Q-106 | Kebijakan retensi data laporan dan lokasi? | Menentukan penyimpanan, anonimisasi, dan cadangan |
| Q-107 | Ponsel stakeholder dikelola (MDM) atau pribadi dan bagaimana distribusi aplikasi staf (Play Store atau internal)? | Menentukan alarm, pengecualian baterai, dan rilis |
| Q-108 | Anggaran dan jangka waktu pilot? | Menentukan skala awal dan tahapan peluncuran |
| Q-109 | Sumber tile peta produksi (server sendiri, penyedia domestik, berlisensi)? | Tile publik OSM tidak untuk beban produksi |

## 4. Cara mengisi

Ketika sebuah pertanyaan terjawab, pindahkan barisnya ke bagian 1 dengan ID baru dan perbarui dokumen terkait di commit yang sama.
