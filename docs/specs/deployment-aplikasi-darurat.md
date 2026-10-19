# Dokumen Deployment Produksi v1: Aplikasi Informasi Bencana & Kejadian Darurat

> Status: draft v1 (spesifikasi arsitektur dan prosedur, **bukan skrip infrastruktur**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `erd-aplikasi-darurat.md`, `rest-api-aplikasi-darurat.md`, `websocket-aplikasi-darurat.md`, `fcm-aplikasi-darurat.md`, `dashboard-aplikasi-darurat.md`, `handoff-agent-code-aplikasi-darurat.md`
> Cakupan: bagaimana sistem dijalankan untuk **pilot dan produksi satu kabupaten/kota**: topologi, keamanan, cadangan, pemulihan bencana, observabilitas, rilis, dan kesiapan go-live.
> Berbeda dari lingkungan sampel (Docker Compose di laptop/server uji). Dokumen ini menjadi dasar **Fase 7** (infrastruktur sebagai kode) pada rencana agent code.
> Tanda 🔶 = keputusan terbuka atau angka usulan yang perlu divalidasi (uji beban, instansi, atau tinjauan hukum).

---

## 1. Prinsip Operasional

Sistem ini dipakai saat orang membutuhkan pertolongan. Prioritas desain deployment berbeda dari aplikasi biasa:

| # | Prinsip | Konsekuensi |
|---|---|---|
| 1 | **Ketersediaan di atas fitur** | Tidak ada satu komponen pun yang boleh menjadi titik kegagalan tunggal untuk penerimaan laporan dan dispatch |
| 2 | **Degradasi anggun** | Bila sebagian layanan jatuh (Redis, penyimpanan berkas, FCM, SMS), **penerimaan laporan dan dispatch tetap berjalan** dengan kemampuan berkurang. Jalur telepon dan prosedur manual selalu tersedia (bagian 11) |
| 3 | **Sederhana** | Sedikit komponen bergerak. Satu kota tidak membutuhkan orkestrasi yang rumit. Pilih teknologi yang tim bisa operasikan dan perbaiki sendiri |
| 4 | **Dapat diulang** | Semua infrastruktur dan konfigurasi tertulis (kode). Server dapat dibangun ulang dari nol tanpa pengetahuan lisan |
| 5 | **Perubahan aman** | Rilis bertahap, migrasi kompatibel mundur, dapat dibatalkan dengan cepat. Ada **pembekuan perubahan** saat kondisi bencana |
| 6 | **Data pribadi dilindungi** | Lokasi, kontak, dan identitas pelapor adalah data sensitif. Enkripsi, pembatasan akses, jejak audit, dan kepatuhan wilayah data |
| 7 | **Teramati** | Setiap masalah harus terlihat sebelum warga atau petugas yang melaporkannya |
| 8 | **Dipisah per lingkungan** | Sampel/demo, staging, dan produksi tidak berbagi basis data, proyek Firebase, kunci, atau domain |

---

## 2. Target Layanan (Usulan) 🔶

Angka berikut adalah **usulan awal** untuk didiskusikan dengan client dan divalidasi lewat uji beban (bagian 14).

| Indikator | Pilot | Produksi (target) | Catatan |
|---|---|---|---|
| Ketersediaan API dan realtime (bulanan) | 99,5% | 99,9% | 99,9% ≈ 43 menit gangguan per bulan |
| **RPO** (data hilang maksimal saat bencana pusat data) | ≤ 5 menit | ≤ 1 menit | Arsip WAL berkelanjutan dan replika |
| **RTO** (waktu pulih) | ≤ 60 menit (manual) | ≤ 30 menit | Pemulihan di situs cadangan |
| Latensi laporan baru → muncul di antrean dispatcher | p95 < 1 detik | p95 < 1 detik | Sesuai spesifikasi WebSocket |
| Offer dispatch → notifikasi di perangkat responder | p95 < 5 detik | p95 < 5 detik | Jalur ganda WebSocket dan FCM |
| Penerimaan laporan saat lonjakan | 300 laporan/menit selama 10 menit tanpa penolakan | Sama | Skenario banjir (`sim:flood`) |
| Waktu pemulihan satu node aplikasi | < 2 menit (otomatis) | < 2 menit | Node lain melayani |

**Anggaran galat:** ketersediaan di bawah target dua bulan berturut-turut = pembekuan fitur baru sampai stabil.

---

## 3. Hosting dan Kepatuhan

### 3.1 Pilihan hosting 🔶

Instansi belum menentukan tempat sistem berjalan. Pilihannya:

| Opsi | Keterangan | Kelebihan | Risiko |
|---|---|---|---|
| **A. Pusat data pemda / pusat data pemerintah** | Server di data center milik pemda atau pusat data pemerintah | Kendali dan kepatuhan penempatan data paling jelas | Kapasitas operasional tim, redundansi daya/jaringan dan situs cadangan harus tersedia |
| **B. Penyedia pusat data/cloud domestik** (kolokasi atau VM) | Sewa infrastruktur di penyedia dalam negeri | Penempatan data di Indonesia, tim tidak mengurus fisik | Biaya berulang, kontrak dan SLA penyedia perlu ditinjau |
| **C. Cloud global dengan region di Indonesia** | Bila region lokal tersedia dan diizinkan | Layanan terkelola, cepat dibangun | Kepatuhan penempatan data harus dipastikan, biaya, ketergantungan vendor |

**Default rancangan:** infrastruktur dirancang **portabel** (kontainer, PostgreSQL, Redis, penyimpanan kompatibel S3), sehingga dapat dijalankan pada opsi A atau B tanpa mengubah aplikasi. Pemilihan akhir mengikuti instansi.

### 3.2 Kepatuhan (perlu dikonfirmasi dengan bagian hukum/pemda) 🔶

> Catatan: ini bukan nasihat hukum. Poin berikut adalah hal yang perlu dipastikan dengan pihak berwenang sebelum produksi.

| Topik | Yang perlu dipastikan |
|---|---|
| **Penempatan data** | Sistem yang dikelola atau ditunjuk instansi pemerintah umumnya tergolong penyelenggara sistem elektronik **lingkup publik**. Ketentuan dalam PP 71/2019 pada dasarnya mewajibkan pengelolaan, pemrosesan, dan penyimpanan sistem dan data elektronik di wilayah Indonesia (dengan pengecualian terbatas). Pastikan status sistem ini dan konsekuensinya terhadap lokasi server, **situs cadangan (DRC)**, dan penyedia |
| **Pendaftaran sistem elektronik** | Kewajiban pendaftaran penyelenggara sistem elektronik sebelum dipakai publik, dan data yang dilaporkan (lokasi pengelolaan data, jenis data pribadi) |
| **Pelindungan data pribadi** | UU 27/2022 tentang Pelindungan Data Pribadi: dasar pemrosesan (persetujuan), hak subjek data (akses, koreksi, penghapusan), penilaian dampak, penunjukan pejabat pelindungan data bila diwajibkan, **kewajiban pemberitahuan insiden kebocoran dalam jangka waktu tertentu**. Siapkan prosedur insiden (bagian 12) |
| **Klasifikasi data** | Tentukan klasifikasi data sistem (lokasi + identitas pelapor, rekam medis ringan di data korban) dan aturan penyimpanannya |
| **Pihak ketiga di luar negeri** | **FCM (Google)** mengirim notifikasi lewat infrastruktur di luar negeri. Payload sudah dirancang tanpa data pribadi dan lokasi presisi, tetapi perlu dikonfirmasi diterima secara hukum. Hal yang sama untuk layanan peta (tile), pelaporan crash, dan penyedia SMS |
| **Retensi** | Berapa lama laporan, lokasi, dan audit disimpan, dan bagaimana anonimisasinya (juga pada cadangan) |
| **Kontrak pemrosesan data** | Perjanjian dengan penyedia hosting, SMS, dan layanan lain yang memproses data pribadi |

### 3.3 Implikasi teknis

| Hal | Keputusan rancangan |
|---|---|
| Lokasi data | Basis data, penyimpanan berkas, cadangan, dan situs cadangan **di Indonesia** (default) |
| Layanan peta | Produksi **tidak memakai tile publik OSM**, yang tidak dimaksudkan untuk beban produksi. Opsi: server tile sendiri (data OSM wilayah), penyedia tile domestik, atau tile berlisensi 🔶. Permintaan tile juga mengungkap area yang sedang dilihat dispatcher |
| Crash reporting | Tidak dikirim ke layanan luar negeri secara bawaan. Bila dipakai, tanpa PII dan atas keputusan instansi 🔶 |
| FCM | Dipertahankan (satu-satunya jalur push yang praktis untuk Android). Payload minimal sebagaimana dokumen FCM |

---

## 4. Topologi

### 4.1 Gambaran (pilot produksi, satu situs utama + situs cadangan)

```
                         Internet (warga, petugas, dispatcher)
                                      │
                      DNS (TTL rendah) + perlindungan DDoS (penyedia/WAF) 🔶
                                      │
                 ┌────────────────────┴────────────────────┐
                 │   Edge: Nginx / HAProxy × 2 (VIP/LB)    │  TLS, WebSocket upgrade,
                 │   dashboard statis, rate limit kasar    │  sticky session, header keamanan
                 └───────────┬───────────────────┬─────────┘
                             │                   │
        ┌────────────────────┴───┐     ┌─────────┴──────────────┐
        │ Backend API+WS × 2     │     │ Backend Worker × 2     │
        │ (NestJS, ROLE=api)     │     │ (BullMQ, outbox,       │
        │                        │     │  ROLE=worker)          │
        └───┬────────┬───────┬───┘     └───┬────────┬───────────┘
            │        │       │             │        │
   ┌────────┴──┐ ┌───┴────┐ ┌┴─────────────┴──┐ ┌───┴───────────────┐
   │ PgBouncer │ │ Redis  │ │ Object storage   │ │ FCM / SMS (luar)  │
   │     ↓     │ │ primer │ │ (S3-kompatibel)  │ │ lewat egress      │
   │ PostgreSQL│ │+replika│ │ replikasi ke DR  │ └───────────────────┘
   │ primer    │ │+sentinel│ └──────────────────┘
   │ + replika │ └────────┘
   └───────────┘
        │  arsip WAL + cadangan terenkripsi (pgBackRest) ──► penyimpanan terpisah + situs DR

   Pemantauan: Prometheus + Alertmanager + Grafana + log terpusat (Loki) — host terpisah
   Situs DR (warm standby): replika PostgreSQL, replikasi objek, image siap, dapat diaktifkan manual
```

Pemisahan **peran backend** lewat variabel `ROLE` (`api`, `worker`, `all`):
- `api`: REST dan WebSocket, menerima permintaan pengguna.
- `worker`: BullMQ (pewaktu offer, eskalasi, pembersihan, pengirim FCM), pengirim outbox, penyapu. Tidak menerima lalu lintas pengguna.
- `all`: untuk lingkungan dev/sampel.

Pemisahan ini mencegah lonjakan lalu lintas pengguna mengganggu pewaktu offer, dan sebaliknya.

### 4.2 Komponen dan rancangan ketersediaan

| Komponen | Pilot | Produksi | Catatan |
|---|---|---|---|
| **Edge (Nginx/HAProxy)** | 2 node, VIP (keepalived) atau LB penyedia | Sama | Penghentian TLS, upgrade WebSocket, *sticky session* (lihat 4.3), berkas statis dashboard |
| **Backend API+WS** | 2 instance (host berbeda) | 2-3+ | Tanpa state lokal. Adapter Redis untuk Socket.IO |
| **Backend Worker** | 2 instance | 2 | Job idempoten, aman berjalan ganda. Penyapu dan pengirim outbox memakai penguncian (`SKIP LOCKED`) agar tidak berebut |
| **PostgreSQL + PostGIS** | 1 primer + 1 replika (streaming) dengan failover terotomasi (mis. Patroni) atau layanan terkelola yang mendukung PostGIS 🔶 | + replika di DR | Arsip WAL berkelanjutan (PITR). Replikasi sinkron hanya bila RPO mendekati nol dibutuhkan 🔶 |
| **PgBouncer** | Per aplikasi atau terpusat | Sama | Mode transaksi. **Pendengar outbox (`LISTEN/NOTIFY`) memakai koneksi langsung ke PostgreSQL**, tidak lewat PgBouncer |
| **Redis (atau Valkey)** | Primer + replika + Sentinel (3 saksi) | Sama | Persistensi AOF. `maxmemory-policy noeviction` (BullMQ). Pemantauan memori |
| **Object storage** | S3-kompatibel dari penyedia, atau MinIO terdistribusi (≥ 4 node untuk pemulihan kegagalan) 🔶 | + replikasi ke DR | Titik akhir publik untuk URL bertanda tangan (bagian 13.3) |
| **Pemantauan dan log** | Satu host terpisah | Dua (HA) bila perlu | Di luar jalur kritis, tetapi kegagalannya harus tetap terdeteksi (pemeriksaan dari luar) |
| **Registry citra, CI/CD** | Privat | Privat | Lihat bagian 9 |

### 4.3 WebSocket di belakang beberapa instance

- Adapter Redis memastikan event dan room bekerja lintas instance (sudah dirancang).
- Bila transport `polling` dipakai sebagai cadangan, koneksi harus **lengket** ke satu instance: aktifkan sticky session pada LB (berbasis cookie, bukan IP karena banyak pengguna di balik NAT seluler) 🔶. Alternatif: **WebSocket saja** (tanpa polling) bila jaringan memungkinkan. Default rancangan: dashboard WebSocket saja, aplikasi mobile dengan polling cadangan + sticky.
- Batas koneksi per pengguna dan pembatasan laju tetap di aplikasi.
- Pengaturan LB: batas waktu koneksi idle > interval ping Socket.IO (≥ 60 detik), buffering dimatikan untuk jalur WebSocket.

### 4.4 Nama domain (placeholder)

| Domain | Fungsi |
|---|---|
| `console.example.id` | Dashboard web (statis) |
| `api.example.id` | REST `/api/v1` dan WebSocket `/realtime` (dapat disatukan dengan `console` lewat reverse proxy satu origin) |
| `files.example.id` | Titik akhir objek untuk URL bertanda tangan (unggah/unduh langsung) |
| `grafana.internal.example.id` | Pemantauan, hanya jaringan internal/VPN |

Sertifikat TLS: otomatis (ACME) atau dari CA instansi, dengan pemantauan masa berlaku (bagian 10).

---

## 5. Ukuran Awal (Titik Mulai) 🔶

Angka di bawah hanyalah **titik awal** untuk satu kota dan wajib divalidasi dengan uji beban (bagian 14).

### 5.1 Asumsi beban

| Parameter | Asumsi awal |
|---|---|
| Warga terdaftar | 10.000-100.000 |
| Laporan | ±500/hari normal, lonjakan 300/menit saat banjir |
| Koneksi WebSocket serentak | Staf 50-200, dispatcher 5-20, warga di latar depan hingga ±5.000 saat bencana |
| Alert massal | 1 alert ke seluruh kota (ratusan ribu perangkat lewat topic FCM) |
| Lampiran | Rata-rata 2 foto/laporan (≈ 1,5 MB), video jarang |

### 5.2 Spesifikasi awal per peran

| Peran | Jumlah | vCPU / RAM / disk | Catatan |
|---|---|---|---|
| Edge | 2 | 2 / 2 GB / 40 GB | |
| Backend API+WS | 2 | 4 / 8 GB / 40 GB | Node.js memakai satu inti per proses. Jalankan beberapa proses per host bila perlu |
| Backend Worker | 2 | 2 / 4 GB / 40 GB | |
| PostgreSQL | 2 (primer, replika) | 8 / 32 GB / 500 GB SSD/NVMe | Disk terpisah untuk WAL. PostGIS memakai memori untuk indeks GiST |
| Redis | 2 + 1 saksi | 2 / 4 GB / 20 GB | |
| Object storage | Sesuai opsi | Lihat 5.3 | |
| Pemantauan | 1 | 4 / 16 GB / 500 GB | Retensi metrik dan log |

### 5.3 Perkiraan penyimpanan berkas

`kebutuhan/tahun ≈ laporan/hari × lampiran/laporan × ukuran rata-rata × 365`

Contoh: 500 × 2 × 1,5 MB × 365 ≈ **550 GB/tahun** (belum termasuk video, cadangan, dan replikasi ke DR). Terapkan kebijakan siklus hidup (retensi, pemindahan ke tier lebih murah) sesuai keputusan retensi 🔶.

---

## 6. Lingkungan

| Lingkungan | Tujuan | Data | Push | Catatan |
|---|---|---|---|---|
| **dev** | Pengembangan lokal (Docker Compose) | Seed fiktif | `mock` | Lihat dokumen serah terima |
| **sampel/demo** | Demo ke client | Seed fiktif | `mock` atau `fcm` (proyek `dev`) | `SAMPLE_MODE=true`, nomor darurat contoh |
| **staging** | Cermin produksi berskala kecil untuk uji rilis, uji beban, dan UAT | **Data fiktif atau teranonimkan**, tidak pernah salinan produksi mentah | `fcm` (proyek `staging`) | Konfigurasi sama dengan produksi, `SAMPLE_MODE` bisa menyala untuk pelatihan |
| **produksi** | Layanan nyata | Data nyata | `fcm` (proyek `prod`) | `SAMPLE_MODE=false` |

Aturan lintas lingkungan:
- **Tidak ada** data, kredensial, proyek Firebase, atau kunci yang dipakai bersama antar lingkungan.
- Seed dan akun demo **ditolak** di produksi (`ENV=prod`).
- Perubahan konfigurasi mengalir dev → staging → produksi lewat kode (bagian 9).
- Pelatihan petugas memakai lingkungan **staging/pelatihan**, bukan produksi.

---

## 7. Jaringan dan Keamanan

### 7.1 Segmentasi dan aturan lalu lintas

| Zona | Isi | Boleh diakses dari |
|---|---|---|
| **Publik (edge)** | Edge/LB | Internet (443), 80 hanya untuk pengalihan ke 443 |
| **Aplikasi** | Backend API/Worker | Edge saja (port aplikasi). Keluar (egress) terbatas ke FCM, penyedia SMS, NTP |
| **Data** | PostgreSQL, PgBouncer, Redis, object storage | Backend, dan host cadangan. **Tidak ada akses langsung dari internet** |
| **Manajemen** | Pemantauan, bastion, CI runner | Jaringan internal/VPN saja |

| Port | Dari → ke | Keterangan |
|---|---|---|
| 443 | Internet → Edge | Satu-satunya yang terbuka ke publik |
| 3000 (contoh) | Edge → Backend | Jaringan aplikasi |
| 5432 / 6432 | Backend, Worker, replika, host cadangan → PostgreSQL / PgBouncer | Dibatasi alamat |
| 6379 / 26379 | Backend, Worker → Redis / Sentinel | Dibatasi alamat |
| 9000 | Backend + Edge (untuk `files.`) → Object storage | |
| 22 | VPN/bastion → semua host | Kunci SSH saja, tanpa sandi, tanpa akses root langsung |
| Pemantauan | Internal | Tidak terpapar publik |

### 7.2 Perlindungan di tepi

| Hal | Rancangan |
|---|---|
| TLS | TLS 1.2+ (disarankan 1.3), HSTS, sertifikat otomatis, pemantauan kedaluwarsa |
| **DDoS dan penyalahgunaan** | Layanan darurat adalah target menarik. Gunakan perlindungan DDoS dari penyedia/jaringan dan batas laju di edge. Batas kasar per IP (mis. 600 permintaan/menit) di edge, sementara batas rinci per pengguna tetap di aplikasi (REST §8) 🔶 |
| WAF | Aturan dasar (OWASP) pada edge atau layanan WAF penyedia 🔶 |
| Header | `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, CSP ketat untuk dashboard (dokumen dashboard §11.4) |
| IP asli klien | Edge meneruskan `X-Forwarded-For` dan aplikasi memercayainya **hanya dari alamat edge** (`trust proxy` terbatas) agar rate limit berdasarkan IP tidak bisa dipalsukan |
| Akses dashboard | Opsi: batasi halaman dashboard dan rute `/api/v1/admin/*` ke jaringan instansi/VPN. Aplikasi mobile staf memakai API publik dengan autentikasi dan izin biasa 🔶 |
| Unggahan | Pembatasan ukuran dan tipe, pemindaian malware (mis. ClamAV) pada berkas yang diunggah 🔶, EXIF dibuang |

### 7.3 Pengerasan host dan kontainer

- OS minimal, pembaruan keamanan terjadwal, `chrony`/NTP (waktu server harus akurat karena pewaktu offer dan `ClockService`), zona waktu server UTC.
- Akses SSH dengan kunci, 2FA/VPN untuk bastion, pembatasan `sudo`, log akses terpusat.
- Kontainer: berjalan **non-root**, filesystem hanya-baca bila memungkinkan, `cap_drop: ALL`, tanpa mode privileged, batas CPU/memori, citra dasar diberi versi tetap dan dipindai (Trivy atau setara), SBOM disimpan.
- Pembaruan dependensi dan citra rutin. Kerentanan kritis ditambal dalam jangka waktu yang disepakati 🔶.
- Firewall host (nftables/ufw) selain firewall jaringan.

### 7.4 Rahasia dan kunci

| Rahasia | Penyimpanan | Rotasi |
|---|---|---|
| Kredensial DB, Redis, object storage | Pengelola rahasia (Vault/SOPS+age/ fasilitas penyedia). **Tidak** ada di repositori atau berkas `.env` polos di server | Berkala (mis. per 90 hari) dan saat ada petugas keluar |
| `JWT_ACCESS_SECRET` | Pengelola rahasia | Dukungan **dua kunci aktif** (`kid`) agar rotasi tanpa memutus sesi |
| `TOKEN_HASH_PEPPER` | Pengelola rahasia | Sulit diganti (membatalkan refresh token yang ada). Rotasi hanya dengan jendela sengaja |
| `TOTP_ENCRYPTION_KEY` | Pengelola rahasia | Dengan skema versi kunci untuk enkripsi ulang bertahap |
| Kunci akun layanan Firebase | Pengelola rahasia | Berkala, hak akses minimum (hanya mengirim pesan) |
| Keystore penandatanganan aplikasi Android | **Disimpan dengan cadangan terpisah dan terkontrol akses.** Kehilangannya = tidak bisa merilis pembaruan | Tidak dirotasi, dijaga |

### 7.5 Perlindungan data

| Hal | Rancangan |
|---|---|
| Enkripsi saat diam | Enkripsi disk/volume pada server data dan cadangan (LUKS atau fasilitas penyedia). Enkripsi cadangan pgBackRest |
| Enkripsi saat transit | TLS ke publik. TLS juga di dalam jaringan untuk koneksi ke PostgreSQL, Redis, dan object storage bila lintas host 🔶 |
| Kolom sensitif | Nomor telepon pelapor dan lokasi presisi dibatasi akses lewat view. Enkripsi tingkat kolom pada `reporter_phone` dan data kontak dipertimbangkan 🔶 |
| Akses | Hak akses minimum. Akun basis data terpisah per fungsi (aplikasi, worker, cadangan, hanya-baca analitik). Tidak ada akses basis data langsung dari laptop pengembang ke produksi |
| Audit | `audit_logs` append-only, ditinjau berkala. Akses administrator infrastruktur juga tercatat |
| Data uji | Tidak boleh memakai salinan produksi. Bila terpaksa, teranonimkan |
| Cadangan dan penghapusan | Kebijakan retensi harus mempertimbangkan **permintaan penghapusan data** (cadangan lama kedaluwarsa menurut jadwal, bukan diubah) |

---

## 8. Konfigurasi Produksi dan Prasyarat dari Sisi Aplikasi

### 8.1 Perbedaan konfigurasi sampel vs produksi

| Kunci / hal | Sampel | Produksi |
|---|---|---|
| `ENV` | `dev`/`staging` | `prod` |
| `SAMPLE_MODE` | `true` | `false` (tanpa lencana MODE SAMPEL) |
| Seed dan akun demo | Aktif | **Dilarang** (ditolak oleh penjaga `ENV=prod`) |
| `OTP_PROVIDER` | `mock` (`123456`) | **Penyedia SMS nyata** (bagian 8.3) |
| `NOTIFICATION_PROVIDER` | `mock`/`fcm` | `fcm` (proyek Firebase `prod`) |
| `TWO_FACTOR_REQUIRED` | `false` | `true` untuk dispatcher dan supervisor |
| Kata sandi staf | `Contoh#2026` | Dibuat Admin Organisasi, `mustChangePassword = true` |
| Nomor darurat | Nomor contoh | **Nomor resmi** (`system_settings.emergency_contacts`) |
| `LOG_LEVEL` | `debug`/`info` | `info`, redaksi PII aktif |
| Swagger `/docs`, source map | Aktif | **Nonaktif** |
| Refresh token web | `sessionStorage` | **Cookie HttpOnly** (REST §16 poin 3) |
| Retensi (`retention` job) | Mati | **Aktif** sesuai kebijakan |
| Rate limit | Longgar/sampel | Disetel setelah uji beban dan pilot |
| `CORS_ORIGINS` | Longgar (dev) | Hanya origin dashboard |
| Peta | Tile OSM publik | Tile produksi (bagian 3.3) |
| `min_app_version` | `1.0.0` | Diatur per rilis |

### 8.2 Perubahan/penguatan aplikasi yang dibutuhkan untuk produksi (backlog Fase 7)

| # | Kebutuhan | Alasan |
|---|---|---|
| 1 | `ROLE=api\|worker\|all` pada backend | Memisahkan lalu lintas pengguna dari job (bagian 4.1) |
| 2 | **Penutupan anggun (*graceful shutdown*)**: pada `SIGTERM` berhenti menerima koneksi baru, mengirim `system.notice` + menutup WebSocket dengan petunjuk sambung ulang bertahap (acak), menyelesaikan permintaan berjalan, melepas kunci/pemrosesan | Rilis bergulir tanpa memutus petugas sekaligus (badai sambung ulang) |
| 3 | `/health` (hidup) dan `/health/ready` (siap: DB, Redis, penyimpanan) dipakai LB dan orkestrator | Instance yang tidak siap dikeluarkan dari rotasi |
| 4 | `trust proxy` terbatas ke alamat edge | Rate limit per IP tidak bisa dipalsukan |
| 5 | Kompatibilitas **PgBouncer**: kueri tanpa fitur sesi (`LISTEN/NOTIFY` pada koneksi langsung terpisah) | Pembatasan koneksi PostgreSQL |
| 6 | **Perilaku saat Redis jatuh** (bagian 11.1): rate limiter *fail-open*, idempotensi laporan cukup dengan constraint unik DB, penerimaan laporan tidak diblokir | Penerimaan laporan adalah fungsi paling kritis |
| 7 | **Perilaku saat penyimpanan berkas jatuh**: laporan teks dan lokasi tetap diterima, lampiran menyusul (sudah sesuai rancangan) | |
| 8 | `OtpProvider` nyata (SMS) dengan antarmuka yang sama seperti `mock` | Bagian 8.3 |
| 9 | **Cookie HttpOnly** untuk refresh token klien web | Mengurangi risiko XSS |
| 10 | Rotasi kunci JWT dengan `kid` (dua kunci aktif) | Rotasi tanpa memutus sesi |
| 11 | Pemindaian berkas unggahan (opsional) dan pembuangan EXIF di server | Bagian 7.2 |
| 12 | Metrik Prometheus (`/metrics` internal) dan log JSON terstruktur dengan `requestId` | Bagian 10 |
| 13 | Migrasi basis data **kompatibel mundur** (pola *expand/contract*) | Rilis bergulir aman, pembatalan mudah |
| 14 | **Pembekuan perubahan** yang dapat dinyalakan lewat pengaturan (menolak aksi administratif tertentu dan menandai jendela rilis tertutup) 🔶 | Bagian 9.5 |
| 15 | Tanda **canary/uji** pada laporan sintetis agar tidak mengganggu antrean dispatcher bila dipakai pemantauan sintetis penuh 🔶 | Bagian 10.3 |
| 16 | Penanganan **cadangan dan penghapusan data** sesuai retensi (anonimisasi terjadwal) | Bagian 13.4 |

### 8.3 Penyedia SMS untuk OTP (kebutuhan baru di produksi) 🔶

Pada sampel OTP bersifat tiruan. Produksi membutuhkan pengiriman SMS nyata:

| Hal | Catatan |
|---|---|
| Penyedia | Penyedia SMS domestik berizin. Pilih berdasarkan keandalan pengiriman ke semua operator |
| ID pengirim (*sender ID*) | Perlu didaftarkan |
| Ketersediaan | Dua penyedia (utama + cadangan) bila anggaran memungkinkan. Pergantian otomatis saat kegagalan |
| Biaya | Dibatasi lewat batas laju OTP (REST §8) dan deteksi penyalahgunaan |
| Kegagalan | Bila SMS gagal: warga baru tidak dapat mendaftar, sedangkan sesi yang sudah ada tetap berjalan. Tampilkan nomor telepon darurat. Opsi OTP lewat WhatsApp Business atau panggilan suara 🔶 |
| Kepatuhan | Perjanjian pemrosesan data dengan penyedia |

---

## 9. Pipeline Rilis dan Orkestrasi

### 9.1 Pilihan orkestrasi 🔶

| Opsi | Kecocokan | Catatan |
|---|---|---|
| **A. Docker Compose per host + Ansible + Nginx/HAProxy** | **Disarankan untuk pilot** | Sederhana, mudah dipahami dan dipulihkan tim kecil. Rilis bergulir diatur skrip (satu node per giliran, kuras lalu naikkan) |
| B. Docker Swarm | Alternatif sederhana | Rilis bergulir bawaan, jejaring lebih sederhana dari Kubernetes |
| C. Kubernetes (k3s atau layanan terkelola) | Bila tim sudah berpengalaman atau penyedia menyediakan layanan terkelola | Lebih banyak komponen untuk dioperasikan. Layak untuk skala lebih besar |

Default: **A** untuk pilot, dengan kontainer yang tidak bergantung pada orkestrator sehingga pindah ke C kelak tidak mengubah aplikasi.

### 9.2 Infrastruktur sebagai kode

- Provisioning dan konfigurasi dengan Ansible (dan Terraform bila penyedia mendukung) 🔶. Semua di repositori `infra/`.
- Tidak ada perubahan manual di server. Perubahan darurat dicatat lalu dimasukkan ke kode.
- Server dapat **dibangun ulang dari nol** dan diuji (bagian 14).

### 9.3 Alur CI/CD

```
Commit ──► CI: lint, tipe, unit, integrasi (PostGIS+Redis+MinIO sungguhan),
           kontrak (OpenAPI/AsyncAPI), pemindaian dependensi + rahasia
        ──► Bangun citra (versi: semver + SHA), pindai (Trivy), SBOM, simpan di registry privat
        ──► Deploy ke STAGING otomatis ──► tes asap + E2E dashboard + skenario kritis
        ──► Persetujuan manual (pemilik) ──► Deploy ke PRODUKSI (bergulir)
        ──► Tes asap pascadeploy + pemantauan ketat 30 menit ──► (gagal? pembatalan otomatis/manual)
```

| Hal | Aturan |
|---|---|
| Artefak | **Citra yang sama** dari staging dipromosikan ke produksi (tidak dibangun ulang) |
| Konfigurasi | Dari kode + pengelola rahasia, bukan dari citra |
| Persetujuan | Rilis produksi butuh persetujuan manual (pemilik proyek) 🔶 |
| Alat CI | Mengikuti keputusan repositori (D-008). Seluruh langkah dipanggil lewat target `make` agar tidak terkunci pada penyedia |

### 9.4 Strategi rilis

| Hal | Rancangan |
|---|---|
| **Rilis bergulir** | Satu instance API diturunkan dari LB (dikuras), diperbarui, diperiksa siap, dikembalikan, lalu instance berikutnya. Worker dirilis bergiliran setelah API |
| **Migrasi basis data** | Dijalankan sebagai tugas terpisah **sebelum** aplikasi baru. Pola *expand/contract*: (1) tambah kolom/tabel tanpa merusak versi lama, (2) rilis aplikasi, (3) hapus yang usang pada rilis berikutnya. Tidak ada migrasi yang mengunci tabel besar tanpa rencana |
| **Pembatalan (rollback)** | Kembali ke citra sebelumnya. Migrasi tidak dibatalkan (perbaikan maju), karena kompatibel mundur |
| **Sambung ulang klien** | Penutupan anggun mengirim petunjuk sambung ulang berjeda acak agar tidak terjadi badai koneksi |
| **Kanari** | Opsional: 1 instance menerima sebagian kecil lalu lintas lebih dulu 🔶 |
| **Pembaruan lintas versi** | API tetap kompatibel dengan versi aplikasi mobile yang masih beredar (`min_app_version` hanya dinaikkan dengan sengaja) |

### 9.5 Pembekuan perubahan dan jendela pemeliharaan

| Aturan | Rincian |
|---|---|
| Jendela rilis | Pada jam beban terendah (mis. dini hari), di luar pergantian shift dispatcher |
| **Pembekuan perubahan** | Tidak ada rilis saat ada **alert tingkat tertinggi aktif**, bencana besar, atau acara besar yang diketahui. Hanya perbaikan darurat atas persetujuan pemilik |
| Pemberitahuan | Rilis dan pemeliharaan diumumkan kepada dispatcher dan stakeholder sebelumnya, dan lewat `system.notice` bila perlu |
| Rilis hari Jumat/menjelang libur | Dihindari |

### 9.6 Rilis aplikasi mobile dan dashboard

| Hal | Rancangan |
|---|---|
| **Android** | Dua aplikasi (`citizen`, `staff`). Distribusi warga lewat Play Store. Distribusi staf: Play Store (privat/tertutup) atau internal/MDM (keputusan terbuka dari dokumen FCM) 🔶. Rilis bertahap (*staged rollout*) dengan pemantauan galat |
| Penandatanganan | Keystore dijaga dan dicadangkan (bagian 7.4). Build rilis dengan `--obfuscate --split-debug-info`, simbol disimpan |
| Versi minimum | `min_app_version` memaksa pembaruan hanya bila ada ketidakcocokan yang tidak bisa dijembatani |
| **Perangkat staf** | Bila ponsel dinas dipakai, pertimbangkan manajemen perangkat (MDM/Android Enterprise) untuk kebijakan layar kunci, pengecualian baterai, dan penghapusan jarak jauh 🔶 |
| **Dashboard** | Aset statis ber-hash, `index.html` tanpa cache, versi dashboard kompatibel dengan versi API (pemeriksaan versi saat dimuat) |

---

## 10. Observabilitas dan Operasi

### 10.1 Komponen

| Fungsi | Alat (usulan) 🔶 |
|---|---|
| Metrik | Prometheus + exporter (node, PostgreSQL, Redis, Nginx), metrik aplikasi (`/metrics` internal) |
| Dasbor | Grafana |
| Peringatan | Alertmanager → kanal on-call (telepon/pesan) |
| Log | Log JSON terstruktur → pengumpul (Loki/Promtail atau setara). **Tanpa PII** (redaksi di sumber). Retensi mis. 90 hari 🔶 |
| Penelusuran | OpenTelemetry opsional |
| Pemeriksaan dari luar | Pemantau eksternal (HTTP + sertifikat) dari luar jaringan agar kegagalan edge terdeteksi |

### 10.2 Metrik utama

**Teknis:** latensi/galat per endpoint, CPU/memori/disk, koneksi DB, **lag replikasi**, ukuran WAL, memori Redis, kedalaman antrean BullMQ, jumlah koneksi WebSocket, kegagalan pengiriman FCM/SMS, masa berlaku sertifikat, usia cadangan terakhir.

**Bisnis/operasional (penting untuk layanan darurat):**

| Metrik | Mengapa penting |
|---|---|
| Laporan `SUBMITTED` yang menunggu > N menit | Dispatcher kewalahan atau tidak ada yang jaga |
| Waktu laporan → verifikasi, offer → accept | Kualitas layanan |
| Persentase offer `EXPIRED` / `offer_unseen` | Responder tidak terjangkau (masalah push/aplikasi) |
| **Backlog `outbox_events` belum diproses** dan umur baris tertua | Event realtime tertahan |
| Latensi event realtime (commit → emit) | Janji "< 1 detik" |
| Jumlah responder dengan `push_enabled = false` atau token basi | Kesiapan responder |
| Laju laporan dan pola lonjakan | Deteksi bencana dan perencanaan kapasitas |
| Kegagalan login/OTP | Penyalahgunaan atau gangguan SMS |

### 10.3 Peringatan (usulan ambang) 🔶

| Tingkat | Kondisi | Tindakan |
|---|---|---|
| **P1 (segera, 24×7)** | API/WebSocket tidak tersedia dari luar; PostgreSQL primer tidak tersedia; **backlog outbox > 30 detik**; antrean `offer-timeout` macet; error 5xx > 5% selama 2 menit; disk data > 90% | Telepon penanggung jawab on-call, jalankan runbook |
| **P2 (jam kerja/ cepat)** | Lag replikasi > 30 detik; memori Redis > 80%; kegagalan pengiriman FCM > 10%; sertifikat kedaluwarsa < 14 hari; cadangan terakhir > 26 jam; node aplikasi keluar dari rotasi | Tangani dalam beberapa jam |
| **P3 (informasi)** | Pola lonjakan laporan, pertumbuhan disk, ambang kapasitas 70% | Tinjau mingguan |

Pemantauan sintetis: pemeriksaan dari luar atas login, koneksi WebSocket, dan endpoint baca. **Laporan sintetis penuh** (membuat incident uji) di produksi hanya bila ada tanda canary yang membuatnya tidak muncul di antrean dispatcher (bagian 8.2 poin 15). Jalur penuh diuji di staging.

### 10.4 On-call dan pelaporan

- Roster on-call dan jalur eskalasi ditetapkan 🔶 (siapa, jam berapa, kontak cadangan).
- Setiap insiden P1 dicatat, ditinjau setelahnya (*post-mortem tanpa menyalahkan*), tindakan perbaikan dilacak.
- Laporan operasional bulanan: ketersediaan, insiden, kapasitas, kepatuhan cadangan.

---

## 11. Degradasi, Pemulihan Bencana, dan Kontinuitas

### 11.1 Matriks degradasi (apa yang tetap berjalan)

| Komponen jatuh | Dampak | Yang **harus tetap** berjalan | Tindakan |
|---|---|---|---|
| Satu node API | Koneksi putus sebagian | Node lain melayani. Klien sambung ulang otomatis | Otomatis, perbaiki node |
| Semua worker | Pewaktu offer, FCM, outbox berhenti | Penerimaan laporan, dispatch manual | P1. Penyapu dan pemrosesan outbox mengejar setelah pulih (idempoten) |
| **Redis** | Realtime lintas instance, antrean, rate limit, idempotensi terganggu | **Penerimaan laporan tetap berjalan** (rate limiter *fail-open*, idempotensi laporan lewat constraint DB). Dashboard memakai polling `/sync/events` | P1. Event tidak hilang (ada di `outbox_events` PostgreSQL) |
| Object storage | Lampiran tidak dapat diunggah/dilihat | Laporan teks dan lokasi, dispatch, semua alur inti | Pesan "foto menyusul". Lampiran dikirim ulang oleh aplikasi |
| **FCM** | Push tidak sampai | Realtime lewat WebSocket, eskalasi `offer_unseen` ke dispatcher, telepon | P2. Dispatcher menghubungi unit lewat telepon |
| **Penyedia SMS** | OTP tidak terkirim | Pengguna terdaftar tetap login (sesi aktif). Laporan dari sesi yang ada tetap diterima | P2. Penyedia cadangan. Tampilkan nomor darurat |
| PostgreSQL primer | Penulisan berhenti | Failover otomatis ke replika. Selama peralihan: aplikasi mencoba ulang, aplikasi warga menyimpan di **outbox lokal**, **nomor telepon darurat tetap terlihat** | P1. Runbook failover |
| Seluruh situs utama | Layanan mati | Prosedur manual (11.3) + aktifkan situs DR (11.2) | Keputusan pemilik/komando |
| Pemantauan | Buta | Layanan tetap berjalan | P2. Pemeriksaan eksternal tetap aktif |

### 11.2 Pemulihan bencana (DR)

| Hal | Rancangan |
|---|---|
| Model | **Warm standby** di situs terpisah (lokasi geografis berbeda, tetap di Indonesia) |
| Data | Replikasi streaming PostgreSQL asinkron ke DR (RPO ≤ 5 menit pada pilot), arsip WAL ke penyimpanan terpisah, replikasi objek, cadangan terenkripsi di luar situs |
| Aplikasi | Citra tersedia di registry cadangan. Konfigurasi dan rahasia dapat diterapkan lewat IaC |
| **Pengalihan** | **Keputusan manual** oleh pemilik/penanggung jawab (hindari *split-brain*). Langkah: pastikan situs utama benar-benar mati → promosikan replika DR → arahkan DNS (TTL rendah, mis. 60 detik) atau VIP → verifikasi dengan tes asap → umumkan |
| Setelah pulih | Pemulihan situs utama sebagai replika, rencana kembali (*fail-back*) terjadwal. Tinjauan |
| Uji | **DR drill** minimal dua kali setahun (satu per semester), hasil dicatat dan diperbaiki |
| Redis | Tidak direplikasi lintas situs. Dibangun ulang kosong di DR (data penting ada di PostgreSQL). Sesi WebSocket tersambung ulang |

### 11.3 Prosedur manual saat sistem tidak tersedia (SOP kontinuitas)

Disusun bersama dispatcher dan stakeholder, dilatih berkala.

1. **Deteksi dan pengumuman:** dispatcher/pemantau menyatakan sistem tidak tersedia. Pengumuman ke stakeholder lewat kanal cadangan (grup pesan/telepon).
2. **Jalur laporan:** warga diarahkan ke **nomor telepon darurat** (sudah tampil di aplikasi dan tersimpan offline). Dispatcher menerima telepon dan mencatat di **formulir/lembar manual** (waktu, lokasi, kejadian, unit, status).
3. **Dispatch:** lewat telepon/radio/WhatsApp (jalur yang selama ini dipakai).
4. **Pencatatan susulan:** setelah sistem pulih, kejadian selama gangguan dimasukkan lewat **input manual** dan **catat atas nama unit** dengan `occurredAt` sesuai lembar manual (fitur yang memang disediakan).
5. **Pelaporan:** laporan insiden gangguan dan tinjauan.

Aplikasi warga dan staf sudah dirancang mendukung ini: nomor darurat tersimpan offline, laporan masuk antrean lokal dan terkirim otomatis saat pulih, `system.notice` dapat mengumumkan kondisi.

---

## 12. Insiden Keamanan dan Runbook

### 12.1 Runbook yang disiapkan (templat tertulis, dilatih)

| Runbook | Isi inti |
|---|---|
| Failover PostgreSQL | Cek lag, promosikan replika, arahkan PgBouncer/aplikasi, verifikasi, bangun ulang replika |
| Failover Redis | Sentinel, verifikasi antrean BullMQ, jalankan penyapu |
| Backlog outbox / worker macet | Diagnosis, restart worker, tinjau baris bermasalah |
| FCM gangguan | Tetap WebSocket, informasikan dispatcher, pantau |
| Disk penuh | Sumber (WAL, log, objek), pembersihan aman, perluasan |
| Sertifikat kedaluwarsa | Perpanjangan manual cadangan |
| **Alert massal keliru terkirim** | Tutup alert segera (`close`), kirim alert koreksi, catat insiden, tinjau konfirmasi dua langkah |
| Akun staf diduga disusupi | Nonaktifkan akun (mencabut sesi dan token), tinjau audit, ganti kredensial |
| Dugaan kebocoran data pribadi | Lihat 12.2 |
| Serangan DDoS/penyalahgunaan | Aktifkan perlindungan penyedia, perketat batas laju, blokir sumber |
| Pemulihan dari cadangan (PITR) | Prosedur dan verifikasi |
| Pergantian kunci (JWT, kredensial) | Jendela dan langkah |

### 12.2 Dugaan kebocoran data pribadi 🔶

1. Tahan dan bendung (cabut akses, isolasi).
2. Nilai cakupan: data apa, berapa orang, sejak kapan (audit log, log akses).
3. **Pemberitahuan** kepada pihak berwenang dan subjek data **dalam jangka waktu yang ditentukan UU PDP** (ditetapkan bersama bagian hukum, umumnya disebut 3 × 24 jam).
4. Pemulihan, perbaikan akar masalah, laporan.

Peran dan penanggung jawab ditetapkan sebelum go-live (bagian 15).

---

## 13. Operasi Data

### 13.1 PostgreSQL + PostGIS

| Hal | Rancangan |
|---|---|
| Versi | PostgreSQL 15+ dengan PostGIS. Versi dipin dan diuji sebelum peningkatan |
| Pooling | PgBouncer mode transaksi. Pendengar outbox lewat koneksi langsung |
| Penyetelan | `shared_buffers`, `work_mem`, `effective_cache_size`, `max_connections` disetel berdasarkan uji beban (bukan salinan konfigurasi umum) |
| **Cadangan** | **pgBackRest**: penuh mingguan, diferensial harian, **arsip WAL berkelanjutan** (PITR). Disimpan terenkripsi di penyimpanan terpisah **dan** di situs DR. Retensi mis. 14-30 hari 🔶 |
| **Uji pemulihan** | **Setiap bulan**: pulihkan ke lingkungan terpisah, jalankan `seed:verify`-setara/uji konsistensi, catat waktu pemulihan (memvalidasi RTO). Cadangan yang tidak pernah diuji dianggap tidak ada |
| Pemeliharaan | Autovacuum dipantau (bloat), `ANALYZE` setelah impor besar, pemeliharaan indeks GiST |
| Partisi | `incident_events`, `audit_logs`, `notification_deliveries` dipartisi per bulan ketika membesar. Partisi lama diarsipkan/dianonimkan sesuai retensi |
| Migrasi | Tugas terpisah, kompatibel mundur (bagian 9.4) |
| Akun | Akun terpisah untuk aplikasi, worker, cadangan, dan analitik hanya-baca. Tidak ada akses superuser dari aplikasi |
| Kapasitas | Pantau pertumbuhan, indeks, dan kueri lambat (`pg_stat_statements`) |

### 13.2 Redis

| Hal | Rancangan |
|---|---|
| Persistensi | AOF `everysec` (+ RDB berkala). Kehilangan sebagian kecil data Redis dapat diterima karena kebenaran ada di PostgreSQL |
| Kebijakan memori | **`noeviction`** (pewaktu/antrean BullMQ tidak boleh terbuang diam-diam). Alarm pada 80% |
| Isi | Antrean, idempotensi, rate limit, presence, adapter Socket.IO. **Bukan** sumber kebenaran |
| Kegagalan | Lihat 11.1. Pewaktu offer punya penyapu di PostgreSQL sebagai pengaman |

### 13.3 Object storage

| Hal | Rancangan |
|---|---|
| Bucket | `attachments` (privat). Tidak ada akses publik anonim |
| Akses | Unggah dan unduh lewat **URL bertanda tangan** berumur pendek melalui `files.example.id`. CORS hanya untuk origin yang berhak |
| Siklus hidup | Hapus `PENDING` > 24 jam, kebijakan retensi/pemindahan tier sesuai keputusan retensi 🔶 |
| Replikasi | Ke situs DR |
| Pemindaian | Pemindaian malware dan pembuangan EXIF (bagian 7.2) 🔶 |
| Cadangan | Replikasi + versioning bila dibutuhkan untuk pemulihan dari penghapusan tak sengaja |

### 13.4 Retensi dan anonimisasi 🔶

| Data | Usulan retensi (perlu keputusan instansi/hukum) |
|---|---|
| Incident, dispatch, event (data operasional) | Jangka panjang (mis. beberapa tahun) untuk evaluasi dan statistik |
| Identitas dan kontak pelapor, lokasi presisi | Dibatasi: dianonimkan setelah periode tertentu (mis. 12 bulan), statistik tetap |
| Lampiran | Periode lebih pendek dari data operasional |
| `audit_logs` | Panjang (akuntabilitas), append-only |
| Log aplikasi | 90 hari, tanpa PII |
| Cadangan | Mengikuti siklus rotasi (tidak diubah per permintaan penghapusan, kedaluwarsa menurut jadwal) |

Job `retention` (diaktifkan di produksi) menjalankan anonimisasi sesuai keputusan. Permintaan penghapusan oleh subjek data ditangani lewat prosedur terdokumentasi.

---

## 14. Uji Beban, Kekacauan, dan Pemulihan

Seluruh uji dijalankan di **staging** (ukuran mirip produksi) **sebelum go-live** dan diulang pada perubahan besar.

### 14.1 Uji beban

| Skenario | Alat/cara | Kriteria lulus (usulan) 🔶 |
|---|---|---|
| **Lonjakan laporan banjir** | `sim:flood --help=300 --rate=300` selama 10 menit | Tidak ada laporan ditolak karena kapasitas, p95 REST < 500 ms (tulis), event → dispatcher p95 < 1 detik, CPU DB < 60% |
| Koneksi WebSocket serentak | Pembangkit beban (mis. k6/artillery dengan klien Socket.IO) | 5.000 koneksi warga + 200 staf stabil, memori tidak naik terus |
| Banyak offer serentak | 100 dispatch/menit dengan bot responder | Eskalasi 20/60/120 detik tepat waktu, tidak ada offer terlewat |
| **Alert massal** | Alert ke seluruh kota (topic) dan ke geofence besar | Pengiriman selesai dalam batas waktu, job tidak menumpuk |
| Tahan lama (*soak*) | Beban sedang 24-48 jam | Tidak ada kebocoran memori/koneksi, ukuran WAL terkendali |
| Lonjakan sambung ulang | Putus 1.000 klien lalu sambung bersamaan | Server tetap stabil (jeda acak berfungsi) |

### 14.2 Uji kekacauan dan kegagalan (*chaos*)

| Uji | Hasil yang diharapkan |
|---|---|
| Matikan satu node API | Klien tersambung ulang < 10 detik, tidak ada laporan hilang |
| Matikan seluruh worker 2 menit lalu nyalakan | Pewaktu dan outbox mengejar, tidak ada event hilang/ganda yang merusak |
| **Matikan Redis** | Laporan tetap diterima, dashboard beralih ke polling, setelah pulih sinkron tanpa duplikat |
| Failover PostgreSQL | Pemulihan otomatis dalam target RTO, tidak ada laporan hilang (laporan dari warga masuk antrean lokal) |
| Putuskan object storage | Laporan teks tetap diterima, foto menyusul |
| Blokir FCM | WebSocket tetap, `offer_unseen` sampai ke dispatcher |
| Jam server melenceng | Pewaktu tetap benar (NTP dipantau), hitung mundur memakai jam server |
| **Pemulihan dari cadangan** | Lingkungan baru pulih dari cadangan dalam waktu target, data konsisten |
| **DR drill** | Situs cadangan aktif dalam target RTO |
| Bangun ulang server dari nol | Dari IaC dan rahasia, layanan berfungsi tanpa langkah manual tak terdokumentasi |

### 14.3 Uji keamanan

- Pemindaian kerentanan (dependensi, citra, host) dan uji penetrasi independen sebelum go-live 🔶.
- Pengujian kebocoran data: lokasi presisi dan kontak pelapor tidak muncul di log, payload push, atau respons yang tidak berhak (tes otomatis yang sudah ada + tinjauan manual).
- Uji pembatasan akses jaringan (aturan bagian 7.1) dan penyalahgunaan (rate limit, OTP).

---

## 15. Go-Live

### 15.1 Tahapan peluncuran

| Tahap | Isi | Syarat lanjut |
|---|---|---|
| **1. Staging dan UAT** | Instansi dan stakeholder mencoba dengan data fiktif/teranonimkan, latihan skrip demo | Semua skenario penerimaan lulus, masukan UAT ditangani |
| **2. Gladi** | Latihan sistem + SOP manual (11.3) + DR drill | Gladi sukses, peran dan kontak jelas |
| **3. Pilot terbatas** | Satu wilayah (mis. satu kecamatan) dan beberapa stakeholder (mis. 1-2 IGD, 1 pos damkar, BPBD) dengan jam operasional jelas | Metrik dan masukan baik selama periode pilot (mis. 4-8 minggu) 🔶 |
| **4. Perluasan** | Bertahap ke seluruh kota | Stabil, kapasitas terbukti |
| **Hypercare** | Dukungan intensif pada minggu-minggu awal tiap tahap | |

Selama pilot, sistem berjalan **berdampingan** dengan jalur lama (telepon/WhatsApp), tidak menggantikannya.

### 15.2 Metrik keberhasilan pilot (usulan) 🔶

Waktu laporan → verifikasi, offer → accept, persentase offer terlihat dalam 60 detik, jumlah laporan palsu/INVALID, kepuasan dispatcher dan stakeholder, gangguan layanan dan pemulihannya, jumlah laporan yang masuk di luar jam operasional.

### 15.3 Daftar periksa go-live

| Area | Item | Penanggung jawab |
|---|---|---|
| **Hukum & kepatuhan** | Status penyelenggara sistem elektronik dan pendaftarannya; lokasi data dan situs cadangan sesuai ketentuan; kebijakan privasi dan teks persetujuan (lokasi, kamera, notifikasi) di aplikasi; penilaian dampak pelindungan data; penunjukan pejabat pelindungan data bila diwajibkan; perjanjian pemrosesan data (hosting, SMS, FCM); prosedur insiden data | Instansi/hukum |
| **Operasional** | Jadwal jaga dispatcher (jam operasional jelas); MoU/kesepakatan dengan stakeholder; SOP manual (11.3) dilatih; roster on-call; jalur eskalasi; pelatihan dispatcher, supervisor, admin organisasi, responder | Pemilik/instansi |
| **Teknis: infrastruktur** | Topologi sesuai bagian 4; segmentasi dan firewall; TLS; DDoS/WAF; NTP; pengerasan host; IaC teruji bangun-ulang | Tim teknis |
| **Teknis: data** | Cadangan berjalan **dan pemulihan teruji**; replikasi DR; retensi dikonfigurasi; akun DB terpisah | Tim teknis |
| **Teknis: aplikasi** | Konfigurasi produksi (bagian 8.1); `seed` dinonaktifkan; nomor darurat resmi; penyedia SMS nyata; 2FA aktif; proyek Firebase `prod`; cookie HttpOnly; Swagger dan source map mati | Tim teknis |
| **Pemantauan** | Metrik, peringatan, dasbor, pemeriksaan eksternal; ambang diuji (peringatan benar-benar sampai) | Tim teknis |
| **Uji** | Uji beban, kekacauan, DR, keamanan lulus (bagian 14) | Tim teknis |
| **Rilis aplikasi** | Aplikasi di Play Store/distribusi internal, keystore dicadangkan, rilis bertahap, `min_app_version` | Tim teknis |
| **Komunikasi** | Panduan untuk warga (cara lapor, nomor darurat tetap), pengumuman peluncuran, bantuan | Instansi |
| **Keputusan rollback** | Kriteria dan wewenang membatalkan peluncuran dan kembali ke jalur manual | Pemilik |

---

## 16. Pendorong Biaya (Kualitatif)

Tidak ada angka biaya di dokumen ini karena bergantung pada instansi dan penyedia.

| Pendorong | Catatan |
|---|---|
| Hosting (server/VM, jaringan, penyimpanan, situs DR) | Biaya terbesar yang berulang. Dipengaruhi opsi A/B/C (bagian 3) |
| Penyimpanan berkas dan cadangan | Tumbuh seiring jumlah laporan dan retensi |
| **SMS OTP** | Biaya per pesan. Dikendalikan dengan batas laju dan deteksi penyalahgunaan |
| Perlindungan DDoS/WAF | Bergantung penyedia |
| Layanan peta/tile | Tile sendiri (biaya server) atau berlangganan |
| Pemantauan dan log | Server pemantauan dan retensi |
| Akun pengembang toko aplikasi | Biaya tahunan/sekali bayar |
| FCM | Tanpa biaya langsung |
| Tenaga operasi | On-call, pemeliharaan, pembaruan keamanan, DR drill. Sering terlupakan tetapi signifikan |
| Uji keamanan independen | Berkala |
| Lisensi perangkat lunak | Semua komponen inti open source (PostgreSQL, PostGIS, Redis/Valkey, Nginx, Prometheus, Grafana, MinIO) |

---

## 17. Asumsi Default dan Keputusan Terbuka 🔶

| Hal | Default rancangan |
|---|---|
| Hosting | Dirancang portabel. Data di Indonesia, termasuk DR. Pilihan A/B/C menunggu instansi |
| Orkestrasi | Docker Compose + Ansible (pilot). Dapat pindah ke Swarm/Kubernetes |
| Topologi | 2 edge, 2 API, 2 worker, PostgreSQL primer+replika, Redis primer+replika+Sentinel, object storage S3-kompatibel, pemantauan terpisah, DR warm standby |
| Target layanan | 99,5% pilot, 99,9% produksi, RPO ≤ 5 menit, RTO ≤ 60 menit (pilot) |
| Pengalihan DR | Manual |
| Peta | Tile produksi sendiri/berlisensi (bukan tile publik OSM) |
| SMS | Penyedia domestik, dua penyedia bila memungkinkan |
| Retensi | Diaktifkan, angka final ditentukan instansi/hukum |
| Persetujuan rilis produksi | Manual oleh pemilik proyek |
| Uji sebelum go-live | Beban, kekacauan, DR, keamanan (bagian 14) |

### Pertanyaan untuk instansi/stakeholder

1. Di mana sistem akan dihosting (pusat data pemda, penyedia domestik, atau lainnya), dan apakah ada situs kedua untuk DR?
2. Siapa penyelenggara/pemilik sistem elektronik ini secara hukum, dan siapa yang mengurus pendaftaran serta penilaian dampak pelindungan data?
3. Siapa yang menjadi on-call 24 jam dan siapa penanggung jawab keputusan darurat (termasuk pengalihan DR dan rollback)?
4. Apakah ada standar keamanan atau sertifikasi yang wajib dipenuhi instansi (mis. kebijakan keamanan informasi pemda)?
5. Penyedia SMS mana yang sudah dipakai pemda atau diizinkan?
6. Kebijakan retensi data laporan dan lokasi yang dikehendaki?
7. Apakah ponsel stakeholder dikelola (MDM) atau ponsel pribadi, dan bagaimana distribusi aplikasi staf?
8. Anggaran dan jangka waktu pilot?

---

## 18. Di Luar Cakupan Dokumen Ini

- Kode Ansible/Terraform, berkas Compose produksi, dan skrip pipeline (dikerjakan pada Fase 7 berdasarkan dokumen ini).
- Pemilihan vendor dan penawaran harga.
- Prosedur internal instansi (SOP manual terperinci, kebijakan keamanan informasi pemda).
- Penilaian dampak pelindungan data dan dokumen hukum (disusun oleh pihak berwenang).
- Integrasi dengan Command Center 112 (fase lanjutan).
