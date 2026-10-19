# Catatan Konsep: Aplikasi Informasi Bencana & Kejadian Darurat

> Status: draft konsep v11 (business flow 3 kasus + role & permission + ERD v1.3 + kontrak REST API v1 + spesifikasi WebSocket v1 + spesifikasi FCM v1 + arsitektur Flutter v1 + spesifikasi dashboard web v1 + data seed dan skrip demo v1 + dokumen serah terima agent code v1 + dokumen deployment v1)
> Dokumen turunan: `erd-aplikasi-darurat.md` (basis data), `rest-api-aplikasi-darurat.md` (kontrak REST API), `websocket-aplikasi-darurat.md` (kanal realtime), `fcm-aplikasi-darurat.md` (notifikasi push), `flutter-aplikasi-darurat.md` (arsitektur aplikasi Flutter), `dashboard-aplikasi-darurat.md` (dashboard web dispatcher/admin), `seed-demo-aplikasi-darurat.md` (data seed, simulator, dan skrip demo), `handoff-agent-code-aplikasi-darurat.md` (rencana fase dan aturan kerja agent code), `AGENTS.md` dan `CLAUDE.md` (berkas konteks untuk agent), `DECISIONS.md` (keputusan pemilik proyek), `deployment-aplikasi-darurat.md` (deployment produksi)
> Fokus saat ini: **bahan untuk aplikasi sampel**. Poin 🔶 yang butuh keputusan client ditanyakan belakangan, selama itu dipakai asumsi default (bagian 18)
> Terakhir diperbarui: 5 Oktober 2026
> Sumber: diskusi dengan Claude + rangkuman diskusi sebelumnya dengan ChatGPT (digabung dan dikoreksi)
> Tanda 🔶 = asumsi yang perlu dikonfirmasi ke stakeholder/lapangan

---

## 1. Ringkasan

Sistem ini adalah **Emergency Incident Management / Dispatch System** dengan tiga sisi:

```
Warga (lapor)  →  Admin/Dispatcher (verifikasi & tugaskan)  →  Stakeholder (tanggapi & tindak lanjuti)
```

| # | Aplikasi | Pengguna | Platform |
|---|----------|----------|----------|
| 1 | Command Center (dispatcher) | Admin | Web |
| 2 | Aplikasi Stakeholder | Ambulans, BPBD, Damkar, IGD RS, Polisi, dll | Android (Flutter) + Web |
| 3 | Aplikasi Warga | Masyarakat (registrasi) | Flutter |

**Tech stack:** NestJS (REST + WebSocket), Google FCM, Flutter, PostgreSQL + PostGIS, Redis/Valkey, object storage (MinIO/S3).

---

## 2. Keputusan yang Sudah Diambil

