# Data Seed dan Skrip Demo v1: Aplikasi Sampel

> Status: draft v1 (spesifikasi data dan skenario, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `erd-aplikasi-darurat.md` (v1.2), `rest-api-aplikasi-darurat.md`, `websocket-aplikasi-darurat.md`, `fcm-aplikasi-darurat.md`, `flutter-aplikasi-darurat.md`, `dashboard-aplikasi-darurat.md`
> Tujuan: seluruh data awal dan urutan demo yang diperlukan agar aplikasi sampel bisa dijalankan dan **didemokan ke client** tanpa data nyata.
> Tanda 🔶 = asumsi yang perlu dikonfirmasi setelah sampel.

---

## 1. Prinsip

| Prinsip | Penjelasan |
|---|---|
| **Fiktif sepenuhnya** | Kota, kecamatan, kelurahan, organisasi, nama, dan nomor telepon adalah rekaan. Nama wilayah memakai kode `99.99.*` agar tidak bertabrakan dengan kode wilayah resmi. Contoh yang memakai nama nyata di dokumen lain bersifat ilustrasi |
| **Nomor darurat contoh** | Tombol telepon darurat di sampel memakai **nomor contoh** (bukan 112/110/113/118/119 asli), supaya demo tidak menelepon layanan sungguhan. Penggantian ke nomor resmi dilakukan lewat pengaturan sistem saat produksi |
| **Deterministik dan idempoten** | Setiap entitas seed punya id tetap (UUIDv5 dari `seed:{entitas}:{kode}` dengan namespace tetap). Menjalankan seed berulang tidak menggandakan data |
| **Berpenanda** | Setiap baris seed diberi `meta.seed = true` agar dapat dibersihkan tanpa menyentuh data lain |
| **Berlapis (profil)** | Data dipisah per profil (bagian 2) sehingga bisa dimulai dari kosong, dengan riwayat, atau dalam keadaan bersih sebelum demo |
| **Tidak boleh di produksi** | Seed menolak berjalan bila `ENV=prod` (kecuali bendera eksplisit yang tidak dipakai di sampel). Akun demo memakai sandi sederhana dan tidak pernah boleh ada di produksi |
| **Dapat diverifikasi** | Ada pemeriksaan otomatis (bagian 12) yang memastikan data konsisten |

---

## 2. Profil Seed dan Perintah (spesifikasi)

Nama perintah hanya usulan untuk agent code (skrip npm/CLI di backend).

| Profil / perintah | Isi | Kapan dipakai |
|---|---|---|
| `seed:base` | Referensi + wilayah + organisasi + unit + role/permission + akun + jenis kejadian + pengaturan (bagian 3-8) | Wajib, dasar semua lingkungan sampel |
| `seed:history` | Riwayat incident 7 hari terakhir (bagian 9) | Agar halaman ringkasan dan riwayat tidak kosong |
| `seed:reset-live` | Menghapus data operasional (incident, laporan, dispatch, event, notifikasi, lampiran) tetapi **mempertahankan** data dasar | Sebelum tiap sesi demo |
| `seed:verify` | Menjalankan pemeriksaan bagian 12 | Setelah seed, dan sebelum demo |
| `sim:bot` | Responder tiruan untuk unit yang tidak punya ponsel (bagian 10.1) | Demo dengan sedikit perangkat |
| `sim:flood` | Pembangkit laporan banjir massal (bagian 10.2) | Adegan banjir dan uji beban |
| `sim:citizen` | Pembangkit laporan warga acak (bagian 10.3) | Uji beban dan isi antrean |

---

## 3. Wilayah Fiktif

**Kota Contoh** (`99.99`), tiga kecamatan, enam kelurahan. Semua batas berupa **persegi panjang sederhana** (bukan batas administratif sungguhan). Koordinat dalam urutan **(lng, lat)** untuk WKT, dengan SRID 4326.

| Tingkat | Kode | Nama | bbox (minLng, minLat, maxLng, maxLat) |
|---|---|---|---|
| CITY | `99.99` | Kota Contoh | 112.650, -7.350, 112.800, -7.200 |
| DISTRICT | `99.99.01` | Kec. Sinar (utara) | 112.650, -7.250, 112.800, -7.200 |
| DISTRICT | `99.99.02` | Kec. Bukit (tengah) | 112.650, -7.300, 112.800, -7.250 |
| DISTRICT | `99.99.03` | Kec. Muara (selatan) | 112.650, -7.350, 112.800, -7.300 |
| VILLAGE | `99.99.01.1001` | Kel. Mawar | 112.650, -7.250, 112.725, -7.200 |
| VILLAGE | `99.99.01.1002` | Kel. Melati | 112.725, -7.250, 112.800, -7.200 |
| VILLAGE | `99.99.02.1001` | Kel. Anggrek | 112.650, -7.300, 112.725, -7.250 |
| VILLAGE | `99.99.02.1002` | Kel. Kenanga | 112.725, -7.300, 112.800, -7.250 |
| VILLAGE | `99.99.03.1001` | Kel. Pesisir | 112.650, -7.350, 112.725, -7.300 |
| VILLAGE | `99.99.03.1002` | Kel. Nelayan | 112.725, -7.350, 112.800, -7.300 |

Aturan: `boundary` tiap wilayah = `MultiPolygon` persegi dari bbox di atas, `centroid` = titik tengah bbox. Contoh WKT untuk Kec. Muara:

```
MULTIPOLYGON(((112.650 -7.350, 112.800 -7.350, 112.800 -7.300, 112.650 -7.300, 112.650 -7.350)))
```

FCM topic yang terbentuk (lingkungan `dev`): `dev_city`, `dev_kec_999901`, `dev_kec_999902`, `dev_kec_999903`.

Titik pusat peta default: `lat -7.275, lng 112.725`, zoom 12.

---

## 4. Organisasi, Wilayah Layanan, dan Unit

### 4.1 Organisasi

| Kode | Jenis | Nama | Lokasi (lat, lng) | Telepon operasional (contoh) | Wilayah layanan |
|---|---|---|---|---|---|
| `CC` | `COMMAND_CENTER` | Pusat Komando Kota Contoh | -7.265, 112.725 | 000-0000-0001 | Semua |
| `POLRES` | `POLICE` | Polres Kota Contoh | -7.270, 112.700 | 000-0000-0010 | Semua kecamatan |
| `DAMKAR` | `FIRE` | Dinas Pemadam Kebakaran Kota Contoh | -7.280, 112.760 | 000-0000-0020 | Semua kecamatan |
| `RSUD` | `HOSPITAL` | RSUD Kota Contoh | -7.285, 112.740 | 000-0000-0030 | Kec. Sinar, Kec. Bukit |
| `RSPM` | `HOSPITAL` | RS Pratama Muara | -7.325, 112.760 | 000-0000-0031 | Kec. Muara |
| `AMBULANS` | `AMBULANCE_SERVICE` | Layanan Ambulans Kota Contoh | -7.275, 112.720 | 000-0000-0040 | Semua kecamatan |
| `BPBD` | `BPBD` | BPBD Kota Contoh | -7.290, 112.680 | 000-0000-0050 | Semua kecamatan |

Tidak di-seed (ditunda sesuai keputusan): organisasi `PRIVATE_FIRE` (pemadam swasta), Dishub, Jasa Raharja, kamar jenazah. Keberadaan mereka dicatat lewat milestone, bukan sebagai stakeholder terdaftar.

### 4.2 Unit

| Kode unit | Organisasi | Jenis | Nama | Posisi awal (lat, lng) | Status awal |
|---|---|---|---|---|---|
| `PATROL-01` | `POLRES` | `PATROL` | Patroli 01 | -7.272, 112.705 | `AVAILABLE` |
| `PATROL-02` | `POLRES` | `PATROL` | Patroli 02 | -7.320, 112.740 | `AVAILABLE` |
| `DMK-01` | `DAMKAR` | `FIRE_ENGINE` | Mobil Pemadam Pos Utara | -7.220, 112.720 | `AVAILABLE` |
| `DMK-02` | `DAMKAR` | `FIRE_ENGINE` | Mobil Pemadam Pos Selatan | -7.330, 112.750 | `AVAILABLE` |
| `DMK-03` | `DAMKAR` | `FIRE_ENGINE` | Mobil Pemadam Pos Tengah | -7.280, 112.760 | `AVAILABLE` |
| `AMB-01` | `AMBULANS` | `AMBULANCE` | Ambulans 01 (Utara) | -7.230, 112.750 | `AVAILABLE` |
| `AMB-02` | `AMBULANS` | `AMBULANCE` | Ambulans 02 (Tengah) | -7.275, 112.720 | `AVAILABLE` |
| `AMB-03` | `AMBULANS` | `AMBULANCE` | Ambulans 03 (Selatan) | -7.320, 112.730 | `AVAILABLE` |
| `IGD-01` | `RSUD` | `ER` | IGD RSUD Kota Contoh | -7.285, 112.740 | `AVAILABLE` |
| `IGD-02` | `RSPM` | `ER` | IGD RS Pratama Muara | -7.325, 112.760 | `AVAILABLE` |
| `RESCUE-01` | `BPBD` | `RESCUE_TEAM` | Tim Reaksi Cepat 01 | -7.290, 112.680 | `AVAILABLE` |
| `RESCUE-02` | `BPBD` | `RESCUE_TEAM` | Tim Reaksi Cepat 02 | -7.335, 112.680 | `AVAILABLE` |

Rekomendasi unit yang diharapkan pada adegan kecelakaan (lokasi -7.275, 112.730): `AMB-02` (±1,1 km) lebih dekat daripada `AMB-03` dan `AMB-01`. Ini dipakai pada skrip demo.

---

## 5. Role dan Permission

Daftar permission mengikuti katalog di dokumen REST (bagian 3). Pemetaan ke role pada sampel:

| Role | Permission |
|---|---|
| `CITIZEN` | `report.create`, `report.read_own` |
| `RESPONDER` | `incident.read_related`, `casualty.update`, `milestone.create`, `dispatch.respond`, `dispatch.self_initiate`, `resource_request.create`, `unit.update_own` |
| `ORG_ADMIN` | `org.manage_own`, `staff.manage_own`, `audit.read_own_org` |
| `ALERT_MANAGER` | `alert.create`, `alert.close`, `condition_report.read` |
| `DISPATCHER` | `report.create`, `incident.read_all`, `incident.create_manual`, `incident.lock`, `incident.update`, `incident.verify`, `incident.invalidate`, `incident.merge`, `incident.set_lead`, `incident.close`, `note.create`, `casualty.update`, `milestone.create`, `dispatch.create`, `dispatch.record_on_behalf`, `dispatch.cancel`, `resource_request.decide`, `pii.reveal_reporter`, `alert.create`, `alert.close`, `condition_report.read`, `shift.manage`, `dashboard.read` |
| `SUPERVISOR` | Semua permission `DISPATCHER` + `incident.lock_override`, `audit.read_all` |
| `SUPER_ADMIN` | `org.manage_all`, `staff.manage_all`, `role.manage`, `settings.manage`, `audit.read_all`, `incident.read_all` (baca), `dashboard.read` |

Catatan keputusan sampel:
- **Role tambahan `ALERT_MANAGER`** diberikan kepada admin BPBD. Dengan begitu hak membuat alert tidak ditempelkan pada seluruh `ORG_ADMIN` (admin RSUD tidak otomatis boleh membuat alert bencana). Ini menjawab poin "siapa berwenang membuat alert" dengan default yang aman. 🔶
- `SUPER_ADMIN` boleh membaca antrean, tetapi tidak punya permission aksi incident (sesuai prinsip pemisahan konfigurasi dan operasional).
- Satu akun boleh memiliki lebih dari satu role (tabel `user_roles`).

---

## 6. Akun Demo

Kata sandi seluruh akun staf pada sampel: **`Contoh#2026`** (`mustChangePassword = false`, 2FA dimatikan). Warga masuk dengan OTP tetap **`123456`** (penyedia OTP `mock`). Pengidentifikasi login staf: email atau nomor telepon.

### 6.1 Command Center dan administrasi

| Email | Telepon | Nama | Role | Organisasi |
|---|---|---|---|---|
| `superadmin@contoh.test` | 0800-0000-1001 | Super Admin | `SUPER_ADMIN` | `CC` |
| `supervisor@contoh.test` | 0800-0000-1002 | Supervisor Hendra | `SUPERVISOR` | `CC` |
| `dispatcher1@contoh.test` | 0800-0000-1003 | Dispatcher Rina | `DISPATCHER` | `CC` |
| `dispatcher2@contoh.test` | 0800-0000-1004 | Dispatcher Agus | `DISPATCHER` | `CC` |
| `admin.polres@contoh.test` | 0800-0000-1011 | Admin Polres | `ORG_ADMIN` | `POLRES` |
| `admin.damkar@contoh.test` | 0800-0000-1012 | Admin Damkar | `ORG_ADMIN` | `DAMKAR` |
| `admin.rsud@contoh.test` | 0800-0000-1013 | Admin RSUD | `ORG_ADMIN` | `RSUD` |
| `admin.ambulans@contoh.test` | 0800-0000-1014 | Admin Ambulans | `ORG_ADMIN` | `AMBULANS` |
| `admin.bpbd@contoh.test` | 0800-0000-1015 | Admin BPBD | `ORG_ADMIN` + `ALERT_MANAGER` | `BPBD` |

### 6.2 Responder (aplikasi staf)

| Email | Telepon | Nama | Organisasi | Unit |
|---|---|---|---|---|
| `resp.patroli1@contoh.test` | 0800-0000-2001 | Bripka Dedi | `POLRES` | `PATROL-01` |
| `resp.patroli2@contoh.test` | 0800-0000-2002 | Bripka Eko | `POLRES` | `PATROL-02` |
| `resp.damkar1@contoh.test` | 0800-0000-2011 | Petugas Fajar | `DAMKAR` | `DMK-01` |
| `resp.damkar2@contoh.test` | 0800-0000-2012 | Petugas Gilang | `DAMKAR` | `DMK-02` |
| `resp.damkar3@contoh.test` | 0800-0000-2013 | Petugas Hadi | `DAMKAR` | `DMK-03` |
| `resp.amb1@contoh.test` | 0800-0000-2021 | Paramedis Indra | `AMBULANS` | `AMB-01` |
| `resp.amb2@contoh.test` | 0800-0000-2022 | Paramedis Joko | `AMBULANS` | `AMB-02` |
| `resp.amb3@contoh.test` | 0800-0000-2023 | Paramedis Kiki | `AMBULANS` | `AMB-03` |
| `resp.igd1@contoh.test` | 0800-0000-2031 | Perawat Lina | `RSUD` | `IGD-01` |
| `resp.igd2@contoh.test` | 0800-0000-2032 | Perawat Mira | `RSPM` | `IGD-02` |
| `resp.bpbd1@contoh.test` | 0800-0000-2041 | Relawan Nanda | `BPBD` | `RESCUE-01` |
| `resp.bpbd2@contoh.test` | 0800-0000-2042 | Relawan Oki | `BPBD` | `RESCUE-02` |

Seluruh responder berperan `RESPONDER`. Satu pengguna dapat berpindah akun pada satu ponsel selama demo (perangkat dipakai bergantian dilayani oleh aturan pengikatan token).

### 6.3 Warga (aplikasi warga)

| Telepon | Nama | Lokasi rumah | Reputasi | Peran dalam demo |
|---|---|---|---|---|
| 0812-0000-0001 | Budi | Kel. Mawar (Kec. Sinar), -7.225, 112.690 | 0 (normal) | Pelapor kecelakaan dan kebakaran |
| 0812-0000-0002 | Sari | Kel. Anggrek (Kec. Bukit), -7.275, 112.680 | 0 | Pelapor kasus medis, melihat laporan sendiri |
| 0812-0000-0003 | Andi | Kel. Pesisir (Kec. Muara), -7.330, 112.700 | 0 | Penerima alert banjir, pelapor kondisi dan bantuan |
| 0812-0000-0004 | Dewi | Kel. Nelayan (Kec. Muara), -7.330, 112.770 | **rendah** (-5) | Uji batas laju dan isolasi data antar warga |

---

## 7. Jenis Kejadian

| Kode | Nama | Kategori | Lead default | Laporan kondisi | Rekomendasi sumber daya |
|---|---|---|---|---|---|
| `TRAFFIC_ACCIDENT` | Kecelakaan Lalu Lintas | `TRAFFIC` | `POLICE` | Tidak | Ambulans (RESPOND, wajib), Polisi (RESPOND, wajib), Damkar (RESPOND, opsional: korban terjebak/BBM bocor) |
| `FIRE` | Kebakaran | `FIRE` | `FIRE` | Tidak | Damkar (RESPOND, wajib), Ambulans (RESPOND, opsional), Polisi (RESPOND, opsional) |
| `FLOOD` | Banjir | `NATURAL_DISASTER` | `BPBD` | **Ya** | BPBD/Rescue (RESPOND, wajib), Ambulans (RESPOND, opsional) |
| `MEDICAL` | Darurat Medis | `MEDICAL` | `AMBULANCE_SERVICE` | Tidak | Ambulans (RESPOND, wajib) |
| `OTHER` | Lainnya | `OTHER` | (kosong) | Tidak | (kosong) |

Catatan: IGD (`NOTIFY`) tidak masuk rekomendasi awal. Dispatch NOTIFY ke IGD dibuat otomatis saat ambulans memilih RS tujuan (`/dispatches/{id}/destination`).

Bentuk `suggested_resources` (JSONB), contoh `TRAFFIC_ACCIDENT`:

```json
[
  { "org_type": "AMBULANCE_SERVICE", "dispatch_type": "RESPOND", "required": true },
  { "org_type": "POLICE",            "dispatch_type": "RESPOND", "required": true },
  { "org_type": "FIRE",              "dispatch_type": "RESPOND", "required": false,
    "hint": "Aktifkan bila korban terjebak atau ada kebocoran BBM" }
]
```

---

## 8. Pengaturan Sistem (`system_settings`)

| Kunci | Nilai sampel | Catatan |
|---|---|---|
| `offer_timeout_seconds` | `120` | Batas waktu offer |
| `fcm.resend_after_seconds` | `20` | Kirim ulang FCM sekali |
| `offer_unseen_seconds` | `60` | Ambang `offer_unseen` |
| `unhandled_incident_escalation_minutes` | `3` | Eskalasi ke supervisor |
| `auto_close_hours` | `24` | Tutup otomatis setelah `RESOLVED` |
| `incident_lock_seconds` | `300` | Masa kunci (diperpanjang tiap 60 dtk) |
| `fcm.stale_token_days` | `60` | |
| `fcm.max_tokens_per_user` | `5` | |
| `gps_accuracy_warn_m` | `50` | Ambang peringatan akurasi di aplikasi warga |
| `min_app_version` | `1.0.0` | |
| `map_default` | `{ "lat": -7.275, "lng": 112.725, "zoom": 12 }` | |
| `limits` | `{ "photo_max_mb": 10, "video_max_mb": 50, "max_attachments": 5 }` | |
| `report_rate_limit` | `{ "help_request": { "count": 3, "window_min": 10, "daily": 10 }, "condition_report": { "count": 10, "window_min": 10 } }` | |
| `alert_rate_limit` | `{ "per_hour_per_region": 5 }` | |
| `operating_hours` | `{ "timezone": "Asia/Jakarta", "mode": "24x7" }` | Diubah saat demo untuk memperlihatkan banner "di luar jam operasional" |
| `alert_levels` | lihat di bawah | Istilah contoh 🔶 |
| `emergency_contacts` | lihat di bawah | **Nomor contoh** |
| `disclaimer` | "Aplikasi ini bukan pengganti nomor darurat resmi. Untuk kondisi mengancam nyawa, hubungi nomor darurat langsung." | Ditampilkan di aplikasi warga |
| `sample_mode` | `true` | Menampilkan lencana **MODE SAMPEL** di aplikasi dan dashboard |

`alert_levels`:

```json
[
  { "code": "WASPADA", "name": "Waspada", "fcm_class": "INFO" },
  { "code": "SIAGA",   "name": "Siaga",   "fcm_class": "CRITICAL" },
  { "code": "AWAS",    "name": "Awas",    "fcm_class": "CRITICAL", "require_typed_confirmation": true }
]
```

`emergency_contacts` (sampel, **bukan nomor asli**):

```json
[
  { "name": "Darurat Terpadu (contoh)", "phone": "000-112", "note": "Ganti dengan 112 pada produksi" },
  { "name": "Polisi (contoh)",          "phone": "000-110", "note": "Ganti dengan 110 pada produksi" },
  { "name": "Pemadam (contoh)",         "phone": "000-113", "note": "Ganti dengan 113 pada produksi" },
  { "name": "Ambulans (contoh)",        "phone": "000-118", "note": "Ganti dengan 118/119 pada produksi" },
  { "name": "BPBD (contoh)",            "phone": "000-050", "note": "Ganti dengan nomor BPBD setempat" }
]
```

---

## 9. Data Historis (profil `seed:history`)

Tujuannya agar `/summary`, `/history`, dan log audit tidak kosong saat demo. Dibangkitkan **reprodusibel** (benih acak tetap `2026`).

| Aspek | Spesifikasi |
|---|---|
| Rentang | 7 hari terakhir sebelum waktu seed dijalankan |
| Jumlah | 30 incident |
| Jenis | 12 kecelakaan, 6 kebakaran, 4 banjir, 6 medis, 2 lainnya |
| Status akhir | 24 `CLOSED`, 3 `INVALID`, 2 `DUPLICATE`, 1 `RESOLVED` |
| Waktu kejadian | Tersebar 06:00-23:00 WIB dengan puncak pagi dan sore |
| Dispatch per incident | 1-3. Sekitar 10% berakhir `REJECTED` atau `EXPIRED` lalu digantikan dispatch lain |
| Waktu respons | Offer → accept 20-150 detik, accept → tiba 3-15 menit |
| Hasil dispatch | `outcomeCode` bervariasi (`COMPLETED`, `PATIENT_TRANSPORTED`, `NOT_FOUND`, `FALSE_ALARM`) |
| Korban | Pada kecelakaan: 0-3 luka, 0-1 meninggal (riwayat `incident_casualties` berurutan) |
| Pelapor | Acak dari warga seed. `INVALID` mengurangi reputasi Dewi (sehingga bernilai rendah) |
| Event | Setiap incident punya `incident_events` yang **konsisten dengan state machine** (tanpa transisi mustahil, waktu monoton naik) |
| Audit | Sebagian aksi sensitif (`pii.view_reporter`, `incident.invalidate`) tercatat |
| Alert | 2 alert lama berstatus `CLOSED` (satu banjir, satu cuaca) |

---

## 10. Simulator

### 10.1 `sim:bot` (responder tiruan)

Untuk unit yang tidak memegang ponsel pada demo. Bot **memakai jalur yang sama dengan aplikasi asli** (login responder, WebSocket, REST), bukan jalan pintas ke database, sehingga ikut menguji kontrak.

| Mode | Perilaku |
|---|---|
| `accept` | `seen` → tunggu `delay` (default 15 ± 5 detik) → `accept` → `EN_ROUTE` (10-20 dtk) → `ON_SCENE` (30-60 dtk) → `DONE` (60-120 dtk) |
| `reject` | `seen` → tunggu → `reject` dengan alasan acak |
| `silent` | Tidak melakukan apa pun (memicu `offer_unseen`, `EXPIRED`) |
| `flaky` | Campuran acak (70% accept, 15% reject, 15% silent) |

Parameter usulan: `--unit=AMB-03 --mode=accept --delay=15 --jitter=5`, atau `--all-units --mode=flaky`. Bot menulis log ringkas ke konsol agar presenter dapat menjelaskan apa yang terjadi.

### 10.2 `sim:flood` (banjir massal)

| Parameter | Arti | Default |
|---|---|---|
| `--district` | Kecamatan sasaran | `99.99.03` (Muara) |
| `--help` | Jumlah laporan `HELP_REQUEST` | 20 |
| `--condition` | Jumlah laporan `CONDITION_REPORT` | 40 |
| `--clusters` | Jumlah pusat kejadian (laporan menumpuk di sekitarnya) | 3 |
| `--duration` | Sebaran waktu pengiriman (detik) | 120 |
| `--rate` | Alternatif: laporan per menit | - |

Aturan pembangkitan:
- Laporan berasal dari **120 warga simulasi** (`sim.warga.001` … `120`, `meta.sim = true`, nomor `0813-0000-xxxx`, OTP mock), sehingga **pembatasan laju tetap berlaku** secara realistis (tidak ada jalan pintas).
- Lokasi: sebaran normal (σ ≈ 150 m) di sekitar tiap pusat, di dalam poligon kecamatan sasaran.
- Deskripsi dari kumpulan kalimat contoh ("air setinggi lutut", "ada lansia terjebak di lantai satu", dan sejenisnya). Sebagian kecil membawa foto placeholder berukuran kecil.
- 10-15% dari `HELP_REQUEST` sengaja **duplikat** (lokasi nyaris sama, waktu berdekatan) untuk menguji `/nearby` dan `merge`.
- Berjalan lewat API publik (jalur nyata), bukan menulis ke database.

### 10.3 `sim:citizen` (lalu lintas acak)

Membuat laporan acak di seluruh kota untuk mengisi antrean atau uji beban: `--count=200 --rate=30 --types=all`. Memakai warga simulasi dan memperhatikan batas laju.

### 10.4 Penggunaan di demo

- **Banyak ponsel:** bot dimatikan untuk unit yang dipegang ponsel nyata.
- **Sedikit ponsel:** bot menjalankan sisa unit (mis. `AMB-01`, `DMK-02`, `RESCUE-02`).
- Uji beban (D18): `sim:flood --help=300 --rate=300` sambil mengamati dashboard.

---

## 11. Skrip Demo

Total sekitar **45 menit** (bisa dipotong per adegan). Setiap adegan memakai skenario uji yang sudah ditulis, sehingga hasil yang diharapkan sudah terdefinisi.

### 11.1 Perangkat dan akun

| Perangkat | Dipakai oleh | Akun |
|---|---|---|
| Ponsel A (aplikasi warga) | Presenter/warga | Budi, lalu Andi |
| Ponsel B (aplikasi staf) | Ambulans | `resp.amb2` |
| Ponsel C (aplikasi staf) | Polisi / damkar | `resp.patroli1`, lalu `resp.damkar1` |
| Ponsel D (aplikasi staf) | IGD | `resp.igd1` |
| Laptop 1 | Dispatcher | `dispatcher1` |
| Laptop 2 | Supervisor / admin | `supervisor`, lalu `admin.bpbd`, `superadmin` |
| Terminal | Presenter | `sim:bot`, `sim:flood` |

Unit tanpa ponsel dijalankan oleh `sim:bot`.

### 11.2 Alokasi waktu

| Adegan | Tema | Durasi |
|---|---|---|
| 0 | Persiapan dan reset | 3 menit |
| 1 | Kecelakaan (alur utama) | 12 menit |
| 2 | Offer ditolak dan tidak dijawab | 6 menit |
| 3 | Kebakaran: damkar berangkat duluan | 8 menit |
| 4 | Banjir: alert, laporan kondisi, laporan massal | 10 menit |
| 5 | Ketahanan: offline dan sambung ulang | 4 menit |
| 6 | Privasi dan akses | 4 menit |
| 7 | Penutup: serah terima shift dan ringkasan | 3 menit |

### Adegan 0: Persiapan dan reset

1. Jalankan `seed:reset-live`, lalu `seed:verify` (semua hijau).
2. Dispatcher1 login di Laptop 1, **aktifkan suara**, mulai shift. Supervisor login di Laptop 2.
3. Ponsel A login sebagai Budi (OTP `123456`). Ponsel B, C, D login sebagai responder masing-masing, izin notifikasi diberikan.
4. Bot hanya untuk unit tanpa ponsel.

### Adegan 1: Kecelakaan (S1, W1-W3, A1, B1-B3, B12)

Lokasi kejadian: **-7.275, 112.730** (Kel. Kenanga, Kec. Bukit).

| # | Aktor | Langkah | Hasil yang terlihat |
|---|---|---|---|
| 1 | Budi (Ponsel A) | Lapor → **Kecelakaan Lalu Lintas**, pin di lokasi, korban "2", deskripsi "Truk menabrak motor, pengendara tidak sadar", 1 foto → Kirim | Status "Laporan diterima". Tombol telepon darurat tetap terlihat |
| 2 | Dispatcher1 | Laptop 1 | Chime. Laporan muncul di tab **Baru** dalam < 1 detik tanpa muat ulang |
| 3 | Dispatcher1 | Buka → **Tangani** (kunci) | Laptop 2 menampilkan "Sedang ditangani Rina" |
| 4 | Dispatcher1 | **Verifikasi** (keparahan HIGH) | Lead otomatis `POLRES`. Budi melihat "Laporan diverifikasi" |
| 5 | Dispatcher1 | **Dispatch** → checklist rekomendasi. Pilih Ambulans dan Polisi. Rekomendasi pertama ambulans: **AMB-02** (±1,1 km) | Dua kartu dispatch `OFFERED` dengan hitung mundur |
| 6 | Ponsel B, C | Notifikasi + alarm (aplikasi di latar belakang/mati: tampil lewat FCM) | Layar offer **tanpa lokasi presisi** (hanya Kec. Bukit, jarak). Budi: "Bantuan sedang disiapkan" |
| 7 | Ponsel B | **Terima** | Lokasi presisi dan tombol Navigasi muncul. Dashboard: dispatch `ACCEPTED`, incident `IN_PROGRESS` |
| 8 | Ponsel C | **Terima dan berangkat** | Dispatch `EN_ROUTE`. Budi: "Unit menuju lokasi" |
| 9 | Ponsel C | Tiba → catat milestone **SCENE_RELEASED**. Tunjukkan Ponsel B **tidak** punya menu milestone | Timeline dashboard bertambah. Hanya organisasi lead yang melihat menu |
| 10 | Ponsel B | Tiba → perbarui korban (1 luka berat, 1 meninggal) → **Pilih RS tujuan: RSUD** | Dispatch NOTIFY ke IGD terbentuk |
| 11 | Ponsel D | Notifikasi "Persiapan IGD" → **Siap** → **Pasien tiba** → **Selesai** | Dashboard menampilkan rantai status IGD |
| 12 | Ponsel B, C | **Selesai** (hasil `PATIENT_TRANSPORTED`, `COMPLETED`) | Semua dispatch `DONE` |
| 13 | Dispatcher1 | **Selesaikan** lalu **Tutup** | Budi: "Penanganan selesai". Timeline lengkap |

Poin untuk client: satu laporan → banyak stakeholder; lokasi presisi baru dibuka setelah accept; hanya organisasi lead yang boleh menandai milestone; semua tercatat di timeline.

### Adegan 2: Offer ditolak dan tidak dijawab (S2, W4, D5, D6)

Lokasi: **-7.275, 112.680** (Kel. Anggrek). Pelapor: Sari, jenis **Darurat Medis**.

| # | Aktor | Langkah | Hasil |
|---|---|---|---|
| 1 | Sari | Kirim laporan medis | Muncul di antrean |
| 2 | Dispatcher1 | Verifikasi → dispatch **AMB-02** (Ponsel B) | Offer di Ponsel B |
| 3 | Ponsel B | **Tolak** (alasan "sedang menangani kasus lain") | Item merah di **Perlu Perhatian** + alarm |
| 4 | Dispatcher1 | **Pilih pengganti** → **AMB-03** (bot mode `silent`) | Offer baru, hitung mundur |
| 5 | (tunggu) | ±20 detik: FCM dikirim ulang sekali. ±60 detik: **`offer_unseen`** | Item "AMB-03 belum melihat offer" dengan tombol **Telepon** dan **Catat via telepon** |
| 6 | Dispatcher1 | **Catat via telepon** → AMB-03 `EN_ROUTE`, kanal `PHONE`, "2 menit lalu" | Riwayat menandai "dicatat atas nama" dengan waktu kejadian ≠ waktu dicatat |
| 7 | (opsional) | Ubah `offer_timeout_seconds` di **Pengaturan** (Super Admin) lalu ulangi | Tunjukkan aturan dapat diubah tanpa deploy ulang |

Poin untuk client: sistem tidak diam bila stakeholder tidak merespons. Eskalasi bertahap dan jalur telepon tetap menjadi bagian dari alur.

### Adegan 3: Kebakaran, damkar berangkat duluan (S3, D7, D8, B11)

Lokasi: **-7.225, 112.690** (Kel. Mawar, Kec. Sinar). Pelapor: Budi, jenis **Kebakaran**.

| # | Aktor | Langkah | Hasil |
|---|---|---|---|
| 1 | Budi | Kirim laporan kebakaran | Antrean Baru |
| 2 | Dispatcher1 | Verifikasi (lead otomatis `DAMKAR`) | |
| 3 | Dispatcher1 | **Catat atas nama unit**: DMK-01, status `EN_ROUTE`, kanal `WHATSAPP`, "3 menit lalu" (damkar sudah berangkat karena kabar lewat WhatsApp) | Dispatch tercatat tanpa menunggu offer |
| 4 | Ponsel C (login `resp.damkar1`) | Membuka Penugasan | Penugasan sudah ada dengan lokasi presisi |
| 5 | Ponsel C | **Ajukan bantuan**: 1 mobil pemadam tambahan, URGENT (hanya tampil karena DAMKAR adalah lead) | Dashboard: item merah + alarm |
| 6 | Dispatcher1 | **Setujui** → pilih DMK-03 (bot `accept`) | Dispatch `origin = REQUESTED` dan item hilang |
| 7 | Dispatcher1 | Dispatch **ambulans siaga** (bot `accept`) | |
| 8 | Ponsel C | Milestone **EXTERNAL_UNIT_ARRIVED**: "Pemadam swasta, 2 unit, MANDIRI" | Tercatat di timeline tanpa menjadi stakeholder terdaftar |
| 9 | Ponsel C | **Selesai** (`COMPLETED`). Dispatcher menutup | |

Poin untuk client: sistem mengikuti kenyataan lapangan (unit berangkat lebih dulu), mencatat atas nama unit lewat kanal yang sudah dipakai (telepon/WA), dan tidak memaksa semua instansi masuk aplikasi.

### Adegan 4: Banjir (S4, W11, A8, D15, D18)

| # | Aktor | Langkah | Hasil |
|---|---|---|---|
| 1 | `admin.bpbd` (Laptop 2) | **Alert** baru: kategori Banjir, level **Siaga**, wilayah **Kec. Muara**, lihat **pratinjau notifikasi** → Terbitkan (konfirmasi dua langkah) | Alert aktif |
| 2 | Andi (Ponsel A, Muara) | | Menerima push dan banner alert. **Budi** (Sinar) tidak menerima |
| 3 | Andi | **Saya melaporkan kondisi**: "Air setinggi lutut di jalan", foto | **Tidak** masuk antrean. Muncul di **Peta Laporan Kondisi** |
| 4 | Andi | **Saya butuh bantuan**: "Ada lansia dan bayi, air masuk rumah" | Masuk antrean |
| 5 | Terminal | `sim:flood --district=99.99.03 --help=20 --condition=40 --clusters=3 --duration=120` | Antrean terisi, dashboard tetap responsif. Peta kondisi mengelompok |
| 6 | Dispatcher1 | Buka salah satu laporan → **`/nearby`** → **Gabung** duplikat | Seleksi pindah ke induk. Pelapor di sumber melihat status induk |
| 7 | Dispatcher1 | Verifikasi laporan Andi → lead otomatis `BPBD` → dispatch **RESCUE-02** (bot `accept`) + ambulans | |
| 8 | `admin.bpbd` | **Tutup** alert | Notifikasi pembaruan, alert tampil tertutup |

Poin untuk client: dua jenis laporan menjaga antrean tetap bersih; penggabungan duplikat; alert wilayah tepat sasaran; konfirmasi dua langkah mencegah salah kirim massal.

### Adegan 5: Ketahanan (S5, W6, A2, D12, B9)

| # | Aktor | Langkah | Hasil |
|---|---|---|---|
| 1 | Andi | Aktifkan **mode pesawat**, buat laporan | "Menunggu terkirim" |
| 2 | Andi | Matikan mode pesawat | Terkirim otomatis, **satu** incident terbentuk (idempotensi) |
| 3 | Laptop 1 | DevTools → **Offline** selama ±30 detik | Banner merah "Koneksi realtime terputus" + polling cadangan |
| 4 | Laptop 1 | Online kembali | Sinkronisasi tanpa duplikat |
| 5 | Ponsel B | Tutup paksa aplikasi lalu kirim offer dari dispatcher | Notifikasi FCM tampil, diketuk → layar offer dengan data dari REST |

Poin untuk client: laporan darurat tidak pernah menunggu jaringan; tidak ada data hilang atau ganda saat koneksi putus.

### Adegan 6: Privasi dan akses (S7, W5, W9, D14, D17)

| # | Aktor | Langkah | Hasil |
|---|---|---|---|
| 1 | Ponsel B | Buka offer baru **sebelum** diterima | Tidak ada lokasi presisi, foto, atau kontak pelapor |
| 2 | Dispatcher1 | Tab **Laporan** → **Tampilkan kontak** | Nomor penuh 30 detik lalu dimask lagi |
| 3 | `superadmin` | **Log audit** → filter `pii.view_reporter` | Pembukaan kontak tercatat (siapa, kapan, laporan apa) |
| 4 | Presenter | Dewi mencoba membuka laporan milik Budi (lewat alat uji API) | `404 NOT_FOUND` |
| 5 | `admin.ambulans` | **Nonaktifkan** akun `resp.amb2` | Ponsel B langsung keluar dengan alasan (`session.revoked`), tidak dapat masuk lagi |
| 6 | `dispatcher1` | Coba membuka menu admin | Tidak tersedia (gating izin) |

Poin untuk client: data pribadi dilindungi bertahap dan semua pembukaan tercatat; akun yang dinonaktifkan langsung putus.

### Adegan 7: Penutup (D16, ringkasan)

1. Dispatcher1 **Akhiri shift** dengan catatan serah terima. Dispatcher2 **Mulai shift** dan melihat catatan serta ringkasan.
2. Buka **Ringkasan** (angka dari data historis dan sesi demo).
3. Tunjukkan daftar pertanyaan terbuka yang akan dibawa ke stakeholder (poin 🔶).

---

## 12. Verifikasi Seed (`seed:verify`) dan Kriteria Penerimaan

| Kode | Pemeriksaan | Lulus bila |
|---|---|---|
| V1 | Jumlah entitas dasar | Wilayah 10, organisasi 7, unit 12, role 7, jenis kejadian 5, akun staf 21, warga 4 |
| V2 | Geometri wilayah | Semua `boundary` valid (`ST_IsValid`), kelurahan berada di dalam kecamatannya, kecamatan di dalam kota, tidak ada tumpang tindih antar-saudara |
| V3 | Lokasi | Semua organisasi dan posisi unit berada di dalam poligon kota |
| V4 | Relasi | Setiap organisasi punya wilayah layanan, setiap staf punya `staff_profile`, unit responder milik organisasi yang sama, dispatcher/supervisor di organisasi `CC` |
| V5 | Permission | Setiap role punya ≥ 1 permission, setiap permission dipakai ≥ 1 role. `DISPATCHER` punya `pii.reveal_reporter`, `RESPONDER` **tidak** |
| V6 | Login | Seluruh akun staf dapat login dengan sandi sampel. Seluruh warga dapat login dengan OTP mock |
| V7 | Konfigurasi publik | `/config/public` mengembalikan nomor darurat **contoh**, `sampleMode = true`, dan tidak ada nomor darurat asli di seed |
| V8 | Topic FCM | Nama topic yang diturunkan dari kode wilayah memenuhi aturan karakter FCM |
| V9 | Rekomendasi | Untuk lokasi -7.275, 112.730, rekomendasi ambulans pertama adalah `AMB-02` |
| V10 | Idempotensi | Menjalankan `seed:base` dua kali tidak mengubah jumlah baris |
| V11 | Penjaga lingkungan | `seed:base` ditolak bila `ENV=prod` |
| V12 | Konsistensi riwayat | Pada `seed:history`: tidak ada transisi status mustahil, waktu dispatch monoton naik, urutan `incident_events.id` naik |
| V13 | Pembersihan | `seed:reset-live` menghapus semua data operasional dan **tidak** menyentuh data dasar |
| V14 | Simulator | `sim:bot` menyelesaikan satu dispatch penuh melalui API. `sim:flood` menghasilkan jumlah laporan sesuai parameter tanpa melanggar batas laju |

---

## 13. Daftar Periksa Persiapan Demo dan Rencana Cadangan

### 13.1 Sehari sebelum

- [ ] Lingkungan sampel berjalan sehat (`/health/ready`: database, Redis, object storage).
- [ ] `seed:base`, `seed:history`, `seed:verify` hijau.
- [ ] Aplikasi warga dan staf terpasang di ponsel (kedua flavor), izin notifikasi dan lokasi diberikan, optimasi baterai dikecualikan untuk aplikasi staf.
- [ ] Uji **push nyata** (`NOTIFICATION_PROVIDER=fcm`) minimal sekali pada tiap ponsel. Ponsel yang bermasalah diganti.
- [ ] Lokasi palsu (mock location) siap untuk koordinat tiap adegan.
- [ ] Jam server, laptop, dan ponsel disinkronkan (NTP).
- [ ] Dua sesi dashboard berjalan, suara diaktifkan, volume dicek.
- [ ] Rekaman layar tiap adegan sebagai cadangan.

### 13.2 Sebelum mulai

- [ ] `seed:reset-live`, `seed:verify`.
- [ ] Semua akun sudah login, bot siap untuk unit tanpa ponsel.
- [ ] `operating_hours` diatur `24x7` (diubah di tengah demo bila ingin memperlihatkan banner di luar jam).
- [ ] Lencana **MODE SAMPEL** terlihat di aplikasi dan dashboard.

### 13.3 Rencana cadangan

| Masalah | Cadangan |
|---|---|
| Push FCM tidak masuk | Pindah ke `NOTIFICATION_PROVIDER=mock`, tampilkan log pengiriman dan jalur WebSocket yang tetap berjalan. Jelaskan perbedaannya |
| Ponsel fisik bermasalah | Gunakan emulator atau bot untuk unit tersebut |
| Jaringan venue buruk | Gunakan jaringan seluler sendiri atau jalankan seluruh lingkungan secara lokal |
| WebSocket putus di tengah adegan | Tunjukkan itu sebagai bagian dari adegan ketahanan (adegan 5), lanjutkan |
| Suara dashboard tidak berbunyi | Klik ulang "Aktifkan suara", periksa mute peramban |
| Data kacau | `seed:reset-live` dan ulang dari adegan berikutnya |

---

## 14. Asumsi Default untuk Aplikasi Sampel

| Hal | Default sampel |
|---|---|
| Data | Seluruhnya fiktif (Kota Contoh, kode `99.99`) |
| Nomor darurat | Contoh (bukan nomor resmi), dengan lencana MODE SAMPEL |
| Kata sandi staf | `Contoh#2026`, 2FA mati |
| OTP | Tetap `123456` (penyedia `mock`) |
| Push | `mock` bawaan, `fcm` untuk uji perangkat nyata |
| Role tambahan | `ALERT_MANAGER` untuk admin BPBD |
| Riwayat | 30 incident selama 7 hari (opsional) |
| Warga simulasi | 120 akun (`sim.warga.*`) |
| Bot responder | Memakai API/WebSocket asli |
| Alert | Mode wilayah (kecamatan) saja |

---

## 15. Hal yang Perlu Ditinjau (Setelah Sampel, Bersama Client) 🔶

1. **Mengganti data fiktif dengan data wilayah sungguhan.** Perlu sumber poligon batas kecamatan/kelurahan (dari pemda atau data peta resmi) dan kode wilayah resmi.
2. **Daftar organisasi, unit, dan akun yang sesungguhnya**, termasuk siapa yang menjadi Admin Organisasi tiap instansi.
3. **Nomor darurat dan nomor operasional resmi** (menggantikan nomor contoh).
4. **Istilah level alert** BPBD setempat (Waspada/Siaga/Awas hanyalah contoh).
5. **Rekomendasi sumber daya per jenis kejadian** (siapa wajib, siapa opsional) menurut praktik lapangan.
6. **Hak membuat alert** (`ALERT_MANAGER` hanya untuk BPBD, atau dispatcher juga).
7. **Jenis kejadian tambahan** (tanah longsor, pohon tumbang, kecelakaan kerja, dan sebagainya).
8. **Kebijakan akun demo** setelah sampel: dihapus total sebelum lingkungan dipakai untuk pilot.

---

## 16. Di Luar Cakupan Dokumen Ini

- Kode pembangkit seed dan simulator (dikerjakan agent code berdasarkan spesifikasi ini).
- Impor data wilayah nyata (shapefile/GeoJSON) dan data organisasi nyata.
- Data uji performa skala besar di luar `sim:flood`.
- Skrip presentasi visual (slide) dan materi pelatihan petugas.
