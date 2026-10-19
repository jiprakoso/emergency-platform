# Spesifikasi Dashboard Web v1: Dispatcher, Supervisor, dan Administrasi

> Status: draft v1 (spesifikasi, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `rest-api-aplikasi-darurat.md`, `websocket-aplikasi-darurat.md`, `fcm-aplikasi-darurat.md`, `flutter-aplikasi-darurat.md`
> Keputusan dari Anda: **Vite + React**.
> Fokus: cukup rinci untuk membangun aplikasi sampel. Poin yang menunggu keputusan client diberi asumsi default (bagian 17). Tanda 🔶 = perlu ditinjau.
> Potongan kode hanya ilustrasi pola.

---

## 1. Keputusan Teknologi

| Topik | Keputusan | Catatan |
|---|---|---|
| Build tool | **Vite** | Aplikasi satu halaman (SPA), tanpa SSR |
| UI | **React** + **TypeScript** (mode `strict`) | Versi dipin saat proyek dibuat |
| Routing | React Router | Rute dimuat bertahap (code splitting) untuk halaman admin |
| Data server (REST) | **TanStack Query** | Cache, status muat/galat, invalidasi. Event WebSocket menulis langsung ke cache |
| State klien | **Zustand** | Koneksi, shift, antrean "Perlu Perhatian", preferensi tampilan, suara |
| Tabel | TanStack Table + TanStack Virtual | Paginasi kursor dari server, daftar panjang divirtualisasi |
| Formulir | React Hook Form + Zod | Skema Zod juga dipakai memvalidasi payload WebSocket |
| UI kit | Tailwind CSS + shadcn/ui (Radix) 🔶 | Alternatif: Ant Design/MUI bila tim lebih nyaman dengan komponen siap pakai |
| HTTP | Axios (interceptor) | Perilaku mengikuti kontrak di dokumen REST |
| Realtime | `socket.io-client` | Kontrak di dokumen WebSocket |
| Peta | `react-leaflet` + tile OSM 🔶 | Selaras dengan aplikasi Flutter |
| Ikon, grafik | Lucide, Recharts | Grafik dipakai pada ringkasan (fase 2-3) |
| Waktu | `date-fns` + zona waktu dari konfigurasi (default `Asia/Jakarta`) | Seluruh tampilan waktu mengikuti zona ini |
| Tipe API | Ditulis manual dulu, lalu **dihasilkan dari OpenAPI** setelah kontrak dikonversi | `openapi-typescript` 🔶 |
| Uji | Vitest, Testing Library, MSW (tiruan API), Playwright (E2E) | |
| Mutu kode | ESLint, Prettier, `tsc --noEmit` di CI | |
| Bahasa tampilan | Bahasa Indonesia. Teks disimpan di satu berkas kamus agar siap diterjemahkan | |

---

## 2. Pengguna dan Cakupan

| Peran | Memakai | Fase |
|---|---|---|
| **Dispatcher** | Console (antrean, dispatch), input manual, alert, shift | 1 |
| **Supervisor** | Semua milik dispatcher + override kunci, audit, eskalasi | 1 |
| **Admin Organisasi** (mis. BPBD) | Alert bencana, laporan kondisi, kelola unit dan staf organisasinya, audit organisasinya | 1 |
| **Super Admin** | Organisasi, akun, role/permission, pengaturan, audit | 1 |
| Responder (stakeholder) di web | Belum. Aplikasi Android menjadi satu-satunya antarmuka responder pada sampel | 2 🔶 |

Satu aplikasi web melayani semua peran di atas. Menu dan rute ditampilkan menurut **permission** (bagian 11), sedangkan penegakan akses tetap di server.

---

## 3. Struktur Proyek

Struktur **per fitur** (lazim untuk React), bukan per jenis berkas.

```
dashboard/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── .env.example                 # VITE_API_BASE_URL, VITE_WS_URL, VITE_MAP_TILE_URL, VITE_TIMEZONE, VITE_ENV
├── public/
│   ├── sounds/                  # chime_new.mp3, alarm_critical.mp3, ack.mp3
│   └── favicon / ikon lencana
├── e2e/                         # Playwright
└── src/
    ├── main.tsx
    ├── app/
    │   ├── App.tsx
    │   ├── router.tsx
    │   ├── providers/           # Query, Auth, Realtime, Theme, Toast
    │   ├── layouts/             # AuthLayout, ConsoleLayout, AdminLayout
    │   └── guards/              # RequireAuth, RequirePermission
    ├── config/
    │   ├── env.ts               # baca dan validasi variabel lingkungan
    │   ├── permissions.ts       # kode permission (selaras dokumen REST)
    │   ├── statuses.ts          # status incident/dispatch, label, warna, ikon
    │   └── constants.ts
    ├── api/
    │   ├── client.ts            # Axios + interceptor (auth, refresh single-flight, request-id, galat)
    │   ├── errors.ts            # ApiError(code, message, details, httpStatus, requestId)
    │   ├── errorMessages.ts     # kode galat → pesan Bahasa Indonesia
    │   ├── queryKeys.ts
    │   ├── types/               # tipe API (kelak dihasilkan dari OpenAPI)
    │   └── endpoints/           # auth, incidents, dispatches, reports, resourceRequests,
    │                            # alerts, organizations, units, staff, shifts, dashboard,
    │                            # sync, settings, audit, reference
    ├── realtime/
    │   ├── socket.ts            # manajer koneksi, reconnect, auth.refresh, app.state
    │   ├── envelope.ts          # skema Zod amplop dan payload event
    │   ├── eventRouter.ts       # type → handler
    │   ├── handlers/            # incident, dispatch, resourceRequest, alert, session, system
    │   ├── sync.ts              # syncNow, snapshot, kursor lastEventId
    │   ├── dedupe.ts            # buang duplikat berdasarkan eid
    │   └── batcher.ts           # menerapkan event ke cache per kelompok (anti banjir render)
    ├── stores/                  # Zustand: auth, connection, attention, shift, ui, clock
    ├── features/
    │   ├── auth/                # LoginPage, TwoFactorPage, Setup2FA, ChangePasswordPage
    │   ├── console/             # ConsolePage, QueuePanel, WorkspacePanel, AttentionPanel, ContextPanel, HeaderBar
    │   ├── incidents/
    │   │   ├── components/      # IncidentHeader, ActionBar, LockBanner, SeverityBadge, AgeTimer
    │   │   ├── tabs/            # Overview, Reports, Dispatches, Casualties, Timeline, Notes
    │   │   ├── dialogs/         # Verify, Invalidate, Merge, Resolve, Close, SetLead
    │   │   └── hooks/           # useIncident, useLock, useIncidentActions
    │   ├── manualReport/        # ManualReportDialog, LocationInput (peta + wilayah + tempel koordinat)
    │   ├── dispatch/            # DispatchComposer, RecommendationList, OnBehalfDialog, DispatchCard, StatusHistory
    │   ├── resourceRequests/    # daftar dan keputusan
    │   ├── alerts/              # AlertsPage, AlertForm, RegionPicker, ConditionReportsMap
    │   ├── shift/               # ShiftBar, StartShiftDialog, EndShiftDialog, HandoverPage
    │   ├── dashboard/           # SummaryPage
    │   └── admin/               # organizations, units, staff, roles, settings, audit
    ├── services/                # alarm (WebAudio), desktopNotify, titleBadge, clock, shortcuts, maskPii
    ├── components/
    │   ├── ui/                  # komponen dasar (shadcn)
    │   ├── map/                 # MapView, IncidentMarker, UnitMarker
    │   └── common/              # StatusBadge, ConfirmDialog, EmptyState, ErrorState, PiiField
    ├── hooks/
    ├── lib/                     # format (WIB), geo, parseCoordinates, utils
    ├── i18n/                    # id.ts
    ├── styles/
    └── test/                    # setup, mocks MSW, tiruan WebSocket
```

Aturan lapisan:
- `features/*` boleh memakai `api/`, `realtime/`, `stores/`, `services/`, `components/`, `lib/`. Fitur **tidak saling mengimpor** (bila perlu berbagi, naikkan ke `components/` atau `lib/`).
- `api/endpoints/*` hanya berisi fungsi pemanggil bertipe, tanpa logika tampilan.
- `realtime/handlers/*` satu-satunya tempat event WebSocket mengubah cache dan store.

---

## 4. Pemetaan Layar, Rute, Endpoint, dan Izin

| Rute | Layar | Endpoint utama | Izin penjaga |
|---|---|---|---|
| `/login` | Login staf | `POST /auth/staff/login`, `/login/2fa` | - |
| `/account/2fa` | Pendaftaran TOTP | `/auth/2fa/setup`, `/enable` | login |
| `/account/password` | Ganti sandi | `/auth/password/change` | login |
| `/console` | **Console dispatcher** (layar utama) | `/sync/snapshot`, `/sync/events`, `/incidents/*`, `/dispatches/*`, `/resource-requests` | `incident.read_all` |
| `/incidents/:id` | Detail incident berdiri sendiri (tautan/jendela baru) | `/incidents/{id}` dan turunannya | `incident.read_all` |
| `/history` | Pencarian dan riwayat incident | `GET /incidents` (filter) | `incident.read_all` |
| `/alerts` | Daftar alert, buat/ubah/terbitkan/tutup | `/admin/alerts/*` | `alert.create` |
| `/condition-reports` | Peta laporan kondisi | `/condition-reports` | `condition_report.read` |
| `/shift` | Shift dan serah terima | `/shifts/*` | `shift.manage` |
| `/summary` | Ringkasan | `/dashboard/summary` | `dashboard.read` |
| `/admin/organizations` | Organisasi, wilayah layanan | `/organizations*` | `org.manage_all` / `org.manage_own` |
| `/admin/units` | Unit | `/organizations/{id}/units`, `/units/*` | `org.manage_own` |
| `/admin/staff` | Akun staf | `/organizations/{id}/staff`, `/staff/*` | `staff.manage_own` / `staff.manage_all` |
| `/admin/roles` | Role dan permission | `/roles`, `/permissions` | `role.manage` |
| `/admin/settings` | Pengaturan sistem | `/settings` | `settings.manage` |
| `/admin/audit` | Log audit | `/audit-logs` | `audit.read_all` / `audit.read_own_org` |

Seleksi incident di console disimpan di URL (`/console?incident={id}`), sehingga tautan dapat dibagikan dan halaman tetap benar saat dimuat ulang.

---

## 5. Console Dispatcher (Layar Utama)

### 5.1 Tata letak

Dirancang **desktop-first** (lebar minimum 1280 px), tiga panel dan bilah atas:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ HeaderBar: ● Realtime tersambung │ Shift: Rina (mulai 07:00) │ Baru 3 · Aktif 12 ·     │
│            Perlu perhatian 2 · Unit tersedia 5 │ 🔊 Suara │ [+ Laporan manual] │ 14:32 WIB│
├───────────────┬───────────────────────────────────────────────┬─────────────────────────┤
│ QueuePanel    │ WorkspacePanel (incident terpilih)            │ ContextPanel            │
│               │ ┌───────────────────────────────────────────┐ │                         │
│ [Baru|Aktif|  │ │ INC-20261005-000123  Kecelakaan Lalu Lintas│ │  Peta: lokasi incident, │
│  Selesai]     │ │ ● VERIFIED  ▲ HIGH   Lead: Polres  🔒 Rina │ │  incident berdekatan    │
│  Cari…        │ │ [Kunci] [Verifikasi] [Dispatch] [Gabung]…  │ │                         │
│               │ ├───────────────────────────────────────────┤ │  Rekomendasi unit       │
│ ▸ 0123 ⏱0:42 │ │ Ringkasan | Laporan | Dispatch | Korban |  │ │  (jarak, status)        │
│ ▸ 0122 ⏱2:10 │ │ Timeline | Catatan                         │ │                         │
│ ▸ 0121 …      │ │                                           │ │  ─────────────────────  │
│               │ │  (isi tab)                                │ │  AttentionPanel         │
│               │ │                                           │ │  ⚠ Ambulans RS A menolak│
│               │ └───────────────────────────────────────────┘ │  ⚠ Polres minta bantuan │
└───────────────┴───────────────────────────────────────────────┴─────────────────────────┘
```

- Lebar panel dapat diubah (seret pemisah), tersimpan di preferensi pengguna.
- **Perlu Perhatian** selalu terlihat (tidak tersembunyi di balik tab) karena berisi pekerjaan yang menunggu keputusan dispatcher.
- Pada layar < 1280 px console menampilkan peringatan "Disarankan layar lebih lebar". Halaman admin tetap responsif.

### 5.2 Bilah atas (`HeaderBar`)

| Elemen | Perilaku |
|---|---|
| Status realtime | Hijau: tersambung. Kuning: menyambung ulang. Merah: terputus (data mungkin tertinggal, mode polling aktif). Menampilkan waktu sinkronisasi terakhir |
| Shift | Nama dan jam mulai. Tanpa shift aktif: tombol **Mulai shift** menonjol dan aksi tulis dinonaktifkan 🔶 |
| Penghitung | Baru, Aktif, Perlu perhatian, Offer menunggu, Unit tersedia. Dihitung dari state lokal (diperbarui event), disegarkan dari `/dashboard/summary` tiap 30 detik |
| Suara | Aktif/nonaktif dan tingkat (bagian 7.6). Peringatan bila suara terkunci peramban |
| **+ Laporan manual** | Membuka formulir input telepon (bagian 6.6). Pintasan `N` |
| Jam | Waktu server (bukan jam komputer) dalam WIB |

### 5.3 Antrean (`QueuePanel`)

**Tab** (turunan dari satu kumpulan incident aktif yang dimuat dari `/sync/snapshot`):

| Tab | Isi | Urutan |
|---|---|---|
| **Baru** | `SUBMITTED` | Keparahan tinggi/massal di atas, lalu **terlama dulu** (FIFO) |
| **Aktif** | `VERIFIED`, `IN_PROGRESS` | Aktivitas terakhir terbaru dulu |
| **Selesai** | `RESOLVED` hari ini (menunggu `CLOSED`) | Terbaru dulu |

Pencarian (`q`) dan filter: jenis, keparahan, kecamatan, lead, dipegang saya, bertanda (`OUT_OF_AREA`, kemungkinan duplikat). Hasil pencarian riwayat (incident lama) ada di halaman `/history`.

**Kartu antrean** (satu baris padat, bisa dipindai cepat):

| Elemen | Isi |
|---|---|
| Kode ringkas dan jenis | Ikon + `0123` + nama jenis |
| Keparahan | Lencana ikon + label (tidak hanya warna) |
| Umur | Penghitung berjalan sejak laporan pertama (`AgeTimer`). Amber > 1 menit, merah > ambang eskalasi (default 3 menit) untuk `SUBMITTED` |
| Wilayah | Kecamatan/kelurahan |
| Jumlah laporan | `×3` bila ada laporan tambahan |
| Penanda | `OUT_OF_AREA`, "Kemungkinan duplikat", "Info baru" |
| Kunci | Avatar/nama pemegang kunci (🔒) |
| Ringkasan dispatch | Chip per organisasi dengan status (mis. `Amb ✓`, `Polisi …`, `Damkar ✗`) dari `dispatchSummary` |

Perilaku:
- Item baru muncul di posisi semestinya dengan animasi singkat dan tanpa menggeser item yang sedang dipilih.
- Seleksi pengguna **tidak berpindah sendiri** saat data berubah.
- Daftar divirtualisasi (siap untuk ratusan laporan saat banjir).
- Navigasi papan ketik `J`/`K`, `Enter` membuka.

### 5.4 Ruang kerja incident (`WorkspacePanel`)

**Header:** kode, jenis, status, keparahan, level eskalasi, lead, pemegang kunci, umur. **Bilah aksi kontekstual** menurut status dan kunci:

| Keadaan | Aksi yang tampil |
|---|---|
| Belum dikunci / dikunci orang lain | **Tangani (Kunci)**. Bila dikunci orang lain: pesan "Sedang ditangani X sejak …" dan, khusus supervisor, **Ambil alih** |
| `SUBMITTED`, saya memegang kunci | Verifikasi, Tandai tidak valid, Gabung duplikat, Ubah data |
| `VERIFIED` / `IN_PROGRESS` | Dispatch, Catat atas nama unit, Ubah lead, Update keparahan, Tambah catatan, Selesaikan |
| `RESOLVED` | Tutup (`CLOSED`) |
| `INVALID` / `DUPLICATE` / `CLOSED` | Hanya baca |

**Tab:**

| Tab | Isi |
|---|---|
| **Ringkasan** | Jenis, keparahan, lokasi (alamat, akurasi GPS, kecamatan/kelurahan), deskripsi gabungan, lead, korban terkini, daftar dispatch ringkas, penanda sistem |
| **Laporan** | Semua laporan tertaut (urut waktu), tanda follow-up, galeri lampiran (URL baca diambil saat dibuka), kontak pelapor **dimask** dengan tombol **Tampilkan** (bagian 11.3) |
| **Dispatch** | Kartu dispatch per organisasi/unit: status, waktu tiap tahap (kejadian vs dicatat), aksi (batalkan, catat status atas nama unit, buat pengganti, hubungi organisasi), tombol **Dispatch baru** |
| **Korban** | Data terkini dan riwayat, tombol **Perbarui** |
| **Timeline** | `incident_events` (semua visibilitas) urut waktu, dengan penanda sumber (sistem, dispatcher, unit lapangan, atas nama) |
| **Catatan** | Catatan internal dengan pilihan `visibility` |

### 5.5 Panel konteks (`ContextPanel`)

- **Peta** (Leaflet): penanda lokasi incident dengan lingkaran akurasi, incident aktif di sekitarnya (radius `/nearby`), dan lokasi organisasi/unit yang direkomendasikan.
- **Rekomendasi unit** saat tab Dispatch/composer terbuka: dari `GET /incidents/{id}/dispatch-recommendations` (jarak, status, di dalam wilayah layanan, sudah ditugaskan).
- Peta penuh dengan posisi unit langsung (live) dan layar lebar/video wall ditunda ke fase 3.

### 5.6 Perlu Perhatian (`AttentionPanel`)

Daftar tugas yang **menunggu keputusan dispatcher**. Dihitung dari **state server** (snapshot + `attentionReasons` pada incident) ditambah event, sehingga tidak hilang saat halaman dimuat ulang.

| Pemicu | Teks | Tindakan satu klik |
|---|---|---|
| `dispatch.rejected` | "{Organisasi} menolak: {alasan}" | **Pilih pengganti** (composer terisi otomatis) |
| `dispatch.expired` | "Offer {Organisasi} kedaluwarsa" | **Dispatch pengganti**, **Hubungi** |
| `dispatch.offer_unseen` | "{Organisasi} belum melihat offer ({n} dtk)" | **Telepon** (nomor organisasi), **Catat via telepon** (atas nama unit) |
| `dispatch.self_initiated` | "{Unit} berangkat sendiri" | **Konfirmasi** / **Sesuaikan** |
| `resource_request.created` | "{Organisasi} meminta {n} {jenis} ({urgensi})" | **Setujui…** (buka composer) / **Tolak** |
| `incident.escalation_due` | "Laporan belum ditangani {n} menit" (supervisor) | **Buka** |
| Incident dengan `suggestedIncidentId` | "Kemungkinan duplikat dengan INC-…" | **Bandingkan** |
| `incident.report_added` | "Info baru pada INC-…" | **Lihat** |

Aturan:
- Item **hilang otomatis** bila kondisinya terselesaikan (mis. dispatch pengganti dibuat, request diputuskan, incident ditutup).
- Item yang sudah dibuka tetapi belum diselesaikan tetap ada, ditandai "dilihat".
- Urutan: CRITICAL terlebih dulu (rejected, expired, offer_unseen, resource request URGENT), lalu terlama.
- Setiap item menampilkan umur dan, bila terkait incident, mengarah ke incident itu tanpa mengubah seleksi sebelum diklik.

---

## 6. Alur Kerja Dispatcher

### 6.1 Mengunci incident (`useLock`)

1. **Tangani** → `POST /incidents/{id}/lock`. Berhasil: `lockedBy` = saya, `lockExpiresAt` diterima.
2. **Heartbeat:** `POST /incidents/{id}/lock/renew` tiap 60 detik selama ruang kerja terbuka dan tab terlihat. Tab tersembunyi > 4 menit: berhenti memperpanjang (kunci akan lepas sendiri).
3. **Lepas:** tombol **Lepas** atau berpindah incident → `DELETE /incidents/{id}/lock`. Saat menutup tab: `fetch` dengan `keepalive` (upaya terbaik, kunci tetap kedaluwarsa sendiri).
4. **Dikunci orang lain** (`409 INCIDENT_LOCKED`): tampil banner dengan nama dan waktu. Mode **hanya baca**. Supervisor mendapat **Ambil alih** (`force: true`, wajib alasan).
5. **Kunci diambil alih** (`incident.lock_overridden`) atau **kedaluwarsa**: modal "Kunci Anda tidak berlaku lagi", ruang kerja berubah ke hanya baca, formulir yang belum tersimpan dipertahankan di layar dan dapat disalin.
6. Aksi yang butuh kunci tetapi dikirim tanpa kunci (`409 LOCK_REQUIRED`): tawarkan **Kunci lalu ulangi**.

### 6.2 Verifikasi

- Dialog: keparahan (wajib), lead (terisi dari jenis kejadian, dapat diubah), ringkasan (opsional).
- Sebelum memverifikasi, panel menampilkan **kandidat duplikat** (`/nearby`) agar tidak membuat dispatch ganda.
- Tombol **Verifikasi lalu Dispatch** menjalankan `verify` lalu membuka composer (dua panggilan berurutan).

### 6.3 Dispatch (`DispatchComposer`)

1. Prasyarat: incident `VERIFIED`/`IN_PROGRESS` dan saya memegang kunci.
2. Composer menampilkan **checklist rekomendasi** dari `incident_types.suggestedResources` (mis. ambulans, polisi, IGD). Dispatcher mencentang yang dibutuhkan.
3. Untuk tiap baris: pilih organisasi, unit (opsional), tipe (`RESPOND`/`NOTIFY`, ditentukan jenis organisasi), catatan, batas waktu offer. Daftar pilihan diurutkan dari rekomendasi server (jarak, tersedia, dalam wilayah layanan).
4. **Kirim** → `POST /incidents/{id}/dispatches/batch` (atomik).
5. Setelah terkirim, kartu dispatch tampil di tab Dispatch dengan status langsung (`OFFERED` → …) dan hitung mundur batas offer (jam server).
6. Unit tidak tersedia (`UNIT_NOT_AVAILABLE`): dialog "Unit sedang tidak tersedia. Paksa kirim?" dengan alasan wajib → `ignoreAvailability: true` (tercatat di audit).
7. **Dispatch pengganti** (setelah `REJECTED`/`EXPIRED`): tombol pada kartu atau dari Perlu Perhatian membuka composer terisi baris yang sama, organisasi dikosongkan.

### 6.4 Mencatat atas nama unit (`OnBehalfDialog`)

Dipakai saat unit berangkat atau berubah status lewat telepon/WhatsApp/radio.

| Field | Keterangan |
|---|---|
| Organisasi dan unit | Wajib |
| Tipe | `RESPOND` / `NOTIFY` |
| Status awal | Default `EN_ROUTE` (juga `ON_SCENE`, `DONE` untuk pencatatan terlambat) |
| Kanal | `PHONE`, `WHATSAPP`, `RADIO` |
| Waktu kejadian | Default sekarang. Pintasan "5 menit lalu", "10 menit lalu", atau isi manual (≤ 24 jam ke belakang) |
| Catatan | Isi bebas |

Memanggil `POST /incidents/{id}/dispatches/on-behalf` untuk dispatch baru, atau `POST /dispatches/{id}/status` dengan `channel` dan `occurredAt` untuk dispatch yang sudah ada. Riwayat menandai entri "dicatat atas nama" bila waktu dicatat lebih dari 60 detik setelah waktu kejadian.

### 6.5 Menggabungkan duplikat (`MergeDialog`)

1. Daftar kandidat dari `/nearby` (jarak, selisih waktu, jenis, jumlah laporan).
2. Tampilan berdampingan: incident ini vs kandidat (lokasi di peta, deskripsi, foto).
3. Dispatcher memilih **incident induk** (disarankan yang lebih awal atau yang sudah punya dispatch), mengisi alasan.
4. `POST /incidents/{id}/merge` dengan `targetIncidentId`. Selesai: seleksi pindah ke incident induk, dan toast "N laporan dipindahkan".

### 6.6 Input laporan manual (`ManualReportDialog`)

Dipakai saat warga menelepon. Harus **cepat** dan **tidak kehilangan data** bila dispatcher berpindah layar.

| Bagian | Isi |
|---|---|
| Penelepon | Nama, nomor telepon (opsional), kanal (`PHONE`/`WHATSAPP`/`SMS`) |
| Jenis kejadian | Pilihan cepat (kecelakaan, kebakaran, medis, banjir) + lainnya |
| Lokasi | **Peta klik** untuk menaruh pin, **pilih wilayah** (kecamatan lalu kelurahan, peta memusat), **tempel koordinat atau tautan peta** (mengenali `lat,lng` dan tautan Google Maps), alamat teks/patokan. Tanpa layanan geocoding eksternal di sampel 🔶 |
| Rincian | Deskripsi, perkiraan korban, keparahan awal |
| Aksi | **Simpan** (membuat incident `SUBMITTED`, terkunci atas nama saya) dan **Simpan dan Verifikasi** |

- Draf formulir disimpan di memori (store) selama dialog terbuka atau diperkecil, dan **tidak** ditulis ke penyimpanan permanen (mengandung data pribadi).
- Dialog dapat **diperkecil** menjadi bilah di bawah agar dispatcher tetap bisa melihat antrean selama menelepon.
- Pintasan `N` membuka formulir baru.

### 6.7 Permintaan bantuan tambahan (resource request)

Panel kecil di tab Dispatch dan item di Perlu Perhatian. Dispatcher melihat pemohon (lead), jenis dan jumlah, urgensi, alasan.

- **Setujui…** membuka composer terisi sesuai permintaan (dispatcher memilih organisasi/unit). Kirim → `POST /resource-requests/{id}/approve` dengan daftar dispatch (`origin = REQUESTED`).
- **Tolak** → catatan wajib.

### 6.8 Menyelesaikan dan menutup

- **Selesaikan:** `POST /incidents/{id}/resolve`. Bila ada dispatch aktif (`409 ACTIVE_DISPATCHES_EXIST`): dialog mencantumkan dispatch tersebut dengan pilihan "Tutup semua dispatch" (`forceCloseDispatches: true`) atau batal.
- **Tutup:** `POST /incidents/{id}/close` dengan catatan akhir. Sistem juga menutup otomatis setelah N jam (pengaturan sistem).
- Sebelum menyelesaikan, ringkasan menampilkan: jumlah korban terakhir, milestone yang tercatat, dispatch dan hasilnya (`outcomeCode`).

### 6.9 Tidak valid

`POST /incidents/{id}/invalidate` dengan alasan wajib (pilihan cepat: laporan palsu, salah lokasi, sudah ditangani pihak lain, uji coba, lainnya). Peringatan bahwa skor reputasi pelapor akan turun.

---

## 7. Realtime di Dashboard

### 7.1 Prinsip

1. **REST/database tetap sumber kebenaran.** Event WebSocket hanya mempercepat. Bila ragu, ambil ulang lewat REST.
2. **Event menulis langsung ke cache TanStack Query dan store Zustand** lewat `realtime/handlers/*` (satu-satunya tempat). Komponen hanya membaca cache.
3. **Upsert berkunci id dengan pemeriksaan `version`.** Event ganda atau terlambat tidak menimpa data yang lebih baru (`resourceVersion` ≤ versi lokal → diabaikan).
4. **Dedup dengan `eid`**, 500 terakhir dalam memori.
5. Dashboard tidak mengirim perintah lewat WebSocket. Semua aksi lewat REST. Klien → server hanya `ack`, `auth.refresh`, `app.state`.

### 7.2 Koneksi (`realtime/socket.ts`)

| Item | Aturan |
|---|---|
| Pembukaan | Setelah login dan token siap: `auth: { token, appFlavor: "ADMIN_WEB", appVersion, deviceId }` 🔶 |
| Reconnect | Backoff 1 s → 10 s dengan jitter, tanpa batas percobaan. Token dibaca ulang dari `authStore` tiap percobaan |
| `connection.ready` | Memicu `syncNow()`. Status koneksi hijau |
| `auth.expiring` | Memanggil refresh token, lalu `emit("auth.refresh")` |
| `session.revoked` / `auth.expired` | Keluar bersih ke halaman login dengan alasan |
| `app.state` | Dikirim saat tab terlihat/tersembunyi (`visibilitychange`) |
| Banyak tab | Hingga 3 koneksi per pengguna diizinkan. Tab keempat menutup yang tertua (pesan ditampilkan) |

### 7.3 Data awal dan sinkronisasi

- Saat console dibuka: `GET /sync/snapshot` (incident aktif, dispatch aktif, resource request menunggu, `lastEventId`) mengisi **koleksi incident aktif** (peta berkunci id) dan antrean Perlu Perhatian.
- `syncNow()` (single-flight): `GET /sync/events?afterId=<lastEventId>` berulang selama `hasMore`, event diterapkan seperti event live. `resetRequired = true` → ambil `/sync/snapshot` ulang, ganti koleksi, lanjutkan dari `lastEventId` baru.
- `lastEventId` disimpan per tab (memori/`sessionStorage`). Tidak ada data incident yang ditulis ke penyimpanan permanen peramban.
- Pemicu sinkronisasi: `connection.ready`, tab kembali terlihat, jaringan pulih, polling cadangan.

### 7.4 Kunci cache (`api/queryKeys.ts`)

| Kunci | Isi |
|---|---|
| `['incidents','active']` | Koleksi incident aktif (peta id → `IncidentSummary`). Tab antrean adalah **seleksi turunan** dari koleksi ini |
| `['incidents','detail', id]` | Detail incident (DispatcherView, termasuk daftar dispatch) |
| `['incidents','reports', id]`, `['incidents','events', id]`, `['incidents','nearby', id]` | Tab dan panel |
| `['incidents','history', filters]` | Pencarian riwayat (kursor) |
| `['dispatches','recommendations', incidentId, params]` | Rekomendasi unit |
| `['resourceRequests','pending']` | Permintaan bantuan menunggu |
| `['dashboard','summary']` | Ringkasan |
| `['alerts', filters]`, `['conditionReports', bbox, since]` | Alert, peta kondisi |
| `['reference','incidentTypes']`, `['reference','regions', params]` | Referensi (cache panjang) |
| `['admin', ...]` | Organisasi, unit, staf, role, pengaturan, audit |

### 7.5 Event → pembaruan

| Event | Tindakan pada cache/store |
|---|---|
| `incident.created` | Upsert ke `['incidents','active']`. Bila `flags`/`suggestedIncidentId`: tambah item Perlu Perhatian. Bunyi "laporan baru" |
| `incident.updated`, `incident.status_changed`, `incident.lead_changed` | Upsert ke koleksi dan `detail` bila terbuka. Status terminal (`INVALID`, `DUPLICATE`, `CLOSED`) mengeluarkan dari koleksi aktif setelah jeda 10 detik (agar tidak "hilang tiba-tiba" dari mata dispatcher) |
| `incident.locked` / `unlocked` / `lock_overridden` | Memperbarui `lockedBy`. Bila saya pemegang yang kehilangan kunci: modal (bagian 6.1) |
| `incident.merged` | Hapus sumber dari koleksi. Bila sumber sedang terbuka, pindahkan seleksi ke target |
| `incident.report_added` | Tambah penanda "Info baru", invalidasi `reports` bila terbuka, item Perlu Perhatian bila saya memegang incident itu |
| `incident.casualties_updated`, `incident.milestone_recorded`, `incident.note_added` | Invalidasi/upsert `detail` dan `events` |
| `dispatch.created`, `dispatch.status_changed`, `dispatch.accepted` | Upsert dispatch di `detail` dan `dispatchSummary` di koleksi |
| `dispatch.rejected`, `dispatch.expired`, `dispatch.offer_unseen`, `dispatch.self_initiated` | Perbarui dispatch + tambah item Perlu Perhatian + alarm CRITICAL |
| `resource_request.created` | Tambah ke `['resourceRequests','pending']`, item Perlu Perhatian, alarm CRITICAL |
| `resource_request.decided` | Hapus dari daftar menunggu dan dari Perlu Perhatian |
| `alert.published/updated/closed` | Invalidasi `['alerts', ...]` |
| `unit.status_changed` | Perbarui rekomendasi dan hitungan "Unit tersedia" |
| `notification.created` | Lencana notifikasi pribadi |
| `system.notice` | Banner sistem di `HeaderBar` |
| `session.revoked`, `auth.*` | `authStore` → keluar |

### 7.6 Pembaruan berkelompok (anti banjir)

Saat banjir, ratusan event bisa datang per menit. `realtime/batcher.ts` menampung event dan menerapkannya ke cache dalam **satu kelompok tiap ±200 ms** (dan segera untuk event CRITICAL). Tujuannya mencegah render berulang dan menjaga antarmuka tetap responsif. Urutan antar event tetap dipertahankan.

### 7.7 Cadangan saat WebSocket putus

- Status merah + banner "Koneksi realtime terputus, data mungkin tertinggal".
- **Polling cadangan** `GET /sync/events` tiap 10 detik sampai tersambung kembali (default sampel).
- Aksi tulis tetap berjalan lewat REST. Pada `VERSION_CONFLICT` dispatcher diminta memuat ulang.
- Saat tersambung kembali: `syncNow()` dan banner hilang.

### 7.8 Suara dan peringatan (`services/alarm.ts`)

Peramban memblokir suara sebelum ada interaksi pengguna, sehingga:

1. Setelah login (atau saat **Mulai shift**), tampil dialog **"Aktifkan suara dan notifikasi"** yang membuka `AudioContext` dan meminta izin Notification API. Tanpa itu, header menampilkan peringatan kuning "Suara belum aktif".
2. Pustaka suara dimuat di awal (`chime_new`, `alarm_critical`, `ack`).

| Kejadian | Suara | Visual |
|---|---|---|
| Incident baru | Chime singkat | Item baru berkedip, penghitung naik |
| Perlu Perhatian CRITICAL (`rejected`, `expired`, `offer_unseen`, resource request URGENT, `self_initiated`) | Alarm. Diulang maksimal 3 kali (tiap 10 detik) atau sampai item dibuka 🔶 | Item merah di panel, judul tab berkedip dengan jumlah |
| Kehilangan kunci | Nada ack | Modal |
| Koneksi putus > 15 detik | Nada peringatan sekali | Banner merah |

Pengaturan suara: nonaktifkan sementara (mute) dengan indikator jelas, tingkat volume, dan **peringatan bila mute > 10 menit** agar tidak terlupa. Judul tab dan ikon (`titleBadge`) memuat jumlah item belum ditangani. Notifikasi desktop (Notification API) hanya muncul bila tab tidak terlihat.

---

## 8. Alert Bencana dan Laporan Kondisi

### 8.1 Daftar dan formulir alert (`/alerts`)

- Daftar (filter status, kategori) dengan aksi **Ubah**, **Terbitkan**, **Tutup**.
- **Formulir:**

| Field | Keterangan |
|---|---|
| Kategori | `FLOOD`, `EARTHQUAKE`, `WEATHER`, `LANDSLIDE`, `OTHER` |
| Level | Dari `system_settings.alert_levels` (istilah BPBD) |
| Judul, isi, imbauan | Dengan penghitung karakter. Judul dan isi singkat tampil di notifikasi, imbauan di dalam aplikasi |
| Wilayah | Pilih kecamatan (multi-pilih dari `/regions`). Menggambar polygon/radius (`GEOFENCE`) ditunda 🔶 |
| Jadwal | Mulai (opsional), berakhir (opsional) |
| Alert uji | Pilihan "Kirim hanya ke perangkat uji" (`isTest`) |

- **Pratinjau notifikasi:** menampilkan judul dan isi persis seperti yang muncul di ponsel (termasuk pemotongan), dan jumlah wilayah terdampak.
- **Penerbitan butuh konfirmasi dua langkah:** dialog ringkasan (level, wilayah, teks). Untuk level tertinggi, pengguna mengetik kata `KIRIM` agar tidak terkirim tak sengaja kepada seluruh warga.
- **Alert aktif** hanya dapat diubah teksnya (tercatat sebagai revisi). **Tutup** meminta konfirmasi.

### 8.2 Peta laporan kondisi (`/condition-reports`)

- Peta dengan penanda dikelompokkan (cluster). Warna menurut kebaruan, filter `since` (1 jam / 6 jam / 24 jam) dan jenis.
- Data dimuat berdasarkan batas peta (`bbox`), ditunda 400 ms setelah peta berhenti digeser.
- Klik penanda: deskripsi, foto (bila ada), waktu. Aksi "Buat incident dari laporan ini" 🔶 untuk laporan kondisi yang ternyata butuh bantuan.

---

## 9. Shift dan Ringkasan

### 9.1 Shift

- **Mulai shift** (`POST /shifts/start`): menampilkan catatan serah terima shift sebelumnya dan ringkasan (`GET /shifts/handover`) sebelum console aktif.
- **Akhiri shift** (`POST /shifts/end`): dialog berisi **daftar incident yang masih saya pegang** (kunci akan dilepas), catatan serah terima (wajib bila ada incident aktif), dan pilihan operator berikutnya.
- Halaman `/shift` menampilkan shift berjalan, riwayat singkat, dan ringkasan serah terima untuk operator yang masuk.
- Bila `shift.manage` dipasang dan tidak ada shift aktif, aksi tulis di console dinonaktifkan dengan pesan jelas 🔶 (sampel: hanya peringatan, tidak memblokir).

### 9.2 Ringkasan (`/summary`)

Kartu dari `/dashboard/summary`: incident per status, dispatch aktif, offer menunggu, unit tersedia, rata-rata waktu respons. Grafik tren, statistik per jenis/kecamatan, dan ekspor laporan ditunda ke fase 2-3.

---

## 10. Administrasi

| Halaman | Fitur | Catatan |
|---|---|---|
| **Organisasi** | Daftar, tambah/ubah, jenis, nomor operasional, lokasi, wilayah layanan (multi-pilih kecamatan) | Super Admin semua. Admin Organisasi hanya miliknya |
| **Unit** | Daftar per organisasi, tambah/ubah, jenis, status, nonaktifkan | |
| **Akun staf** | Daftar, tambah (kata sandi sementara **ditampilkan sekali** dengan tombol salin), nonaktifkan (mencabut sesi dan token push seketika), setel ulang sandi, atur role dan unit | Admin Organisasi hanya membuat `RESPONDER` dan `ORG_ADMIN` untuk organisasinya (selaras dokumen REST) |
| **Role & permission** | Matriks role × permission (kotak centang), peringatan perubahan | Hanya Super Admin. Perubahan tercatat di audit |
| **Pengaturan sistem** | Editor kunci (`offer_timeout_seconds`, `unhandled_incident_escalation_minutes`, `auto_close_hours`, `operating_hours`, `alert_levels`, `alert_rate_limit`, `fcm.*`, batas laju) dengan validasi tipe dan rentang | Hanya Super Admin |
| **Log audit** | Filter entitas, aktor, aksi, rentang waktu. Tampilan selisih `before`/`after` | Admin Organisasi hanya organisasinya |

Semua tabel admin memakai paginasi kursor dari server, filter yang tersimpan di URL, dan konfirmasi untuk aksi merusak (nonaktifkan, hapus).

---

## 11. Autentikasi, Keamanan, dan Privasi

### 11.1 Sesi

| Item | Aturan |
|---|---|
| Access token | Disimpan di **memori** (bukan `localStorage`) |
| Refresh token (sampel) | `sessionStorage` agar sesi bertahan saat halaman dimuat ulang dan hilang saat tab/jendela ditutup 🔶 |
| Refresh token (disarankan untuk produksi) | **Cookie `HttpOnly; Secure; SameSite=Strict`** yang diterbitkan API untuk klien web (perlu penyesuaian kontrak, bagian 16) |
| Refresh | Single-flight, token berotasi. Gagal (`REFRESH_TOKEN_REUSED`, 401) → keluar dan tampilkan alasan |
| 2FA | Wajib untuk dispatcher dan supervisor. Alur TOTP di `/login` dan `/account/2fa` (di sampel dapat dimatikan lewat pengaturan lingkungan) |
| Ganti sandi awal | `mustChangePassword` mengalihkan ke `/account/password` sebelum rute lain |
| Kunci layar | Opsional: kunci manual (kode sandi ulang) agar layar yang ditinggal tidak menampilkan data. Kunci otomatis saat idle ditunda 🔶. Alarm tetap berbunyi saat terkunci |

### 11.2 Izin di antarmuka

- `GET /me` mengembalikan `roles` dan **`permissions[]`** untuk staf (bagian 16). Antarmuka memakainya untuk menampilkan menu, tombol, dan rute (`RequirePermission`).
- Pengecekan antarmuka hanya kenyamanan. **Server tetap penegak akses** dan dashboard selalu menangani `403`/`404` dengan wajar.
- Pembatas relasional (lead, terkait, milik sendiri) ditampilkan mengikuti data (`incident.leadOrganizationId`), tetapi tidak dipercaya.

### 11.3 Data pribadi pelapor

- Kontak pelapor tampil **dimask** (`0812****789`). Tombol **Tampilkan** memanggil `POST /reports/{id}/reveal-contact` (tercatat di audit), menampilkan nilai penuh **30 detik**, lalu dimask kembali otomatis.
- Nilai penuh hanya disimpan di memori komponen, tidak di cache query yang persisten dan tidak di URL.
- Tautan `tel:` aktif hanya setelah nilai dibuka.
- Cache TanStack Query **tidak dipersistenkan** (tanpa `localStorage`/IndexedDB). Data hilang saat tab ditutup.
- Draf formulir yang memuat data pribadi hanya di memori (bagian 6.6).
- Tidak ada data pribadi di judul tab, notifikasi desktop, log konsol, atau parameter URL.

### 11.4 Perlindungan aplikasi web

| Hal | Aturan |
|---|---|
| XSS | Seluruh teks dari pengguna (deskripsi, catatan, nama) dirender sebagai teks. **Tanpa `dangerouslySetInnerHTML`**. Tautan memakai `rel="noopener noreferrer"` |
| CSP | `default-src 'self'`; skrip hanya dari origin sendiri; `connect-src` hanya API/WS; `img-src` mencakup storage terkait dan tile peta; tanpa skrip inline |
| Header | `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, HSTS (diatur di reverse proxy) |
| Dependensi | Audit rutin (`npm audit`/pemindaian di CI), versi dipin, pembaruan terjadwal |
| Lampiran | URL baca bertanda tangan berumur pendek, diambil saat dibuka, tidak disimpan |
| Origin | Dilayani satu origin dengan API lewat reverse proxy (mengurangi kebutuhan CORS) |

---

## 12. Penanganan Galat dan Kondisi Khusus

Semua panggilan melempar `ApiError` dari satu tempat (`api/client.ts`). Pesan berasal dari `errorMessages.ts`. `requestId` ditampilkan kecil pada galat agar mudah dilaporkan.

| Kode / kondisi | Perilaku di antarmuka |
|---|---|
| `INCIDENT_LOCKED` | Banner pemegang kunci + mode hanya baca (supervisor: Ambil alih) |
| `LOCK_REQUIRED` | Tawarkan **Kunci lalu ulangi** |
| `VERSION_CONFLICT` | Muat ulang data, tampilkan "Data berubah oleh orang lain", pertahankan masukan di formulir agar dapat diterapkan ulang |
| `INVALID_STATUS_TRANSITION` | Muat ulang dan tampilkan status terkini |
| `INCIDENT_NOT_DISPATCHABLE` | Arahkan ke **Verifikasi** |
| `UNIT_NOT_AVAILABLE` | Dialog paksa kirim dengan alasan (`ignoreAvailability`) |
| `ACTIVE_DISPATCHES_EXIST` | Dialog daftar dispatch aktif + opsi tutup semua |
| `NOT_LEAD_ORGANIZATION` | Pesan penjelasan, tidak terjadi dari antarmuka dispatcher |
| `RESOURCE_REQUEST_ALREADY_DECIDED` | Hapus dari daftar, pesan singkat |
| `RATE_LIMITED` | Tunggu `Retry-After`, tampilkan hitung mundur |
| `UNAUTHENTICATED` | Refresh otomatis, bila gagal ke login |
| `FORBIDDEN` / `NOT_FOUND` | Halaman "Tidak tersedia" tanpa membedakan penyebab |
| Jaringan putus | Banner, tombol **Coba lagi**. Aksi tulis tidak diantrekan di dashboard (butuh keputusan segera) |

Aksi tulis di dashboard **tidak memakai antrean offline**: dispatcher harus tahu hasilnya saat itu juga. Selama pengiriman, tombol menampilkan status proses dan mencegah klik ganda. Aksi yang mengubah status memakai `Idempotency-Key` dan `version`.

---

## 13. Aksesibilitas, Ergonomi, dan Performa

### 13.1 Ergonomi ruang kontrol

- **Tema gelap** sebagai default di console (nyaman untuk piket malam), tema terang tersedia. Kontras tinggi.
- Keparahan dan status **tidak hanya berwarna**: selalu ada ikon dan label teks (aman untuk buta warna).
- Target klik cukup besar untuk aksi utama. Hindari animasi berlebihan (hormati `prefers-reduced-motion`).
- **Pintasan papan ketik** (subset sampel 🔶): `N` laporan manual, `J`/`K` antrean, `Enter` buka, `L` kunci/lepas, `V` verifikasi, `D` dispatch, `/` cari, `Esc` tutup dialog, `?` bantuan pintasan.
- Dukungan beberapa monitor: tiap incident dapat dibuka di jendela baru (`/incidents/:id`).

### 13.2 Aksesibilitas

Label dan peran ARIA pada komponen interaktif, fokus terlihat jelas, dialog menjebak fokus dan dapat ditutup dengan `Esc`, tabel dan daftar dapat dinavigasi papan ketik, peringatan penting disiarkan lewat wilayah `aria-live` (tanpa mencuri fokus).

### 13.3 Performa (target awal 🔶)

| Hal | Target / teknik |
|---|---|
| Waktu event → tampil di antrean | < 1 detik pada kondisi normal |
| Daftar panjang | Virtualisasi (TanStack Virtual), kartu ringan, selektor termemo |
| Banjir laporan | Pembaruan berkelompok (bagian 7.6), tanpa render ulang menyeluruh |
| Ukuran awal | JS awal (console) dijaga kecil: rute admin, peta penuh, dan grafik dimuat bertahap |
| Gambar | Dimuat malas, berukuran sesuai |
| Peta | Pembaruan penanda dibatasi (throttle), cluster untuk banyak titik |

---

## 14. Build, Konfigurasi, dan Deployment Ringkas

| Variabel lingkungan | Contoh |
|---|---|
| `VITE_ENV` | `dev` / `staging` / `prod` (menampilkan lencana **MODE SAMPEL** bila bukan `prod`) |
| `VITE_API_BASE_URL` | `/api/v1` (satu origin lewat reverse proxy) |
| `VITE_WS_URL` | `/realtime` |
| `VITE_MAP_TILE_URL` | URL tile peta |
| `VITE_TIMEZONE` | `Asia/Jakarta` |
| `VITE_TWO_FACTOR_REQUIRED` | `false` pada sampel, `true` pada produksi |

- Build statis (`vite build`), dilayani Nginx (di-container), dengan reverse proxy `/api` dan `/realtime` ke backend (termasuk dukungan upgrade WebSocket) serta header keamanan bagian 11.4.
- *Source map* hanya di staging, tidak dipublikasikan di produksi.
- Sampel: halaman login pada lingkungan non-produksi dapat menampilkan petunjuk akun demo (dari data seed).
- Detail Docker Compose dan CI/CD dibahas di dokumen deployment.

---

## 15. Skenario Uji Dashboard

| Kode | Skenario | Hasil yang diharapkan |
|---|---|---|
| D1 | Login staf (dengan/ tanpa 2FA), ganti sandi awal | Masuk ke console, token di memori, refresh token sesuai kebijakan |
| D2 | Warga mengirim laporan | Muncul di tab **Baru** < 1 detik tanpa muat ulang, chime berbunyi (setelah suara diaktifkan) |
| D3 | Dispatcher A menangani, dispatcher B membuka incident yang sama | B melihat "Sedang ditangani A", mode hanya baca |
| D4 | Verifikasi lalu dispatch batch (ambulans + polisi) | Dua kartu dispatch `OFFERED` dengan hitung mundur, incident pindah ke **Aktif** |
| D5 | Ambulans menolak | Item merah di Perlu Perhatian + alarm. **Pilih pengganti** membuka composer terisi. Setelah pengganti dibuat, item hilang |
| D6 | Offer tidak dilihat 60 detik | `offer_unseen` muncul, tombol Telepon dan **Catat via telepon** tersedia |
| D7 | Damkar berangkat via telepon | **Catat atas nama unit** (waktu 5 menit lalu) → riwayat menunjukkan waktu kejadian ≠ waktu dicatat dan penanda "atas nama" |
| D8 | Resource request dari lead | Item muncul, **Setujui** membuka composer, dispatch `REQUESTED` terbentuk, item hilang |
| D9 | Gabung duplikat | Kandidat tampil berdampingan, setelah gabung seleksi pindah ke induk, sumber hilang dari antrean |
| D10 | Selesaikan saat masih ada dispatch aktif | Dialog daftar dispatch + opsi tutup semua |
| D11 | Input laporan manual saat telepon | Draf tidak hilang saat dialog diperkecil/pindah incident. Peta, pilih wilayah, dan tempel koordinat berfungsi |
| D12 | WebSocket putus lalu tersambung | Banner merah + polling cadangan, setelah sambung: sinkronisasi tanpa duplikat |
| D13 | Supervisor mengambil alih kunci | Pemegang lama melihat modal, ruang kerja menjadi hanya baca, isian formulir tetap bisa disalin |
| D14 | Tampilkan kontak pelapor | Nilai penuh 30 detik lalu dimask, baris `pii.view_reporter` muncul di audit |
| D15 | Terbitkan alert | Konfirmasi dua langkah, pratinjau notifikasi sesuai, level tertinggi menuntut mengetik `KIRIM` |
| D16 | Akhiri shift | Daftar incident yang dipegang tampil, kunci dilepas, catatan serah terima tersedia untuk shift berikutnya |
| D17 | Gating izin | Dispatcher tidak melihat menu admin. Admin Organisasi hanya mengelola organisasinya. Akses langsung ke rute terlarang menampilkan "Tidak tersedia" |
| D18 | Simulasi banjir 300 laporan/menit | Antrean tetap responsif (virtualisasi + batching), tidak ada pembekuan UI |
| D19 | Suara terkunci peramban | Peringatan "Suara belum aktif" tampil sampai pengguna mengaktifkan |
| D20 | Sesi dicabut (`session.revoked`) | Keluar bersih dengan alasan, tidak dapat tersambung ulang |

Jenis pengujian: unit (Vitest) untuk `eventRouter`, `dedupe`, `batcher`, pengurutan antrean, `useLock`, penjaga izin; komponen (Testing Library + MSW) untuk dialog dan formulir; E2E (Playwright) untuk D1-D20 terhadap backend sampel dan tiruan WebSocket.

---

## 16. Penyesuaian Kontrak REST yang Diusulkan

Hasil penyusunan dashboard. Kecuali disebut lain, dimasukkan ke dokumen REST sebagai penyesuaian:

| # | Penyesuaian | Alasan |
|---|---|---|
| 1 | `GET /me` untuk staf juga mengembalikan **`permissions[]`** | Menampilkan menu/tombol sesuai izin tanpa menebak dari nama role |
| 2 | Item `GET /incidents` dan `/sync/snapshot` memuat **`dispatchSummary`** (`active`, `offered`, `rejected`, `expired`, per organisasi) dan **`attentionReasons[]`** (mis. `NEEDS_REPLACEMENT`, `SUGGESTED_DUPLICATE`, `UNSEEN_OFFER`) | Antrean dan Perlu Perhatian dihitung dari state server sehingga tidak hilang saat dimuat ulang |
| 3 | 🔶 Pilihan transport **cookie HttpOnly** untuk refresh token klien web (`transport=cookie`) | Mengurangi risiko XSS pada token jangka panjang. Sampel memakai `sessionStorage` |
| 4 | `appFlavor` tambahan `ADMIN_WEB` pada handshake WebSocket | Membedakan klien web dari aplikasi mobile |
| 5 | 🔶 `POST /incidents/{id}/from-condition-report/{reportId}` (membuat incident dari laporan kondisi) | Banjir: laporan kondisi yang ternyata butuh bantuan |
| 6 | 🔶 Estimasi jumlah penerima alert (`GET /admin/alerts/recipient-estimate`) | Membantu pengambil keputusan sebelum menerbitkan |

---

## 17. Asumsi Default untuk Aplikasi Sampel

| Hal | Default sampel |
|---|---|
| Teknologi | Vite + React + TypeScript, TanStack Query + Zustand, Tailwind + shadcn/ui, Leaflet/OSM |
| Peran di web | Dispatcher, Supervisor, Admin Organisasi, Super Admin. Responder web ditunda |
| Tema | Gelap default untuk console, terang tersedia |
| Zona waktu | `Asia/Jakarta` |
| Refresh token | `sessionStorage` |
| 2FA | Dimatikan di lingkungan sampel |
| Shift | Wajib mulai shift untuk aksi tulis: **tidak** (hanya peringatan) |
| Polling cadangan | 10 detik saat WebSocket putus |
| Alarm CRITICAL | Diulang 3 kali tiap 10 detik atau sampai dibuka |
| Peringatan mute | Setelah 10 menit |
| Pembaruan berkelompok | ±200 ms |
| Input lokasi manual | Peta + pilih wilayah + tempel koordinat/tautan. Tanpa geocoding eksternal |
| Alert | Mode wilayah (kecamatan) saja. Polygon/geofence ditunda |
| Kunci layar otomatis saat idle | Tidak ada |
| Pintasan papan ketik | Subset (bagian 13.1) |
| Ringkasan | Kartu angka saja, tanpa grafik |

---

## 18. Hal yang Perlu Ditinjau (Setelah Sampel, Bersama Client) 🔶

1. **Jumlah dispatcher per shift dan model shift** (apakah aksi wajib berada dalam shift aktif).
2. **Kebijakan alarm:** pengulangan, nada, dan apakah alarm tetap berbunyi saat layar terkunci.
3. **Kunci layar otomatis** saat idle, dan lama idle yang wajar untuk ruang kontrol.
4. **Sumber geocoding/POI** untuk mengubah alamat/patokan menjadi koordinat (database patokan kota, layanan eksternal, atau tetap manual).
5. **Menggambar polygon/radius** untuk alert geofence, dan kebutuhan estimasi penerima.
6. **Tema, bahasa, dan identitas visual** (logo, warna instansi).
7. **Responder di web** (stakeholder memakai web, bukan hanya Android).
8. **Layar besar/video wall** untuk ruang kontrol (fase 3).
9. **Cookie HttpOnly** untuk refresh token pada produksi.
10. **Pustaka UI** (shadcn/Tailwind vs Ant Design/MUI) sesuai kebiasaan tim yang akan memelihara.
11. **Retensi dan pencarian riwayat** (berapa lama incident dan audit dapat dicari di dashboard).
12. **Pintasan papan ketik** dan kebiasaan kerja dispatcher yang sebenarnya.

---

## 19. Di Luar Cakupan Dokumen Ini

- Desain visual rinci (warna, tipografi, komponen) dan prototipe layar.
- Antarmuka responder di web dan Flutter Web.
- Peta langsung unit (live tracking), video wall, dan analitik/ekspor laporan lanjutan.
- Integrasi telepon (CTI/softphone) dan pencatatan panggilan.
- Docker Compose, CI/CD, dan hardening produksi (dokumen deployment).
- Konversi kontrak ke OpenAPI/AsyncAPI dan dokumen serah terima untuk agent code.