| Topik | Keputusan |
|-------|-----------|
| Cakupan wilayah | Satu kabupaten/kota (tanpa multi-tenant) |
| Hubungan dengan Command Center 112 | **Berdiri sendiri** untuk sementara, dirancang siap terintegrasi |
| Arsitektur | Modular monolith |
| Domain utama | **Incident**, bukan "laporan" |
| Penugasan | **Dispatch** sebagai entitas terpisah dengan status sendiri |
| Realtime | WebSocket untuk data realtime, FCM untuk membangunkan app |
| Pemegang komando | Disimpan per incident (`lead_organization`): polisi (kecelakaan), damkar (kebakaran), BPBD (banjir) |
| Koordinasi di luar sistem | Derek, Dishub, kamar jenazah, Jasa Raharja, pemadam swasta, PLN/PDAM **tidak** di-dispatch, hanya dicatat |
| Alert kemacetan/lalu lintas | Tidak ada dulu. Alert fokus ke bencana |
| Basis data | PostgreSQL + PostGIS, 32 tabel (31 di fase 1). Rinci di `erd-aplikasi-darurat.md` |
| Primary key | UUID (UUIDv7), id bisa dibuat klien untuk antrean offline. Kode terbaca manusia hanya di `incidents.code` |
| Status dan tipe | `varchar` + validasi aplikasi, bukan enum PostgreSQL |
| Data pelapor | Dipisah dari `incidents` (ada di `incident_reports` dan `users`) agar mudah dibatasi dan dianonimkan |
| Laporan kondisi banjir | `incident_reports.incident_id` boleh null, tidak masuk antrean dispatcher |
| Data korban | Disimpan sebagai riwayat (`incident_casualties`), baris terbaru = kondisi terkini |
| Waktu kejadian vs pencatatan | `dispatch_status_history` dan `incident_events` memuat `occurred_at` dan `recorded_at` |
| Sinkronisasi reconnect | `incident_events.id` (bigint identity) sebagai kursor urutan global. REST: `/sync/events` dan `/sync/snapshot` |
| Bentuk API | REST `/api/v1`, JSON camelCase, pagination kursor, error terstandar, `PATCH`/aksi memakai `version` (optimistic locking) |
| Autentikasi | Warga: OTP. Staf: kata sandi + 2FA wajib untuk dispatcher dan supervisor. Access token 15 menit + refresh token berotasi. Permission dihitung di server, tidak ditaruh di token |
| Idempotensi | Laporan warga lewat `clientReportId`; aksi mobile lain lewat header `Idempotency-Key` |
| Laporan di luar wilayah | Diterima dengan penanda `OUT_OF_AREA`, tidak ditolak, dispatcher yang memutuskan 🔶 |
| Lampiran | Unggah langsung ke object storage lewat presigned URL, dikonfirmasi ke API |
| Visibilitas data | Disaring di serializer per role dan fase dispatch (`OfferView` tanpa lokasi presisi, `UnitView` setelah accept) |
| Status warga | Warga melihat `publicStatus` yang disederhanakan, bukan status internal |
| Transisi status | Maju saja, boleh melompati tahap dispatch ke depan, mundur hanya oleh supervisor dengan alasan 🔶 |
| Kanal realtime | Socket.IO, satu namespace `/realtime`, adapter Redis. **REST satu-satunya jalur tulis**, WebSocket hanya mengantar event ke klien |
| Keanggotaan room | Diatur server (tidak ada join dari klien): `user:`, `role:dispatcher`, `role:supervisor`, `org:`, `unit:`, `incident:`, `region:` |
| Jaminan pengiriman | At-least-once. Klien membuang duplikat dengan `eid`. Event dipublikasikan **setelah commit** (outbox/after-commit) |
| Kelas pengiriman | CRITICAL (WS + FCM bersamaan, wajib ack), STANDARD (WS, FCM bila tidak terhubung/tanpa ack 15 dtk), INFO (WS saja) |
| Eskalasi offer | 20 dtk retry FCM, 60 dtk `offer_unseen` ke dispatcher/supervisor, 120 dtk `EXPIRED`. Dijalankan job BullMQ, bukan memori proses |
| Pemulihan reconnect | Satu mekanisme: `/sync/events` (+ `/sync/snapshot` bila `resetRequired`) setelah `connection.ready` |
| Mode saat ini | Aplikasi sampel dengan asumsi default (bagian 18). Keputusan client ditunda |
| State management Flutter | **GetX** (state, DI, routing), pilihan Anda karena sudah terbiasa |
| Struktur Flutter | **MVC + services**: `models/`, `views/`, `controllers/`, `services/` (+ `app/`, `core/`, `bindings/`). Satu proyek, dua flavor (`citizen`, `staff`) |
| Batas lapisan | views → controllers → services → platform; models dipakai semua. View tidak memanggil service/API. Controller tipis, logika bisnis di services agar pustaka state bisa diganti |
| Controller | Global (`permanent`: sesi, config, realtime, koneksi, notifikasi, laporan saya, penugasan) dan per layar (lewat Binding) |
| State dari server di Flutter | Disimpan berkunci id dengan upsert + pemeriksaan `version`, sehingga event ganda/terlambat tidak merusak tampilan |
| Antrean offline (outbox) | SQLite (`drift`). Laporan: teks + lokasi lebih dulu, foto menyusul. `accept`/`reject` tidak diantrekan |
| Waktu di aplikasi | `ServerClockService` (offset jam server) untuk hitung mundur offer dan `occurredAt` |
| Dedup lintas jalur | `eid` dari WebSocket dan FCM, satu `EventDeduper` |
| Deep link | Skema `emergency://`, daftar putih rute, UUID divalidasi, data selalu dimuat dari REST |
| Teknologi dashboard web | **Vite + React + TypeScript** (pilihan Anda). TanStack Query (data server) + Zustand (state klien), Tailwind + shadcn/ui, Leaflet/OSM, `socket.io-client`. Satu aplikasi web untuk dispatcher, supervisor, admin organisasi, dan super admin |
| Struktur dashboard | Per fitur (`features/console`, `incidents`, `dispatch`, `alerts`, `shift`, `admin`, ...), di samping `api/`, `realtime/`, `stores/`, `services/`, `components/`. Fitur tidak saling mengimpor |
| Layar utama | **Console** tiga panel: Antrean (tab Baru/Aktif/Selesai), Ruang kerja incident (tab Ringkasan/Laporan/Dispatch/Korban/Timeline/Catatan), Konteks (peta + rekomendasi) + panel **Perlu Perhatian** selalu terlihat |
| Perlu Perhatian | Tugas yang menunggu keputusan dispatcher (ditolak, kedaluwarsa, offer belum dilihat, resource request, duplikat). **Dihitung dari state server** (`attentionReasons`) + event, sehingga tidak hilang saat dimuat ulang |
| Realtime di web | Event menulis langsung ke cache (satu tempat: `realtime/handlers`), upsert + `version`, pembaruan berkelompok ±200 ms saat banjir, polling `/sync/events` 10 dtk saat WebSocket putus |
| Aksi tulis di dashboard | Tidak diantrekan offline. Dispatcher harus tahu hasilnya saat itu juga. Memakai `Idempotency-Key` dan `version` |
| Penguncian di web | Heartbeat 60 dtk, mode hanya baca bila dikunci orang lain, supervisor dapat ambil alih dengan alasan |
| Privasi di web | Kontak pelapor dimask, tampil 30 dtk setelah `reveal-contact` (diaudit), cache query tidak dipersistenkan, tidak ada data pribadi di URL/judul tab |
| Suara di web | Dialog aktifkan suara wajib (peramban memblokir autoplay). Alarm CRITICAL diulang maks 3x, peringatan bila mute > 10 menit |
| Alert di web | Konfirmasi dua langkah, pratinjau notifikasi, level tertinggi menuntut mengetik `KIRIM` |
| Input laporan manual | Peta klik + pilih wilayah + tempel koordinat/tautan peta. Draf hanya di memori, dialog dapat diperkecil saat menelepon |
| Data sampel | **Seluruhnya fiktif**: Kota Contoh (`99.99`), 3 kecamatan, 6 kelurahan (persegi sederhana), 7 organisasi, 12 unit, 21 akun staf, 4 warga. Id deterministik (UUIDv5), idempoten, berpenanda `meta.seed` |
| Keamanan seed | Seed menolak berjalan bila `ENV=prod`. Sandi demo `Contoh#2026`, OTP tetap `123456` hanya di sampel |
| Nomor darurat sampel | **Nomor contoh** (bukan 112/110/113/118/119 asli) agar demo tidak menelepon layanan sungguhan. Lencana MODE SAMPEL |
| Role tambahan | **`ALERT_MANAGER`** (alert.create/close, condition_report.read) diberikan ke admin BPBD. Hak membuat alert tidak menempel pada semua `ORG_ADMIN` |
| Profil seed | `seed:base`, `seed:history` (30 incident/7 hari), `seed:reset-live`, `seed:verify` (14 pemeriksaan) |
| Simulator | `sim:bot` (responder tiruan lewat API/WebSocket asli: accept/reject/silent/flaky), `sim:flood` dan `sim:citizen` (memakai 120 warga simulasi sehingga batas laju tetap berlaku) |
| Skrip demo | 7 adegan ±45 menit: kecelakaan, offer ditolak/tak dijawab, kebakaran (atas nama unit), banjir, ketahanan offline, privasi/akses, penutup shift |
| Platform push | Android dulu (warga dan stakeholder). iOS dan web push ditunda. Satu proyek Firebase per lingkungan |
| Abstraksi penyedia | `NotificationProvider` dengan `FcmProvider` dan `MockProvider` (sampel jalan tanpa kredensial Firebase) |
| Jenis pesan FCM | Pesan kritis = **notification + data** (tampil walau aplikasi mati). Data-only hanya untuk `SYNC_HINT`, `SESSION_REVOKED`, `alert.closed` |
| Dispatch tidak memakai topic | Dikirim langsung ke token (butuh pelacakan per perangkat dan ack). Topic hanya untuk alert wilayah |
| Topic alert | `{env}_city`, `{env}_kec_{kode}`, `{env}_staff_alerts`, `{env}_test`. **Langganan dilakukan server**, bukan klien |
| Payload push | Tanpa data pribadi dan lokasi presisi. Hanya petunjuk (id, jenis, wilayah/jarak kasar). Data selalu diambil ulang lewat REST |
| Penggantian notifikasi | `tag` dan `collapse_key` sama per dispatch/alert/laporan, sehingga pembatalan menimpa alarm offer dan status laporan hanya menampilkan yang terbaru |
| Channel Android | Berversi (`dispatch_offer_v1`, `dispatch_update_v1`, `alert_critical_v1`, `alert_info_v1`, `report_update_v1`, `system_v1`), dibuat aplikasi saat pertama jalan |
| Eskalasi offer | Bertumpu pada `SEEN`, bukan `DELIVERED` (pada aplikasi mati ack `DELIVERED` bisa tidak datang). Kirim ulang FCM sekali pada 20 dtk |

---

## 3. Prinsip Desain

1. **Incident ≠ Report.** Satu kejadian bisa dilaporkan banyak warga.
2. **Incident ≠ Dispatch.** Satu incident bisa butuh banyak stakeholder, masing-masing dengan status sendiri.
3. **Status Incident kasar, status Dispatch rinci.** Tahap lapangan hanya ada di Dispatch.
4. **Admin/dispatcher adalah orchestrator**, bukan sekadar penerus pesan.
5. **Aplikasi hanya mengoordinasi resource yang ada di dalam sistem.** Pihak lain dikoordinasi (biasanya oleh pemegang komando) di luar aplikasi, hasilnya cukup dicatat sebagai milestone.
6. **Pencatatan mengikuti kenyataan lapangan.** Unit bisa berangkat lebih dulu (damkar), dan sistem tidak boleh menghambat.
7. **Dispatcher bisa mencatat atas nama pihak lain**, dengan penanda kanal dan waktu kejadian. Jalur telepon/WhatsApp yang sudah ada tetap berjalan berdampingan dengan aplikasi.
8. **Adopsi bertahap.** Sistem harus berguna walau stakeholder belum memakai aplikasi, dan makin berguna bila mereka memakainya.
9. **FCM bukan transport data utama**, hanya pembangun/pengingat.
10. **Jangan percaya notifikasi pasti sampai.** Perlu ack, retry, timeout, eskalasi.
11. **Audit log dan event log sejak awal.**

---

## 4. Arsitektur

```
Flutter Warga ───────────┐
Flutter/Web Stakeholder ─┼─► NestJS (REST + WebSocket Gateway) ─► PostgreSQL + PostGIS
Web Admin (Dispatcher) ──┘            │                            Redis/Valkey (pub/sub, cache, rate limit)
                                      ├─► FCM (push saat app background/mati)
                                      └─► Object storage (foto/video)
```

**Modul NestJS (usulan):**

```
src/
├── auth/            ├── incidents/       ├── alerts/
├── users/           ├── dispatch/        ├── notifications/
├── organizations/   ├── reports/         ├── locations/
├── units/           ├── regions/         ├── attachments/
├── audit/           ├── websocket/       └── common/
```

- Redis adapter untuk Socket.IO dipasang sejak awal, walau scaling horizontal belum prioritas.
- Web admin dan stakeholder bisa satu codebase web. Mobile satu codebase Flutter dengan flavor (warga vs stakeholder).

---

## 5. Model Domain

### 5.1 Hierarki stakeholder

```
Organization  (RSUD X, BPBD, Damkar, Polres)
   ├── Unit / Station  (IGD, Ambulans 01, Rescue Unit 02, Pos Damkar)
   │      └── Users (responder)
   └── Users (admin organisasi)
```

- Organisasi punya **wilayah layanan** (`service_area`: kecamatan atau polygon).
- Unit punya status ketersediaan dan posisi terakhir.
- Pemadam swasta (`type = PRIVATE_FIRE`) bisa didaftarkan nanti bila mau menjadi mitra.

### 5.2 Incident dan Report

```
Report A ─┐
Report B ─┼─► Incident #INC-20260930-000123
Report C ─┘
```

- `incident_reports` menghubungkan banyak laporan ke satu incident.
- Penggabungan duplikat = memindahkan report ke incident lain, incident sisa ditandai `DUPLICATE`.
- Penautan otomatis ke incident terdekat hanya **disarankan** ke dispatcher, tidak otomatis, karena salah gabung berbahaya. 🔶

### 5.3 Incident dan Dispatch

```
Incident #123  (lead_organization = Polres)
   ├── Dispatch #1 → Ambulans RS A   (RESPOND, ACCEPTED)
   ├── Dispatch #2 → Polisi          (RESPOND, ON_SCENE)
   └── Dispatch #3 → IGD RS A        (NOTIFY, SIAP)
```

**Field penting pada Dispatch:**

| Field | Nilai | Keterangan |
|-------|-------|------------|
| `type` | `RESPOND` / `NOTIFY` | RESPOND = berangkat ke lokasi. NOTIFY = hanya disiapkan menerima (IGD) |
| `origin` | `DISPATCHER` / `SELF_INITIATED` / `REQUESTED` | Siapa pemicunya. SELF_INITIATED = unit berangkat sendiri (damkar) |
| `recorded_by` | user id | Siapa yang mencatat (unit sendiri atau dispatcher atas nama unit) |
| `channel` | `APP` / `PHONE` / `WHATSAPP` / `RADIO` | Kanal asal informasi |
| `occurred_at` vs `recorded_at` | timestamp | Waktu kejadian bisa berbeda dari waktu pencatatan |

### 5.4 Elemen pendukung

- **`lead_organization_id`** di incident: pemegang komando di lokasi. Hanya organisasi ini yang boleh mengajukan resource request dan menandai milestone.
- **Resource request**: permintaan bantuan tambahan dari lead di lapangan, disetujui dispatcher (bukan membuat dispatch sendiri).
- **Milestone / catatan koordinasi** (di `incident_events`), contoh: `SCENE_RELEASED` (kendaraan boleh dipindah), `ROAD_REOPENED`, `VICTIM_DECEASED_HANDLED`, `EXTERNAL_UNIT_ARRIVED` (isi: nama organisasi, jumlah unit, sumber `DIPANGGIL`/`MANDIRI`), `EXTERNAL_COORDINATION`.
- **Data korban ringan**: jumlah luka dan meninggal, diperbarui unit lapangan. Tidak sampai identitas korban. 🔶
- **Tingkat keparahan** incident: ringan / sedang / berat / massal.

---

## 6. State Machine

### 6.1 Status Incident (kasar)

```
SUBMITTED → VERIFIED → IN_PROGRESS → RESOLVED → CLOSED
     │
     ├─► INVALID     (laporan palsu / tidak valid)
     └─► DUPLICATE   (digabung ke incident lain)
```

| Status | Arti |
|--------|------|
| SUBMITTED | Laporan masuk, belum ditangani admin |
| VERIFIED | Dispatcher memverifikasi kejadian nyata |
| IN_PROGRESS | Minimal satu dispatch berjalan |
| RESOLVED | Semua dispatch selesai |
| CLOSED | Ditutup setelah ringkasan lengkap (bisa otomatis setelah N jam tanpa aktivitas) |
| INVALID / DUPLICATE | Tidak ditindaklanjuti, alasan tercatat |

Status incident diturunkan dari kumpulan status dispatch. Tahap `EN_ROUTE`, `ON_SCENE`, dan sejenisnya **tidak** ditaruh di Incident (koreksi dari draf ChatGPT).

### 6.2 Status Dispatch tipe RESPOND

```
OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → DONE
   │
   ├─► REJECTED   (menolak, dispatcher memilih yang lain)
   ├─► EXPIRED    (tidak direspons dalam N menit, eskalasi)
   └─► CANCELLED  (dibatalkan dispatcher)
```

**Jalur self-initiated:** unit menekan "Saya berangkat" → dispatch langsung `EN_ROUTE`, melewati `OFFERED` dan `ACCEPTED`. Dispatcher mendapat notifikasi dan bisa mengonfirmasi atau menyesuaikan.

### 6.3 Status Dispatch tipe NOTIFY (IGD)

```
NOTIFIED → SIAP / PENUH → PASIEN_TIBA → DONE
```

Bila `PENUH`, dispatcher atau ambulans memilih RS lain.

### 6.4 Catatan

- Status `STANDBY` dan dispatch bersyarat (`depends_on`) **tidak dipakai di MVP**, karena izin pemindahan kendaraan adalah keputusan polisi yang dicatat sebagai milestone.
- Penanda internal `LIFE_SAFETY_DONE` (semua korban sudah ditangani) bisa dipakai di dashboard untuk membedakan "masih ada korban" dari "tinggal pembersihan". 🔶

---

## 7. Business Flow

### 7.1 Kecelakaan lalu lintas

**Dispatch dalam aplikasi:** ambulans (RESPOND), polisi (RESPOND), IGD (NOTIFY). **Lead:** polisi.

1. Warga melapor (jenis, lokasi, jumlah korban opsional, foto). Sistem menautkan atau menyarankan penautan ke incident aktif terdekat.
2. Dispatcher mengunci, memverifikasi, menetapkan keparahan.
3. Dispatcher membuat dispatch ke ambulans dan polisi (sistem merekomendasikan unit terdekat/tersedia/sesuai wilayah layanan). Info awal hanya kasar.
4. Stakeholder menerima (`ACCEPTED`), lokasi presisi dikirim, lalu `EN_ROUTE → ON_SCENE`.
5. Polisi mencatat jumlah korban luka dan meninggal serta kebutuhan tambahan sebagai catatan koordinasi.
6. Ambulans membawa korban luka, sistem mengirim NOTIFY ke IGD (jumlah, kondisi, ETA).
7. Polisi menandai milestone `SCENE_RELEASED` dan `ROAD_REOPENED`.
8. Semua dispatch `DONE` → dispatcher mengonfirmasi `RESOLVED` → `CLOSED`.

**Kasus multi-stakeholder** (kendaraan niaga, korban jiwa, kendaraan keluar jalur, macet):
- Derek dan Dishub dikoordinasi polisi di luar aplikasi.
- Korban meninggal diputuskan dan dikoordinasi polisi. Dicatat sebagai milestone saja, tidak ada notifikasi ke kamar jenazah.
- Jasa Raharja: belum ada keputusan, ditunda (cukup siapkan ekspor ringkasan incident).
- Kebutuhan tambahan (mis. damkar karena korban terjebak/BBM bocor) diajukan polisi lewat resource request, dispatcher yang membuat dispatch.

**Kasus tepi:**

| Situasi | Penanganan |
|---|---|
| Semua ambulans sibuk | Dispatch tetap dibuat dan antre, dispatcher diberi peringatan, minta bantuan wilayah tetangga manual |
| Pelapor bukan di lokasi | Lokasi bisa diubah, dispatcher konfirmasi lewat telepon |
| Tiba di lokasi, tidak ada kejadian | Unit menandai "tidak ditemukan", dispatcher memutuskan INVALID atau minta konfirmasi |
| Kecelakaan di perbatasan wilayah | Di luar polygon: peringatan ke dispatcher, ditangani manual |
| Pelapor membatalkan | Incident tidak otomatis batal, dispatcher memutuskan |
| Laporan susulan | Masuk sebagai report baru di incident yang sama, dispatcher dinotifikasi |

### 7.2 Kebakaran

**Dispatch dalam aplikasi:** damkar (RESPOND, sering SELF_INITIATED), ambulans (bila ada korban), polisi (bila perlu), IGD (NOTIFY). **Lead:** damkar.

1. Laporan masuk, dispatcher memverifikasi. Damkar sering sudah berangkat lebih dulu (info lewat telepon/WhatsApp).
2. Damkar menekan "Saya berangkat" atau dispatcher mencatat atas nama unit (`channel = PHONE/WHATSAPP`). 🔶 Catatan: agar damkar dapat menekan "Saya berangkat" sendiri, ia perlu menemukan incident (belum ada akses sebelum dispatch). Di sampel diganti "Terima dan berangkat" dari offer, dan penuhnya butuh `GET /incidents/by-code/{code}` (lihat dokumen Flutter bagian 10.5).
3. Dispatcher menambah resource yang kurang (ambulans, polisi).
4. Damkar tiba, mencatat skala, korban, kebutuhan bantuan. Bila api besar, mengajukan resource request untuk pos lain.
5. Pemadam swasta yang hadir (dipanggil atau inisiatif sendiri) dicatat sebagai `EXTERNAL_UNIT_ARRIVED`. Belum menjadi stakeholder terdaftar.
6. Api padam, pendinginan, damkar menandai `DONE`. Dispatcher menutup incident.

**Tingkat eskalasi (usulan, sesuaikan dengan istilah damkar setempat):** 🔶

| Level | Kondisi | Resource |
|---|---|---|
| 1 | Kebakaran kecil | 1 pos |
| 2 | Sedang, berpotensi menyebar | Beberapa pos, ambulans siaga |
| 3 | Besar / massal | Semua pos, bantuan wilayah tetangga, supervisor turun |

**Catatan:**
- Aplikasi tidak menggantikan telepon/WA, tetapi harus **lebih mudah daripada WA**. Nilai tambah untuk damkar: lokasi presisi + navigasi, foto dan detail dalam satu tempat, riwayat dan laporan otomatis.
- Dispatcher perlu melihat jelas "sudah ada N unit menuju lokasi" agar tidak menambah dispatch yang tidak perlu.
- Struktur komando antar-pos saat api besar belum diketahui dan belum dimodelkan.

### 7.3 Banjir (draf, banyak asumsi)

**Dispatch dalam aplikasi:** BPBD/tim rescue (RESPOND), ambulans (RESPOND), RS (NOTIFY). **Lead:** BPBD (bisa berpindah bila melibatkan TNI/Basarnas, cukup ubah `lead_organization` dan catat).

**Perbedaan dengan kasus lain:** area luas, laporan banyak, berkembang bertahap (ada peringatan dulu), kebutuhan beragam (evakuasi, medis, logistik).

**Dua jenis laporan warga** (dipilih pelapor di aplikasi):

| Jenis | Contoh | Perlakuan |
|---|---|---|
| Saya butuh bantuan | "Rumah terendam, ada lansia dan bayi" | Masuk antrean dispatcher sebagai incident |
| Saya melaporkan kondisi | "Air setinggi lutut di Jl. Mawar" | Tidak ada dispatch, jadi data pemantauan di peta |

**Tiga fase:**
1. **Peringatan:** admin/BPBD membuat Alert (level mengikuti istilah BPBD, mis. Waspada/Siaga/Awas) untuk wilayah terdampak → push ke warga berdasarkan lokasi rumah. 🔶
2. **Tanggap darurat:** laporan bantuan masuk antrean (dikelompokkan berdasarkan kedekatan), dispatcher memverifikasi, menggabungkan duplikat, memprioritaskan (bayi, lansia, difabel, sakit), lalu dispatch. BPBD memimpin, melaporkan perkembangan lewat catatan koordinasi.
3. **Pemulihan:** alert diturunkan/ditutup, ringkasan dibuat. Logistik dan pendataan kerusakan **ditunda**.

**Opsi struktur: Disaster Event (entitas induk)** 🔶

```
Disaster Event: "Banjir Kecamatan X, 2 Okt 2026" (area, level, status)
   ├── Alert
   ├── Incident (warga terjebak, lansia butuh evakuasi, korban sakit)
   └── Laporan situasi
```

Memberi BPBD satu tampilan peristiwa alih-alih ratusan incident terpisah. Bisa ditunda di MVP, banjir ditangani dengan Alert + Incident biasa dulu.

**Masalah khas dan penanganan awal:**

| Masalah | Penanganan |
|---|---|
| Lonjakan laporan | Pengelompokan lokasi + waktu, penggabungan duplikat, laporan situasi disaring dari antrean |
| Sinyal/listrik padam | Antrean offline di app, opsi SMS, input manual dispatcher |
| Dispatcher kewalahan | Aturan prioritas, supervisor membagi wilayah |
| Laporan palsu/salah wilayah | Validasi polygon, skor pelapor |
| Sumber daya terbatas | Antrean prioritas, daftar yang belum terlayani terlihat |

**Cakupan MVP banjir:** Alert manual oleh admin/BPBD, laporan warga dua jenis, Incident + Dispatch biasa, penggabungan duplikat manual, catatan koordinasi dan resource request.
**Ditunda:** integrasi otomatis BMKG/sensor, peta pemantauan canggih, Disaster Event penuh, pengelompokan otomatis, logistik dan pengungsian.

---

## 8. Role & Permission

Aturan akses ditentukan tiga lapis: **role** (siapa dia), **scope** (organisasi/unit mana), dan **relasi ke incident** (lead, terkait, atau tidak terlibat).

### 8.1 Role

| Role | Siapa | Catatan |
|---|---|---|
| Warga | Pelapor terdaftar | Self-register dengan OTP |
| Responder | Petugas di unit | Akun terikat ke satu unit |
| Admin Organisasi | Pengelola akun satu stakeholder | Hanya untuk organisasinya |
| Dispatcher | Operator command center | Bekerja per shift |
| Supervisor | Pengawas dispatcher | Override dan lihat semua |
| Super Admin | Pengelola sistem | Konfigurasi, tidak menangani incident 🔶 |

Opsional nanti: **Viewer/Pimpinan** (read-only dashboard dan statistik). 🔶

### 8.2 Matriks permission (MVP)

`own` = hanya milik sendiri, `lead` = hanya bila organisasinya pemegang komando, `terkait` = hanya bila punya dispatch di incident itu.

| Aksi | Warga | Responder | Admin Org | Dispatcher | Supervisor | Super Admin |
|---|---|---|---|---|---|---|
| Buat laporan | ✓ | | | ✓ (manual) | ✓ | |
| Lihat laporan sendiri | own | | | | | |
| Lihat antrean semua incident | | | | ✓ | ✓ | ✓ (baca) |
| Kunci / buka incident | | | | ✓ | ✓ (override) | |
| Verifikasi, INVALID, gabung duplikat | | | | ✓ | ✓ | |
| Buat dispatch | | | | ✓ | ✓ | |
| Terima / tolak offer | | own unit | | | | |
| "Saya berangkat" | | own unit | | | | |
| Catat atas nama unit | | | | ✓ | ✓ | |
| Update status dispatch | | own | | ✓ (atas nama) | ✓ | |
| Catat milestone / catatan koordinasi | | lead | | ✓ | ✓ | |
| Update data korban | | terkait | | ✓ | ✓ | |
| Ajukan resource request | | lead | | | | |
| Setujui resource request | | | | ✓ | ✓ | |
| Ubah `lead_organization` | | | | ✓ | ✓ | |
| Tutup incident | | | | ✓ | ✓ | |
| Buat / cabut alert bencana | | | ✓ (BPBD) 🔶 | ✓ | ✓ | |
| Kelola akun organisasi sendiri | | | ✓ | | | |
| Kelola organisasi dan semua akun | | | | | | ✓ |
| Lihat audit log | | | own org | | ✓ | ✓ |

Alasan utama:
- Hanya dispatcher/supervisor yang membuat dispatch. Responder hanya mengajukan resource request.
- Resource request dan milestone hanya dari lead, agar tidak ada permintaan ganda yang membingungkan.
- Super Admin dipisah dari operasional demi audit.

### 8.3 Visibilitas data

| Data | Warga | Responder (belum accept) | Responder (sudah accept) | Dispatcher/Supervisor |
|---|---|---|---|---|
| Jenis kejadian | ✓ | ✓ | ✓ | ✓ |
| Wilayah kasar + perkiraan jarak | | ✓ | ✓ | ✓ |
| **Lokasi presisi** | own | ✗ | ✓ | ✓ |
| Foto dan catatan laporan | own | ✗ | ✓ | ✓ |
| **Identitas/kontak pelapor** | own | ✗ | 🔶 hanya bila perlu | ✓ |
| Status dispatch unit lain | | ✗ | ringkasan | ✓ |
| Data korban | | ✗ | terkait | ✓ |

- **Lead organization** melihat ringkasan seluruh incident dan semua dispatch. Non-lead hanya dispatch miliknya + ringkasan siapa yang hadir.
- Identitas pelapor default hanya untuk dispatcher. Ke responder: nama depan atau tombol "telepon lewat sistem". 🔶
- Warga hanya melihat status disederhanakan ("Ambulans menuju lokasi").
- IGD hanya menerima info medis seperlunya (jumlah, kondisi, ETA).

### 8.4 Keamanan akun

| Hal | Usulan |
|---|---|
| Akun stakeholder | Dibuat Admin Organisasi, organisasi diverifikasi Super Admin. Tidak boleh self-register |
| Dispatcher & supervisor | 2FA wajib |
| Responder | Akun personal, bukan akun bersama per unit 🔶 (cek apakah petugas bergantian memakai satu ponsel dinas) |
| Pergantian petugas | Admin Org menonaktifkan akun, token FCM dicabut |
| Sesi dispatcher | Per shift, kunci incident otomatis lepas bila sesi berakhir |
| Audit | Pembukaan data pelapor, perubahan lead, override kunci, pencatatan atas nama unit tercatat |

### 8.5 Implementasi NestJS

- Permission berbentuk string (`incident.verify`, `dispatch.create`, `milestone.create`, `alert.create`). Role = kumpulan permission.
- Pengecekan scope dan relasi di policy layer (mis. CASL 🔶), bukan di controller.
- Data sensitif disaring di serializer sesuai role dan fase dispatch, sehingga lokasi presisi tidak pernah terkirim ke responder yang belum accept.
- Room WebSocket per role dan per organisasi. Responder masuk room incident hanya setelah `ACCEPTED`.

---

## 9. Realtime dan Notifikasi

Spesifikasi lengkap ada di **`websocket-aplikasi-darurat.md`**. Ringkasan:

| Kanal | Peran |
|-------|-------|
| WebSocket (Socket.IO) | Mengantar event saat app terbuka: antrean dispatcher, offer, status dispatch, status laporan warga, alert wilayah |
| FCM | Membangunkan app background/mati dan menjadi jalur kedua event CRITICAL. High priority, channel Android khusus (suara alarm) untuk stakeholder. Spesifikasi lengkap di **`fcm-aplikasi-darurat.md`** |
| REST | **Satu-satunya jalur tulis** dan sumber kebenaran. Juga untuk pemulihan setelah reconnect |

**Prinsip:**
- Event hanyalah pemberitahuan. Keadaan yang benar ada di database/REST.
- Event dibentuk per audiens (dispatcher, unit, lead, warga) dan mengikuti aturan visibilitas data yang sama dengan REST, sehingga lokasi presisi tidak pernah terkirim ke responder yang belum accept.
- Pengiriman at-least-once, urutan berdasar `incident_events.id`, klien membuang duplikat dengan `eid`.
- Event kritis (offer dispatch, resource request, penolakan/kedaluwarsa) dikirim lewat WebSocket **dan** FCM bersamaan, dengan ack dan eskalasi.

**Ringkasan event utama:** `incident.created/updated/status_changed/locked/merged/lead_changed/casualties_updated/milestone_recorded`, `dispatch.offered/notified/created/accepted/rejected/expired/cancelled/self_initiated/status_changed/offer_unseen`, `resource_request.created/decided`, `report.status_changed`, `alert.published/updated/closed`, `notification.created`, `unit.status_changed`, serta event sesi (`connection.ready`, `auth.expiring`, `session.revoked`). Klien → server hanya: `ack`, `auth.refresh`, `app.state`, `unit.location`.

---

## 10. Alert Bencana

- Alert dipisah dari Incident. Alert = peringatan wilayah, Incident = kejadian spesifik.
- Sumber awal: **input manual** admin/BPBD. Integrasi BMKG/BNPB/InaRISK menyusul.
- Warga mendaftar dengan **lokasi rumah** (titik + kode wilayah).
- Distribusi: FCM topic per kecamatan, atau geofencing radius/polygon lewat PostGIS.
- Riwayat notifikasi disimpan di dalam app.
- Alert kemacetan/lalu lintas tidak dibuat di fase awal.

---

## 11. Lokasi dan Privasi

- Simpan: latitude, longitude, akurasi GPS, alamat (reverse geocoding), kecamatan, kelurahan, waktu.
- Pelapor bisa menggeser pin dan mengonfirmasi alamat.
- Validasi koordinat terhadap batas wilayah. Di luar area: tolak atau beri peringatan.
- Lokasi presisi dan identitas pelapor dibuka bertahap.
- Patuhi UU PDP: enkripsi, pembatasan akses, kebijakan retensi.

---

## 12. Anti-Spam dan Keandalan

- OTP nomor HP, rate limit, skor reputasi pelapor, penanda INVALID oleh admin.
- Antrean offline di Flutter.
- **Fallback tombol telepon** (112, 118/119, damkar, BPBD) dan/atau SMS.
- Mitigasi kejadian besar (fase 2): penggabungan duplikat dan pengelompokan otomatis berdasarkan lokasi + waktu.

---

## 13. Operasional dan Konsekuensi Berdiri Sendiri

- Perlu tim dispatcher (idealnya 24 jam). Bila tidak, tampilkan **jam operasional** dengan jelas di aplikasi warga.
- Aplikasi warga satu-satunya pintu masuk: wajib ada disclaimer dan tombol telepon darurat resmi.
- Penguncian incident agar tidak terjadi dispatch ganda, serah terima shift, dan input laporan manual oleh dispatcher.
- Perlu kesepakatan/MoU stakeholder, dimulai dengan pilot (1-2 IGD, 1 pos damkar, polisi, BPBD).
- Status laporan transparan, termasuk alasan bila ditolak atau di luar wilayah.

**Kesiapan integrasi 112:** kolom `source` (`MOBILE_APP`, `ADMIN_MANUAL`, kelak `CALL_CENTER_112`), `external_ref_id`, REST API terdokumentasi (OpenAPI) dengan API key, tabel referensi jenis kejadian.

---

## 14. Basis Data dan API (ringkasan)

### 14.1 Basis data (ERD v1.3)

Spesifikasi lengkap (diagram Mermaid, kolom, tipe, index, nilai status, pemetaan kebutuhan) ada di **`erd-aplikasi-darurat.md`**.

| Kelompok | Tabel | Fase |
|---|---|---|
| Identitas & akses | `users`, `staff_profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `auth_sessions`, `otp_requests`, `device_tokens` | 1 |
| Wilayah & organisasi | `regions`, `organizations`, `organization_service_areas`, `units` | 1 |
| Referensi | `incident_types`, `system_settings` | 1 |
| Kejadian | `incidents`, `incident_reports`, `attachments`, `incident_casualties` | 1 |
| Penugasan | `dispatches`, `dispatch_status_history`, `resource_requests` | 1 |
| Log | `incident_events`, `audit_logs`, `outbox_events` | 1 |
| Operasional | `dispatcher_shifts` | 1 |
| Notifikasi | `notifications`, `notification_deliveries`, `device_topic_subscriptions` | 1 |
| Alert bencana | `disaster_alerts`, `disaster_alert_regions` | 1 (manual), 2 (otomatis) |
| Peristiwa induk | `disaster_events` | 2 🔶 (opsional) |

**Prinsip ERD:**
- Perubahan alur diharapkan hanya menyentuh data/konfigurasi (status, tipe, permission, milestone), bukan struktur tabel.
- `incident_events` adalah catatan serbaguna (audit, timeline warga, milestone, sinkronisasi) dengan `payload` JSONB.
- Data inti tetap kolom biasa agar bisa di-index. JSONB hanya untuk data yang memang tidak pasti.
- Perubahan konsep yang berisiko merombak ERD: Disaster Event (banjir), dispatch bersyarat, satu akun banyak organisasi, lead organization bersama, dan integrasi 112 dengan siklus hidup berbeda.

### 14.2 Kontrak REST API v1

Spesifikasi lengkap ada di **`rest-api-aplikasi-darurat.md`**. Ini adalah **kontrak/spesifikasi, bukan source code**. Pengerjaan kodenya oleh agent code, dengan urutan: kontrak (Markdown) → tinjau → OpenAPI YAML → dokumen serah terima agent.

| Modul | Isi utama |
|---|---|
| Auth & akun | OTP warga, login staf + 2FA, refresh berotasi, sesi, perangkat FCM |
| Referensi & konfigurasi | `/config/public` (nomor darurat, jam operasional, tersedia sebelum login), jenis kejadian, wilayah, `regions/resolve` |
| Lampiran | Unggah 3 langkah (minta URL → PUT ke storage → konfirmasi) |
| Laporan warga | `HELP_REQUEST` dan `CONDITION_REPORT`, idempoten, susulan, tarik laporan, timeline `PUBLIC` |
| Incident | Antrean, kunci + heartbeat, verifikasi, INVALID, merge, nearby, lead, resolve/close, korban, milestone, buka kontak pelapor (diaudit) |
| Dispatch | Single/batch, atas nama unit, "Saya berangkat", accept/reject/status, pilih RS tujuan (membuat NOTIFY ke IGD), cancel |
| Resource request | Diajukan lead, diputuskan dispatcher, menghasilkan dispatch `REQUESTED` |
| Alert | Daftar warga per wilayah, admin buat/publish/tutup, peta laporan kondisi |
| Notifikasi | Riwayat in-app, tandai dibaca, ack terima |
| Shift & dashboard | Mulai/akhir shift, ringkasan serah terima, `summary` |
| Admin | Organisasi, unit, staf, role, audit, pengaturan |
| Sinkronisasi | `/sync/snapshot` dan `/sync/events` untuk reconnect |

Dokumen API juga memuat katalog permission, tampilan data per role, tabel transisi status, katalog error, rate limit, daftar aksi wajib-audit, dan 8 skenario uji (S1-S8) dari business flow sebagai kriteria penerimaan.

---

## 15. Roadmap

**Fase 1 (MVP)**
- Warga: registrasi OTP, lapor + lokasi + foto (dua jenis laporan), pantau status, tombol telepon darurat.
- Dispatcher: antrean, verifikasi, input manual, dispatch, pencatatan atas nama unit, penguncian, resource request, milestone.
- Stakeholder: terima offer, "Saya berangkat", lihat lokasi setelah accept, update status, resource request (lead).
- Alert manual per wilayah, audit log + event log, WebSocket + FCM dasar.

**Fase 2**
- Integrasi BMKG, broadcast otomatis, riwayat notifikasi.
- Penggabungan dan pengelompokan otomatis laporan, Disaster Event.
- Pemadam swasta sebagai stakeholder terdaftar, Viewer/Pimpinan.

**Fase 3**
- Live tracking unit, rekomendasi stakeholder terdekat, dashboard peta, statistik.
- Opsional: chat responder, kapasitas rumah sakit, alert lalu lintas, integrasi 112/Jasa Raharja, logistik bencana.

---

## 16. Pertanyaan Terbuka

> Selama pembangunan aplikasi sampel, pertanyaan di bagian ini **tidak menghalangi**. Nilai default dipakai (bagian 18) dan ditanyakan ke client setelah sampel berjalan.

**Keputusan internal**
- [ ] Siapa yang mengoperasikan dispatcher, dan apakah bisa 24 jam?
- [ ] Instansi mana saja yang menjadi pilot?
- [ ] Apakah data polygon kecamatan/kelurahan tersedia?
- [ ] Batas waktu offer sebelum `EXPIRED`, batas waktu laporan `SUBMITTED` sebelum eskalasi ke supervisor, dan kapan incident otomatis ditutup.
- [ ] Apakah aplikasi warga juga untuk iOS, atau Android dulu?
- [ ] Kebijakan retensi data laporan dan lokasi.
- [ ] Apakah satu akun boleh punya banyak role?
- [ ] Siapa berwenang membuat alert bencana: BPBD sendiri atau dispatcher saja?
- [ ] Apakah responder boleh melihat nomor pelapor langsung?
- [ ] Akun responder personal atau per unit?
- [ ] ERD: apakah satu petugas bisa terikat ke lebih dari satu organisasi? (MVP: satu)
- [ ] ERD: apakah satu unit boleh aktif di dua incident sekaligus? (menentukan unique partial pada dispatch aktif)
- [ ] ERD: laporan kondisi banjir cukup `incident_id` null, atau perlu incident bertipe `CONDITION`?
- [ ] ERD: perlu data korban lebih rinci dari jumlah luka/meninggal/kritis/hilang?
- [ ] API: laporan di luar wilayah diterima dengan flag (draf) atau ditolak?
- [ ] API: masa berlaku refresh token (warga 30 hari, staf 12 jam) dan masa kunci incident (5 menit + heartbeat).
- [ ] API: boleh melompati tahap dispatch ke depan? Mundur status hanya supervisor?
- [ ] API: responder boleh melihat kontak pelapor langsung, atau selalu lewat dispatcher? (draf: lewat dispatcher)
- [ ] API: dispatcher boleh memaksa dispatch ke unit yang tidak `AVAILABLE` (`ignoreAvailability`)?
- [ ] API: siapa yang boleh membuat alert (BPBD sendiri, dispatcher, atau keduanya)?
- [ ] API: batas Admin Organisasi saat membuat akun (hanya `RESPONDER` dan `ORG_ADMIN`)?
- [ ] API: angka rate limit dan batas lampiran (10 MB foto, 50 MB video, 5 lampiran) disetel setelah pilot.
- [ ] API: perlu endpoint ekspor/ringkasan incident (laporan akhir, kebutuhan Jasa Raharja kelak)?
- [ ] ERD: istilah level alert dan level eskalasi kebakaran yang baku (mengisi `disaster_alerts.level` dan `escalation_level`).

- [ ] FCM: aplikasi stakeholder didistribusikan lewat Play Store atau internal? (menentukan full-screen intent, alarm berulang, pengecualian baterai)
- [ ] FCM: warga juga memakai iOS? (akun Apple Developer, APNs, `time-sensitive` atau critical alerts)
- [ ] FCM: perlu penanda "bertugas" (on-duty) pada responder agar offer ke organisasi besar tidak membangunkan semua staf?
- [ ] FCM: level alert mana yang diperlakukan CRITICAL (mengikuti istilah BPBD)?
- [ ] FCM: perlu cadangan non-push (SMS/panggilan otomatis) bila responder tidak terjangkau?
- [ ] Flutter: damkar yang berangkat duluan perlu menemukan incident lewat kode (`GET /incidents/by-code/{code}`)? Sampel memakai "Terima dan berangkat" dari offer.
- [ ] Flutter: `accept`/`reject` offline tidak diantrekan, setuju? Logout dengan laporan belum terkirim (hapus, tahan, atau larang)?
- [ ] Flutter: peta (OSM vs Google Maps), basis data lokal (`drift` vs lainnya), crash reporting, dan satu aplikasi dua peran vs dua flavor.
- [ ] Dashboard: jumlah dispatcher per shift dan apakah aksi wajib dalam shift aktif; kebijakan alarm dan kunci layar otomatis saat idle.
- [ ] Dashboard: sumber geocoding/POI untuk mengubah alamat menjadi koordinat (sampel: peta klik + pilih wilayah + tempel koordinat).
- [ ] Dashboard: alert dengan polygon/geofence dan estimasi penerima; pustaka UI (shadcn/Tailwind vs Ant Design/MUI).
- [ ] Dashboard: responder di web (selain Android), layar besar/video wall, retensi riwayat yang dapat dicari.
- [ ] Dashboard: refresh token klien web dengan cookie HttpOnly pada produksi (perlu penyesuaian REST).
- [ ] Deployment: hosting (pemda/penyedia domestik/lainnya) dan situs DR; penyelenggara sistem elektronik secara hukum; on-call 24 jam; standar keamanan instansi; penyedia SMS; retensi; MDM dan distribusi aplikasi staf; anggaran dan jangka waktu pilot; sumber tile peta (rincian Q-101..Q-109 di `DECISIONS.md`).
- [ ] Seed/demo: ganti data fiktif dengan wilayah, organisasi, unit, dan nomor darurat resmi; rekomendasi sumber daya per jenis kejadian menurut praktik lapangan; hak membuat alert (`ALERT_MANAGER` hanya BPBD atau dispatcher juga); jenis kejadian tambahan.

**Untuk ditanyakan ke stakeholder**

*Damkar*
- [ ] Siapa yang mengoordinasi saat api besar dan butuh beberapa pos?
- [ ] Bagaimana level kebakaran ditentukan, adakah istilah baku?
- [ ] Apakah ada call center tunggal atau nomor tiap pos berbeda?
- [ ] Petugas memakai ponsel pribadi atau perangkat dinas?
- [ ] Apa yang paling merepotkan saat menerima laporan lewat WA?

*BPBD*
- [ ] Informasi paling awal banjir datang dari mana (warga, relawan, sensor, BMKG)?
- [ ] Apakah ada pos pemantau tinggi muka air dan datanya bisa diakses?
- [ ] Siapa menentukan level Waspada/Siaga/Awas, dan apa kriterianya?
- [ ] Berapa laporan masuk saat banjir besar, lewat apa?
- [ ] Bagaimana prioritas evakuasi ditentukan sekarang?
- [ ] Apakah sudah punya aplikasi/sistem pemantauan sendiri?
- [ ] Informasi apa yang paling sering ditanyakan warga saat banjir?

*Polisi dan lainnya*
- [ ] Apakah ada momen formal "TKP selesai, kendaraan boleh dipindah" yang bisa dijadikan aksi di aplikasi?
- [ ] Kebutuhan integrasi dengan Jasa Raharja?
- [ ] Apakah petugas bergantian memakai satu ponsel dinas?

---

## 17. Langkah Berikutnya

1. ✅ Business flow: kecelakaan, kebakaran, banjir (banjir masih draf, menunggu masukan BPBD).
2. ✅ Role & permission.
3. ✅ **ERD v1.3** (`erd-aplikasi-darurat.md`).
4. ✅ **Kontrak REST API v1** (`rest-api-aplikasi-darurat.md`).
5. ✅ **Spesifikasi WebSocket v1** (`websocket-aplikasi-darurat.md`).
6. ✅ **Spesifikasi FCM v1** (`fcm-aplikasi-darurat.md`).
7. ✅ **Arsitektur Flutter v1** (`flutter-aplikasi-darurat.md`): GetX, MVC + services, struktur direktori, katalog controller/rute, alur utama, outbox offline, skenario uji A1-A10 dan B1-B13.
8. ✅ **Spesifikasi dashboard web v1** (`dashboard-aplikasi-darurat.md`): Vite + React, console dispatcher, alur kerja (kunci, verifikasi, dispatch, atas nama unit, gabung, resolve), realtime, alert, shift, admin, keamanan, skenario uji D1-D20.
9. ✅ **Data seed dan skrip demo v1** (`seed-demo-aplikasi-darurat.md`): wilayah fiktif, organisasi, unit, role/permission, akun, jenis kejadian, pengaturan, riwayat, simulator, skrip demo 7 adegan, `seed:verify` V1-V14.
10. ✅ **Dokumen serah terima untuk agent code v1** (`handoff-agent-code-aplikasi-darurat.md`) + `AGENTS.md` + `CLAUDE.md`: sumber kebenaran, aturan kerja, struktur repo, lingkungan dev, rencana Fase 0-6 (backend) dengan jalur dashboard (Dx1-Dx7) dan mobile (Mx1-Mx8), kriteria selesai, matriks skenario uji, konvensi backend, antrean job, perangkap umum, titik tinjau C0-C4.
11. ⏭️ **Konversi kontrak ke OpenAPI 3.1 dan AsyncAPI 3 + contoh JSON untuk quicktype** dikerjakan sebagai **Fase 0** (contract-first) oleh agent code, dengan pemeriksaan cakupan terhadap dokumen dan persetujuan manusia (C0). Disebabkan ±130 endpoint dan ±60 event, penyusunannya paling aman otomatis dan diverifikasi skrip, bukan ditulis tangan.
12. ✅ **Dokumen deployment produksi v1** (`deployment-aplikasi-darurat.md`): prinsip, target layanan, hosting dan kepatuhan, topologi, keamanan, konfigurasi produksi, CI/CD dan rilis, observabilitas, degradasi dan DR, runbook, operasi data, uji beban/kekacauan, go-live. Dikerjakan sebagai **Fase 7 setelah sampel disetujui**.
13. Setelah sampel: bawa daftar 🔶 (bagian 16 dan dokumen turunan) ke client dan stakeholder.

---

## 18. Mode Aplikasi Sampel (Asumsi Default)

Tujuan: membangun sampel yang bisa didemokan ke client **tanpa menunggu** semua keputusan lapangan. Semua nilai di bawah disimpan di `system_settings` atau seed data, sehingga mudah diubah setelah ada masukan.

### 18.1 Asumsi default untuk poin 🔶

| Hal | Default sampel |
|---|---|
| Laporan di luar wilayah layanan | Diterima dengan penanda `OUT_OF_AREA`, dispatcher memutuskan |
| Masa refresh token | Warga 30 hari, staf 12 jam |
| Masa kunci incident | 5 menit, perpanjang tiap 60 detik |
| Mundur status | Hanya supervisor dengan alasan. Melompati tahap dispatch ke depan boleh |
| Kontak pelapor untuk responder | Tidak ditampilkan, lewat dispatcher |
| Memaksa dispatch ke unit tidak tersedia | Boleh (`ignoreAvailability`), tercatat di audit |
| Pembuat alert bencana | Admin Organisasi BPBD, dispatcher, dan supervisor |
| Batas akun yang dibuat Admin Org | Hanya `RESPONDER` dan `ORG_ADMIN` |
| Batas lampiran | Foto 10 MB, video 50 MB, 5 per laporan |
| Batas waktu offer | 120 detik |
| Eskalasi laporan `SUBMITTED` tak tertangani | 3 menit ke supervisor |
| Penutupan otomatis incident | 24 jam setelah `RESOLVED` |
| Satu unit aktif di dua incident | Tidak dibatasi keras (peringatan saja) |
| Satu petugas, banyak organisasi | Tidak (satu organisasi) |
| Disaster Event, live tracking, BMKG otomatis | Ditunda (di luar sampel) |

### 18.2 Disederhanakan khusus untuk sampel

| Komponen | Cara di sampel |
|---|---|
| OTP | Penyedia tiruan (`OTP_PROVIDER=mock`), kode tetap `123456` pada lingkungan sampel. Tidak butuh gateway SMS |
| Notifikasi push | Penyedia dapat dipilih (`NOTIFICATION_PROVIDER=mock|fcm`). Mode `mock` mencatat saja agar sampel jalan tanpa kredensial FCM. Pengujian perangkat nyata memakai `fcm` |
| Wilayah | Seed wilayah **fiktif** (satu kota, 3 kecamatan, beberapa kelurahan, polygon sederhana). Data polygon asli menyusul |
| Geocoding alamat | Alamat diisi manual/dari pin. Tanpa layanan reverse geocoding eksternal |
| Object storage | MinIO lokal |
| Instance | Satu instance backend, satu Redis, satu PostgreSQL+PostGIS (Docker Compose) |
| Push | Default `mock`. Uji perangkat nyata dengan proyek Firebase `dev` (dua app id: `CITIZEN`, `STAFF`), Android saja, tanpa web push, tanpa full-screen intent |
| Penerima dispatch ke organisasi | Semua responder aktif (belum ada penanda bertugas) |
| ORM dan geospasial | **TypeORM + SQL mentah untuk PostGIS** (pilihan Anda: pustaka geospasial terbatas, SQL manual lebih terkendali) |
| Model Dart | **Dibuat pemilik proyek dengan quicktype** dari contoh JSON. Agent menyediakan `contracts/examples/` lengkap (varian null/opsional, semua nilai enum, per audiens) dan menjaganya cocok dengan respons nyata |
| Pemilik keputusan | **Satu orang (pemilik proyek)**. Pertanyaan non-blokir memakai default, pertanyaan blokir dikelompokkan di `QUESTIONS.md`, titik tinjau C0-C4 selalu berhenti |
| Repo, CI, nama target `make` | **Belum diketahui**, default sementara: monorepo dan target `make`, CI-agnostik. Pertanyaan Q-001..Q-005 akan diajukan pemilik ke tim (`DECISIONS.md`) |
| Pola agent code | Contract-first: OpenAPI/AsyncAPI dibuat di Fase 0 dan disetujui manusia (C0) sebelum kode. Kerja per fase dengan gerbang berupa skenario uji. Agent tidak boleh mengarang endpoint/field/event dan mencatat usulan di `CONTRACT_CHANGES.md` |
| Rencana fase | Backend Fase 0-6 berurutan. Dashboard (Dx1-Dx7) dan mobile (Mx1-Mx8) berjalan paralel setelah Fase 0 dengan mock server dari kontrak |
| Outbox | Event ditulis ke `outbox_events` dalam transaksi yang sama dengan perubahan data, dikirim setelah commit, at-least-once, `eid` sama untuk WebSocket dan FCM |
| Titik tinjau manusia | C0 (kontrak), C1 (API laporan/incident), C2 (dispatch headless), C3 (realtime perangkat nyata), C4 (latihan skrip demo penuh) |
| Berkas konteks agent | `AGENTS.md` (aturan wajib ringkas) dan `CLAUDE.md` (menunjuk AGENTS.md) di akar repositori |
| Deployment produksi | **Dirancang portabel** (kontainer, PostgreSQL+PostGIS, Redis, penyimpanan S3-kompatibel). Pilot: Docker Compose + Ansible, 2 edge, 2 API, 2 worker, PostgreSQL primer+replika, Redis+Sentinel, pemantauan terpisah, DR warm standby. Hosting menunggu instansi |
| Pemisahan peran backend | `ROLE=api\|worker\|all`: lalu lintas pengguna dipisah dari job (pewaktu offer, FCM, outbox) |
| Prinsip degradasi | Penerimaan laporan dan dispatch **tetap berjalan** saat Redis, object storage, FCM, atau SMS jatuh. Redis bukan sumber kebenaran (event aman di `outbox_events` PostgreSQL). Nomor darurat dan antrean offline di aplikasi tetap ada |
| Target layanan (usulan) | Pilot 99,5%, produksi 99,9%; RPO ≤ 5 menit; RTO ≤ 60 menit (pilot), ≤ 30 menit (target) |
| Data dan kepatuhan | Data dan situs cadangan **di Indonesia** (default). Status sistem sebagai penyelenggara sistem elektronik lingkup publik, pendaftaran, dan pelindungan data pribadi perlu dikonfirmasi dengan hukum/pemda. Tile peta produksi bukan tile publik OSM |
| Pembekuan perubahan | Tidak ada rilis saat alert tingkat tertinggi/bencana besar aktif. Rilis bergulir, migrasi kompatibel mundur, citra yang sama dipromosikan staging → produksi |
| Pemulihan | Pemulihan dari cadangan diuji **bulanan**, DR drill **dua kali setahun**, SOP manual saat sistem mati (pencatatan susulan memakai input manual dan catat atas nama unit) |
| Data/demo | Data fiktif Kota Contoh, nomor darurat contoh, sandi staf `Contoh#2026` (2FA mati), OTP `123456`, riwayat 30 incident opsional, warga simulasi 120, bot responder lewat API asli |
| Dashboard web | Vite + React + TS, tema gelap default, WIB, refresh token di `sessionStorage`, 2FA dimatikan, polling cadangan 10 dtk, alert mode kecamatan saja, ringkasan angka saja, tanpa geocoding eksternal |
| Flutter | Android saja, GetX + MVC/services, `drift` untuk outbox, `flutter_map`/OSM, outbox hanya saat aplikasi aktif, posisi unit hanya di latar depan, alarm hanya saat layar offer terbuka |
| Token FCM basi | 60 hari tidak terlihat. Maksimal 5 token per pengguna |

### 18.3 Data seed sampel

- **Organisasi:** Command Center, Polres Kota (`POLICE`), Damkar Kota dengan 2 pos (`FIRE`), RSUD Kota dengan IGD (`HOSPITAL`), Layanan Ambulans (`AMBULANCE_SERVICE`), BPBD (`BPBD`).
- **Unit:** 2 ambulans, 2 mobil damkar, 1 patroli polisi, 1 tim rescue BPBD, 1 IGD.
- **Akun:** 1 super admin, 1 supervisor, 2 dispatcher (2FA dimatikan di sampel), 1 admin organisasi per stakeholder, 1-2 responder per unit, 3 warga.
- **Jenis kejadian:** kecelakaan lalu lintas, kebakaran, banjir (mengizinkan laporan kondisi), medis.
- **Role dan permission:** sesuai matriks bagian 8 dan katalog permission di dokumen API.
- **Pengaturan sistem:** nilai default bagian 18.1, jam operasional, nomor darurat.

### 18.4 Skrip demo

Urutan demo yang menunjukkan nilai sistem ke client, memakai skenario uji yang sudah ditulis:

1. **Kecelakaan** (S1 + W1-W3): warga lapor → dispatcher verifikasi → dispatch ambulans dan polisi → responder accept dan lokasi presisi muncul → pilih RS tujuan → IGD menerima kabar.
2. **Offer tak dijawab** (S2 + W4): tunjukkan eskalasi 20/60/120 detik dan dispatcher memilih pengganti.
3. **Kebakaran** (S3): damkar berangkat duluan, dispatcher mencatat atas nama unit lewat telepon, resource request pos tambahan.
4. **Banjir** (S4 + W11): laporan massal, laporan kondisi vs bantuan, penggabungan duplikat, alert wilayah dari BPBD.
5. **Ketahanan** (S5, W6): kirim laporan dari antrean offline, putus dan sambung kembali tanpa data hilang.
6. **Privasi dan akses** (S7, W5, W9): responder belum accept tidak melihat lokasi, isolasi antar organisasi, akun dinonaktifkan langsung terputus.
