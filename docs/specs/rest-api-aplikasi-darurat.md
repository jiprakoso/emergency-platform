# Kontrak REST API v1: Aplikasi Informasi Bencana & Kejadian Darurat

> Status: draft v1 (kontrak/spesifikasi, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `erd-aplikasi-darurat.md`
> Cakupan: REST saja. Event WebSocket dan payload FCM dibahas di dokumen terpisah (langkah berikutnya).
> Tanda 🔶 = keputusan yang perlu ditinjau.
> Dokumen ini disiapkan sebagai bahan untuk agent code dan akan dikonversi menjadi OpenAPI (YAML) setelah disetujui.

---

## 1. Konvensi Umum

| Topik | Aturan |
|---|---|
| Base URL | `/api/v1` (versi di URL). Perubahan yang merusak kontrak = `/api/v2` |
| Format | JSON (`application/json; charset=utf-8`). Pengecualian: unggah berkas langsung ke object storage lewat presigned URL |
| Penamaan field | `camelCase` di JSON, `snake_case` di database. Enum `UPPER_SNAKE_CASE` |
| Waktu | ISO 8601 UTC, contoh `2026-10-05T03:15:00Z` |
| Koordinat | Objek `{ "lat": -7.2575, "lng": 112.7521, "accuracyM": 12.5 }` (bukan array, agar tidak tertukar urutan lat/lng) |
| ID | UUID string. Kecuali `incident_events` dan `audit_logs` yang memakai angka (`id` bertipe string berisi angka agar aman untuk klien) |
| Autentikasi | `Authorization: Bearer <accessToken>` kecuali endpoint publik |
| Correlation | Server selalu mengembalikan header `X-Request-Id`. Klien boleh mengirimnya untuk pelacakan |
| Bahasa pesan error | Indonesia (`message`), kode error (`code`) tetap bahasa Inggris dan stabil |

### 1.1 Format respons

Satu resource:

```json
{ "data": { "id": "..." } }
```

Daftar (pagination berbasis kursor):

```json
{
  "data": [ { "id": "..." } ],
  "page": { "nextCursor": "eyJpZCI6Ii4uLiJ9", "hasMore": true }
}
```

Error (semua status 4xx/5xx):

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Dispatch tidak dapat berpindah dari DONE ke EN_ROUTE.",
    "details": [ { "field": "toStatus", "issue": "not_allowed_from_current" } ],
    "requestId": "a1b2c3"
  }
}
```

### 1.2 Pagination, filter, sort

- Parameter: `limit` (default 25, maksimum 100), `cursor` (opaque, dari `page.nextCursor`).
- Filter lewat query string, nilai jamak dipisah koma: `status=SUBMITTED,VERIFIED`.
- Sort: `sort=-createdAt` (awalan `-` = menurun). Hanya kolom yang diizinkan per endpoint.
- Pencarian teks bebas: `q`.

### 1.3 Idempotensi

- **Laporan warga:** kunci idempotensi adalah `clientReportId` (UUID dibuat di Flutter). Pengiriman ulang dengan id yang sama mengembalikan **200 dengan resource yang sama** (bukan 201 baru, bukan error). Ini wajib untuk antrean offline.
- **Aksi lain yang mengubah status dari mobile** (accept, reject, ganti status dispatch, dll.): header `Idempotency-Key: <uuid>`. Disimpan 24 jam. Kunci sama + isi sama = respons yang sama. Kunci sama + isi beda = `422 IDEMPOTENCY_CONFLICT`.
- Transisi status yang sudah tercapai diperlakukan idempoten: mengirim `accept` pada dispatch yang sudah `ACCEPTED` oleh pengguna yang sama mengembalikan 200, bukan error.

### 1.4 Optimistic locking

Resource yang punya `version` (`incidents`, `dispatches`) menerima `version` di body untuk aksi yang mengubahnya. Bila tidak cocok: `409 VERSION_CONFLICT` beserta `currentVersion`. Klien memuat ulang lalu mencoba lagi.

### 1.5 Waktu kejadian vs pencatatan

Endpoint yang mencatat kejadian lapangan menerima `occurredAt` (opsional). Aturan:
- Server selalu mengisi `recordedAt` sendiri.
- `occurredAt` tidak boleh lebih dari 5 menit di masa depan, dan tidak boleh lebih dari 24 jam di masa lalu (kecuali dispatcher/supervisor).
- Bila tidak dikirim, `occurredAt = recordedAt`.

### 1.6 Keamanan dasar

HTTPS wajib. CORS hanya untuk origin web admin/stakeholder. `helmet`, validasi DTO ketat (`whitelist` + `forbidNonWhitelisted`), batas ukuran body 1 MB. Data pelapor tidak pernah dikirim ke klien yang tidak berhak (disaring di serializer, bukan hanya disembunyikan di UI).

### 1.7 Semantik respons mutasi (CC-005, diputuskan 2026-10-28)

- Operasi mutasi (`POST`/`PATCH`/`PUT`) yang **mengubah satu entitas** membalas `200`/`201` **dengan entitas ter-update** di dalam `data`, sehingga klien dapat memperbarui state lokalnya tanpa refetch. Bentuknya mengikuti view yang sesuai dengan audiens (mis. `DispatcherViewIncident` untuk aksi incident, `OfferView`/`UnitView` untuk aksi dispatch, `AlertView` untuk admin alert).
- Operasi yang murni **acknowledgement/tanpa entitas** membalas `204` tanpa isi: `POST /auth/logout`, `POST /auth/password/change`, `POST /auth/2fa/enable`, `DELETE /auth/sessions/{id}`, `DELETE /me/devices/{id}`, `DELETE /incidents/{id}/lock`, `DELETE /resource-requests/{id}`, `POST /notifications/{id}/seen`, `POST /notifications/seen-all`, `POST /notifications/{id}/delivered`. Klien **wajib menyegarkan state sendiri** setelah menerima `204`.
- Halaman `/health` dan `/health/ready` bukan mutasi (balasan probe tanpa `data`).

---

## 2. Autentikasi dan Sesi

| Item | Aturan |
|---|---|
| Access token | JWT, masa berlaku 15 menit. Klaim: `sub`, `sid` (session id), `roles`, `orgId`, `unitId` (bila ada) |
| Refresh token | Opaque, masa berlaku 30 hari untuk warga, 12 jam untuk staf 🔶. **Rotasi** setiap dipakai, token lama otomatis tidak berlaku. Pemakaian ulang token lama = seluruh sesi dicabut |
| Warga | Masuk dengan OTP nomor HP, tanpa kata sandi |
| Staf | Nomor HP/email + kata sandi. **2FA (TOTP) wajib** untuk `DISPATCHER` dan `SUPERVISOR` |
| Sesi | Satu baris `auth_sessions` per perangkat. Dapat dicabut oleh pengguna, admin organisasi, atau saat akun dinonaktifkan |
| Izin | Permission **tidak** ditaruh di token. Dihitung di server dari role (cache singkat), sehingga perubahan hak akses langsung berlaku |

Aliran warga:

```
POST /auth/otp/request  →  POST /auth/citizen/register  (akun baru)
                        →  POST /auth/citizen/login     (akun lama)
```

Aliran staf:

```
POST /auth/staff/login  →  [bila 2FA] POST /auth/staff/login/2fa
```

---

## 3. Katalog Permission

Permission adalah string yang dipetakan ke role lewat tabel `role_permissions`. Kolom "Pembatas" menunjukkan pengecekan relasi di policy layer (bukan hanya role).

| Permission | Kegunaan | Role default | Pembatas |
|---|---|---|---|
| `report.create` | Buat laporan | CITIZEN, DISPATCHER, SUPERVISOR | |
| `report.read_own` | Lihat laporan sendiri | CITIZEN | milik sendiri |
| `incident.read_all` | Lihat seluruh incident | DISPATCHER, SUPERVISOR | |
| `incident.read_related` | Lihat incident yang terkait | RESPONDER | punya dispatch, atau organisasinya lead |
| `incident.create_manual` | Input laporan manual | DISPATCHER, SUPERVISOR | |
| `incident.lock` | Kunci/buka incident | DISPATCHER, SUPERVISOR | |
| `incident.lock_override` | Ambil alih kunci | SUPERVISOR | |
| `incident.update` | Ubah data incident | DISPATCHER, SUPERVISOR | pemegang kunci |
| `incident.verify` | Verifikasi | DISPATCHER, SUPERVISOR | pemegang kunci |
| `incident.invalidate` | Tandai INVALID | DISPATCHER, SUPERVISOR | pemegang kunci |
| `incident.merge` | Gabung duplikat | DISPATCHER, SUPERVISOR | pemegang kunci |
| `incident.set_lead` | Ubah pemegang komando | DISPATCHER, SUPERVISOR | |
| `incident.close` | Resolve/close | DISPATCHER, SUPERVISOR | |
| `note.create` | Catatan internal | DISPATCHER, SUPERVISOR | |
| `casualty.update` | Update data korban | RESPONDER, DISPATCHER, SUPERVISOR | responder: terkait |
| `milestone.create` | Catat milestone | RESPONDER, DISPATCHER, SUPERVISOR | responder: **lead** |
| `dispatch.create` | Buat dispatch | DISPATCHER, SUPERVISOR | |
| `dispatch.record_on_behalf` | Catat atas nama unit | DISPATCHER, SUPERVISOR | |
| `dispatch.respond` | Accept/reject/seen/update status | RESPONDER | unit/organisasi sendiri |
| `dispatch.self_initiate` | "Saya berangkat" | RESPONDER | unit sendiri |
| `dispatch.cancel` | Batalkan dispatch | DISPATCHER, SUPERVISOR | |
| `resource_request.create` | Ajukan bantuan | RESPONDER | **lead** |
| `resource_request.decide` | Setujui/tolak | DISPATCHER, SUPERVISOR | |
| `unit.update_own` | Posisi/status unit | RESPONDER | unit sendiri |
| `pii.reveal_reporter` | Lihat kontak pelapor | DISPATCHER, SUPERVISOR | tercatat di audit |
| `alert.create` | Buat/ubah alert | ALERT_MANAGER (admin BPBD), DISPATCHER, SUPERVISOR 🔶 | |
| `alert.close` | Tutup alert | ALERT_MANAGER (admin BPBD), DISPATCHER, SUPERVISOR 🔶 | |
| `condition_report.read` | Peta laporan kondisi | DISPATCHER, SUPERVISOR, ALERT_MANAGER (admin BPBD) | |
| `shift.manage` | Shift dan serah terima | DISPATCHER, SUPERVISOR | |
| `dashboard.read` | Ringkasan dan peta | DISPATCHER, SUPERVISOR | |
| `org.manage_own` | Kelola organisasi/unit sendiri | ORG_ADMIN | organisasi sendiri |
| `org.manage_all` | Kelola semua organisasi | SUPER_ADMIN | |
| `staff.manage_own` | Kelola akun staf organisasi sendiri | ORG_ADMIN | organisasi sendiri |
| `staff.manage_all` | Kelola semua akun | SUPER_ADMIN | |
| `role.manage` | Kelola role dan permission | SUPER_ADMIN | |
| `audit.read_own_org` | Audit organisasi sendiri | ORG_ADMIN | |
| `audit.read_all` | Seluruh audit | SUPERVISOR, SUPER_ADMIN | |
| `settings.manage` | Pengaturan sistem | SUPER_ADMIN | |

---

## 4. Tampilan Data per Role (field-level)

Satu resource punya beberapa bentuk. Penyaringan dilakukan di serializer berdasarkan role, relasi ke incident, dan status dispatch.

### 4.1 Incident

| Field | Warga (laporan sendiri) | Responder, belum accept (`OfferView`) | Responder, sudah accept (`UnitView`) | Dispatcher/Supervisor (`DispatcherView`) |
|---|---|---|---|---|
| `code`, `type`, `createdAt` | ✓ | ✓ | ✓ | ✓ |
| `status` | `publicStatus` saja | ✓ (disederhanakan) | ✓ | ✓ penuh |
| `severity`, `escalationLevel` | | ✓ | ✓ | ✓ |
| Wilayah kasar (`district`, `village`) | | ✓ | ✓ | ✓ |
| `distanceM` dari unit | | ✓ | ✓ | |
| `location` presisi | milik sendiri | ✗ | ✓ | ✓ |
| `addressText`, `description` | milik sendiri | ✗ | ✓ | ✓ |
| Lampiran | milik sendiri | ✗ | ✓ | ✓ |
| Kontak/identitas pelapor | ✗ | ✗ | ✗ (lewat dispatcher) 🔶 | ✓ (dengan pencatatan audit saat dibuka) |
| Dispatch unit lain | | ✗ | ringkasan (`organization`, `status`) | ✓ penuh |
| Data korban | | ✗ | ✓ bila terkait | ✓ |

Aturan tambahan:
- **Organisasi lead** melihat `UnitView` ditambah daftar seluruh dispatch di incident itu.
- Nomor telepon pelapor di daftar laporan **dimask** (`0812****789`). Membuka nomor penuh lewat endpoint khusus dan tercatat di `audit_logs` (`pii.view_reporter`).

### 4.2 `publicStatus` untuk warga

| `publicStatus` | Diturunkan dari | Teks yang ditampilkan |
|---|---|---|
| `RECEIVED` | Incident `SUBMITTED` | Laporan diterima |
| `VERIFIED` | `VERIFIED`, belum ada dispatch aktif | Laporan diverifikasi |
| `UNIT_DISPATCHED` | Ada dispatch `OFFERED`/`ACCEPTED` | Bantuan sedang disiapkan |
| `UNIT_EN_ROUTE` | Ada dispatch `EN_ROUTE` | Unit menuju lokasi |
| `UNIT_ON_SCENE` | Ada dispatch `ON_SCENE` | Unit telah tiba di lokasi |
| `RESOLVED` | `RESOLVED`, `CLOSED` | Penanganan selesai |
| `NOT_VALID` | `INVALID` | Laporan tidak dapat ditindaklanjuti (disertai alasan umum) |
| `OUT_OF_AREA` | Flag di luar wilayah | Di luar wilayah layanan, hubungi nomor darurat |

Laporan yang digabung (`DUPLICATE`) menampilkan `publicStatus` milik incident induknya.

### 4.3 Contoh `OfferView` (responder, belum accept)

```json
{
  "dispatchId": "0192...",
  "incident": {
    "code": "INC-20261005-000123",
    "type": { "code": "TRAFFIC_ACCIDENT", "name": "Kecelakaan Lalu Lintas" },
    "severity": "HIGH",
    "district": { "code": "35.78.07", "name": "Gubeng" },
    "village": { "code": "35.78.07.1002", "name": "Airlangga" },
    "distanceM": 1800
  },
  "type": "RESPOND",
  "origin": "DISPATCHER",
  "status": "OFFERED",
  "offerExpiresAt": "2026-10-05T03:17:00Z",
  "note": "Korban lebih dari satu"
}
```

Setelah `accept`, respons `POST /dispatches/{id}/accept` memuat `UnitView` lengkap dengan `location`, `addressText`, `description`, dan lampiran.

---

## 5. Daftar Endpoint

Kolom izin: `-` = publik, `auth` = pengguna login mana pun, selain itu kode permission (lihat bagian 3).

### 5.1 Autentikasi dan akun

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/auth/otp/request` | - | Minta OTP. Body: `phone`, `purpose` (`REGISTER`/`LOGIN`). Respons 202: `expiresInSeconds`, `resendAfterSeconds` |
| POST | `/auth/citizen/register` | - | Body: `phone`, `otpCode`, `fullName`, `homeLocation?`, `device` → token |
| POST | `/auth/citizen/login` | - | Body: `phone`, `otpCode`, `device` → token |
| POST | `/auth/staff/login` | - | Body: `identifier` (HP/email), `password`, `device`. Bila 2FA aktif: `200 { twoFactorRequired: true, challengeToken }` |
| POST | `/auth/staff/login/2fa` | - | Body: `challengeToken`, `code` → token |
| POST | `/auth/refresh` | - | Body: `refreshToken` → token baru (rotasi) |
| POST | `/auth/logout` | auth | Cabut sesi saat ini, ikut mencabut token FCM perangkat itu |
| GET | `/auth/sessions` | auth | Daftar sesi aktif sendiri |
| DELETE | `/auth/sessions/{id}` | auth | Cabut sesi tertentu |
| POST | `/auth/password/change` | auth | Ganti kata sandi staf. Wajib bila `mustChangePassword` 🔶 |
| POST | `/auth/2fa/setup` | auth (staf) | Mulai pendaftaran TOTP → `secret`, `otpauthUri` |
| POST | `/auth/2fa/enable` | auth (staf) | Konfirmasi dengan `code` |
| GET | `/me` | auth | Profil, role, organisasi/unit, wilayah rumah. Untuk staf juga **`permissions[]`** (dipakai dashboard untuk menampilkan menu/tombol, bukan untuk penegakan akses) |
| PATCH | `/me` | auth | Ubah `fullName`, `email`, `homeLocation`, `homeAddress`. Perubahan lokasi rumah memicu penghitungan ulang wilayah (`homeRegionId`) |
| POST | `/me/devices` | auth | Daftarkan/perbarui token FCM: `fcmToken`, `platform`, `appFlavor`, `appVersion`, `pushEnabled`. Server melanggankan topic wilayah (warga) dan memperbarui `last_seen_at`. Token yang sudah terikat ke pengguna lain dipindahkan ke pengguna ini |
| DELETE | `/me/devices/{id}` | auth | Cabut perangkat |
| GET | `/me/alert-topics` | auth (warga) | Daftar FCM topic sesuai wilayah rumah (mis. `prod_kec_357807`). **Hanya informasi/verifikasi**: langganan dilakukan oleh server, bukan klien |

`device` pada register/login: `{ "platform": "ANDROID", "appFlavor": "CITIZEN", "appVersion": "1.0.0", "fcmToken": "..." }`.

Respons token:

```json
{
  "data": {
    "accessToken": "eyJ...", "accessTokenExpiresIn": 900,
    "refreshToken": "r1.xxxx", "refreshTokenExpiresIn": 2592000,
    "user": { "id": "...", "userType": "CITIZEN", "fullName": "Budi", "roles": ["CITIZEN"] }
  }
}
```

### 5.2 Referensi dan konfigurasi publik

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/config/public` | - | `serverTime`, `minAppVersion`, `operatingHours`, `operatingNow`, `emergencyContacts` (nomor **contoh**, bukan nomor asli), `limits` (ukuran berkas, jumlah lampiran), `disclaimer`, `sampleMode` (lencana MODE SAMPEL; lihat CC-007) |
| GET | `/incident-types` | auth | Daftar jenis kejadian aktif (`code`, `name`, `category`, `allowsConditionReport`) |
| GET | `/regions` | auth | Filter `level`, `parentId`. Tanpa polygon (ringan) |
| GET | `/regions/resolve?lat=&lng=` | auth | Menentukan kecamatan/kelurahan dari titik. Respons: `{ inServiceArea, district, village }` |

`/config/public` dipakai aplikasi warga saat dibuka, agar tombol telepon darurat dan jam operasional selalu tersedia **bahkan sebelum login** (disimpan lokal sebagai cadangan).

### 5.3 Lampiran

Berkas tidak lewat server API. Alurnya tiga langkah:

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/attachments/uploads` | auth | Body: `fileName`, `mimeType`, `sizeBytes`, `kind`, `purpose` (`REPORT`/`INCIDENT`/`DISPATCH`), `ownerId?`. Respons: `attachmentId`, `uploadUrl` (presigned PUT), `expiresAt`. Untuk `purpose = REPORT`, `ownerId` (id laporan milik sendiri) boleh diisi **setelah laporan dibuat**, sehingga aplikasi dapat mengirim teks dan lokasi lebih dulu lalu foto menyusul |
| - | `PUT {uploadUrl}` | - | Klien mengunggah langsung ke object storage |
| POST | `/attachments/{id}/confirm` | auth | Server memeriksa berkas ada, ukuran dan tipe sesuai. Status `PENDING → CONFIRMED` |
| GET | `/attachments/{id}/url` | sesuai akses incident | Mengembalikan signed URL baca (berumur pendek). Mengikuti aturan visibilitas bagian 4 |

Batas awal 🔶: foto `image/jpeg|png|webp` maksimal 10 MB, video `video/mp4` maksimal 50 MB, maksimal 5 lampiran per laporan. Lampiran `PENDING` yang tidak dikonfirmasi dalam 24 jam dibersihkan job.

### 5.4 Laporan warga

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/reports` | `report.create` | Buat laporan (idempoten lewat `clientReportId`) |
| GET | `/reports/mine` | `report.read_own` | Daftar laporan sendiri (kursor) |
| GET | `/reports/{id}` | `report.read_own` | Detail + `publicStatus`. untuk membuka nomor penuh melalui `POST /reports/{id}/reveal-contact` |
| GET | `/reports/{id}/timeline` | `report.read_own` | Event ber-`visibility = PUBLIC`, urut waktu. Dilapisi serializer berdasarkan role (warga: hanya event Publik; responder: event tambahan) |
| POST | `/reports/{id}/follow-ups` | `report.create` | Laporan susulan (korban bertambah, info baru). Menjadi laporan baru di incident yang sama dan memberi notifikasi ke dispatcher |
| POST | `/reports/{id}/withdraw` | `report.read_own` | Warga menarik laporan: `reason`. **Tidak** membatalkan incident, hanya mencatat. Dispatcher yang memutuskan |

`POST /reports`:

```json
{
  "clientReportId": "0192f3a0-....",
  "reportKind": "HELP_REQUEST",
  "typeCode": "TRAFFIC_ACCIDENT",
  "location": { "lat": -7.2655, "lng": 112.7471, "accuracyM": 9.5 },
  "addressText": "Jl. Raya Darmo depan Taman Bungkul",
  "description": "Truk menabrak motor, pengendara tidak sadar",
  "victimHint": "TWO",
  "occurredAt": "2026-10-05T03:12:00Z",
  "attachmentIds": ["...", "..."]
}
```

Respons `201` (atau `200` bila `clientReportId` sudah pernah diterima):

```json
{
  "data": {
    "id": "...",
    "reportKind": "HELP_REQUEST",
    "status": "NEW",
    "incident": { "id": "...", "code": "INC-20261005-000123" },
    "publicStatus": "RECEIVED",
    "flags": [],
    "operatingNow": true,
    "emergencyContacts": [ { "name": "Darurat 112", "phone": "112" } ]
  }
}
```

Aturan:
- `reportKind = HELP_REQUEST` selalu membuat incident baru `SUBMITTED`. Sistem **tidak menggabung otomatis**. Bila ada incident aktif berdekatan, hanya mengisi `suggestedIncidentId` untuk dilihat dispatcher. 🔶
- `reportKind = CONDITION_REPORT` tidak membuat incident dan tidak masuk antrean. Hanya diizinkan bila `incident_types.allowsConditionReport = true`, selain itu `422 REPORT_KIND_NOT_ALLOWED`.
- **Lokasi di luar wilayah layanan** tidak ditolak. Laporan tetap diterima dengan `flags: ["OUT_OF_AREA"]`, `publicStatus: OUT_OF_AREA`, dan dispatcher memutuskan. Menolak laporan darurat karena batas peta berisiko lebih besar daripada menerimanya. 🔶
- Di luar jam operasional: tetap diterima, `operatingNow: false`, dan aplikasi menampilkan pesan agar menghubungi nomor darurat langsung.
- `occurredAt` tunduk pada aturan bagian 1.5.
- Pembatasan laju lihat bagian 8.

### 5.5 Incident (dispatcher, supervisor, dan akses terbatas responder)

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/incidents` | `incident.read_all` | Antrean/daftar. Filter: `status`, `typeCode`, `severity`, `districtId`, `leadOrgId`, `lockedBy`, `flag`, `from`, `to`, `q`. Sort: `-createdAt`, `-severity`. Setiap item memuat `dispatchSummary` (jumlah dispatch `active`, `offered`, `rejected`, `expired`, per organisasi) dan `attentionReasons[]` (mis. `NEEDS_REPLACEMENT`, `SUGGESTED_DUPLICATE`, `UNSEEN_OFFER`, `PENDING_RESOURCE_REQUEST`) agar dashboard dapat menghitung "Perlu Perhatian" dari state server |
| GET | `/incidents/{id}` | `incident.read_all` atau `incident.read_related` | Bentuk sesuai bagian 4.1. Menampilkan `publicStatus`, casualties jika terkait, dispatches per organisasi, visibilitas lokasi dan kontak pelapor berdasarkan role (tampilan `OfferView` sebelum accept, `UnitView` sesudah accept, `DispatcherView` penuh). |
| POST | `/incidents` | `incident.create_manual` | Input manual (penelepon). Body: `typeCode`, `location`, `addressText`, `description`, `reporter { name, phone }`, `channel` (`PHONE`/`WHATSAPP`/`SMS`), `severity?` |
| POST | `/incidents/{id}/lock` | `incident.lock` | Ambil kunci. `409 INCIDENT_LOCKED` bila dipegang orang lain (respons memuat `lockedBy`, `lockedAt`). `{ "force": true }` hanya dengan `incident.lock_override` |
| POST | `/incidents/{id}/lock/renew` | `incident.lock` | Perpanjang kunci (heartbeat dari web admin, tiap ±60 detik). Kunci default berlaku 5 menit 🔶 |
| DELETE | `/incidents/{id}/lock` | `incident.lock` | Lepas kunci |
| PATCH | `/incidents/{id}` | `incident.update` | Ubah `typeCode`, `severity`, `escalationLevel`, `summary`, `location`, `addressText`. Wajib `version` dan memegang kunci |
| POST | `/incidents/{id}/verify` | `incident.verify` | `SUBMITTED → VERIFIED`. Body: `version`, `severity`, `leadOrganizationId?`, `summary?`. Bila `leadOrganizationId` kosong, diisi dari `incident_types.defaultLeadOrgType` |
| POST | `/incidents/{id}/invalidate` | `incident.invalidate` | `→ INVALID`. Body: `version`, `reason` (wajib). Menurunkan `reputationScore` pelapor |
| POST | `/incidents/{id}/merge` | `incident.merge` | Incident ini menjadi `DUPLICATE` dari `targetIncidentId`. Semua laporan dipindahkan. Body: `version`, `targetIncidentId`, `reason?` |
| GET | `/incidents/{id}/nearby` | `incident.read_all` | Kandidat duplikat: incident aktif dalam `radiusM` (default 300) dan `hours` (default 6) |
| PUT | `/incidents/{id}/lead` | `incident.set_lead` | Body: `organizationId`, `reason`. Tercatat di event `LEAD_CHANGED` |
| POST | `/incidents/{id}/resolve` | `incident.close` | `→ RESOLVED`. Body: `version`, `note?`, `forceCloseDispatches?`. Bila masih ada dispatch aktif dan `forceCloseDispatches` tidak true: `409 ACTIVE_DISPATCHES_EXIST` |
| POST | `/incidents/{id}/close` | `incident.close` | `RESOLVED → CLOSED`. Body: `version`, `note?` |
| POST | `/incidents/{id}/notes` | `note.create` | Catatan: `text`, `visibility` (`INTERNAL`/`LEAD`/`UNITS`) |
| GET | `/incidents/{id}/reports` | `incident.read_all` | Laporan tertaut. Kontak dimask |
| POST | `/reports/{id}/reveal-contact` | `pii.reveal_reporter` | Membuka nomor/nama pelapor penuh. **Menulis audit log** |
| POST | `/incidents/{id}/casualties` | `casualty.update` | Body: `injured`, `deceased`, `critical?`, `missing?`, `note?`. Menambah baris riwayat di `IncidentCasualty` entity. Casualty baris mencatat `injured`, `deceased`, `critical`, `missing`, `note`, serta `occurredAt` dan `recordedAt`. RESPONDER hanya bisa memperbarui korban terkait dispatch mereka. |
| POST | `/incidents/{id}/milestones` | `milestone.create` | Body: `code`, `note?`, `payload?`, `occurredAt?`. Responder hanya bila organisasinya lead |
| GET | `/incidents/{id}/events` | sesuai akses | Event log (kursor `afterId`), disaring `visibility` sesuai role (dilapisan serializer berdasarkan role, incident status, dan dispatch status) |
| GET | `/incidents/{id}/dispatch-recommendations` | `dispatch.create` | Parameter: `orgType`, `unitType`. Daftar unit/organisasi terurut: `distanceM`, `status`, `inServiceArea`, `alreadyAssigned`. Type-specific recommendations: `fire` → pump & ladder trucks; `accident` → rescue & ambulance; `flood` → rescue boat & water pumps. Disertakan info `alreadyDispatched` per organisasi. |

Kode milestone awal: `SCENE_RELEASED`, `ROAD_REOPENED`, `VICTIM_DECEASED_HANDLED`, `EXTERNAL_UNIT_ARRIVED` (`payload: { organization, units, source: "DIPANGGIL" | "MANDIRI" }`), `EXTERNAL_COORDINATION`. Daftar kode divalidasi di aplikasi sehingga menambah kode tidak perlu migrasi.

Aturan perubahan data:
- Semua aksi yang mengubah incident wajib memegang kunci (kecuali aksi responder dan sistem). Tidak memegang kunci: `409 LOCK_REQUIRED`.
- Setiap aksi menulis satu baris ke `incident_events` dan, bila sensitif, ke `audit_logs`.
- Transisi status mengikuti bagian 6.

### 5.6 Dispatch

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/incidents/{id}/dispatches` | `dispatch.create` | Buat satu dispatch |
| POST | `/incidents/{id}/dispatches/batch` | `dispatch.create` | Buat beberapa sekaligus (ambulans + polisi bersamaan). Atomik: gagal satu = gagal semua |
| POST | `/incidents/{id}/dispatches/on-behalf` | `dispatch.record_on_behalf` | Catat penugasan/keberangkatan yang terjadi di luar aplikasi |
| GET | `/dispatches/mine` | `dispatch.respond` | Dispatch untuk unit/organisasi pengguna. Filter `status`, `active=true` |
| GET | `/dispatches/{id}` | sesuai akses | Bentuk `OfferView` atau `UnitView` sesuai status |
| POST | `/dispatches/{id}/seen` | `dispatch.respond` | Ack "offer sudah dilihat" (`offer_seen_at`) |
| POST | `/dispatches/{id}/accept` | `dispatch.respond` | Terima. Body: `unitId?` (wajib bila dispatch ditujukan ke organisasi tanpa unit), `etaMinutes?` |
| POST | `/dispatches/{id}/reject` | `dispatch.respond` | Tolak. Body: `reason` |
| POST | `/dispatches/{id}/status` | `dispatch.respond` atau `dispatch.record_on_behalf` | Pindah status (`EN_ROUTE`, `ON_SCENE`, `DONE`, serta status NOTIFY). Body: `toStatus`, `version`, `occurredAt?`, `note?`, `outcomeCode?`, `outcomeNote?`, `channel?` (diisi saat atas nama) |
| POST | `/dispatches/{id}/destination` | `dispatch.respond` atau `dispatch.create` | Pilih RS tujuan: `organizationId`, `patientSummary { injured, critical }`, `etaMinutes?`. Server mengisi `destinationOrganizationId` dan **membuat dispatch NOTIFY ke IGD** terkait |
| POST | `/dispatches/{id}/cancel` | `dispatch.cancel` | Batalkan. Body: `reason` |
| POST | `/incidents/{id}/self-initiate` | `dispatch.self_initiate` | "Saya berangkat". Body: `unitId`, `etaMinutes?`. Membuat dispatch `origin = SELF_INITIATED` langsung `EN_ROUTE`. Dispatcher dinotifikasi |

`POST /incidents/{id}/dispatches`:

```json
{
  "organizationId": "...",
  "unitId": null,
  "type": "RESPOND",
  "note": "Korban lebih dari satu, siapkan tandu",
  "offerTimeoutSeconds": 120
}
```

Aturan:
- Incident harus `VERIFIED` atau `IN_PROGRESS`, selain itu `409 INCIDENT_NOT_DISPATCHABLE`.
- `type = RESPOND` → status awal `OFFERED`, `offer_expires_at` diisi (default dari `system_settings.offer_timeout_seconds`), notifikasi dikirim ke responder organisasi/unit.
- `type = NOTIFY` → status awal `NOTIFIED` (tanpa timeout, IGD menjawab `READY` atau `FULL`).
- Unit yang dituju harus `AVAILABLE` dan aktif. Bila tidak: `409 UNIT_NOT_AVAILABLE`. Dispatcher boleh memaksa dengan `ignoreAvailability: true`, tercatat di event. 🔶
- **Dispatch pengganti** (setelah `REJECTED`/`EXPIRED`): dispatcher cukup membuat dispatch baru. Tidak ada endpoint "reassign", dispatch lama tetap ada sebagai riwayat.
- Saat dispatch pertama berstatus `ACCEPTED`/`EN_ROUTE`, incident otomatis menjadi `IN_PROGRESS`.
- Dispatch `accept` ke offer yang sudah `EXPIRED`/`CANCELLED`: `409 OFFER_NO_LONGER_AVAILABLE`.
- Dua responder dari organisasi yang sama menekan `accept` bersamaan: yang pertama berhasil, yang kedua menerima `409 DISPATCH_ALREADY_ACCEPTED`.

`POST /incidents/{id}/dispatches/on-behalf` (contoh damkar berangkat sesuai kabar via WhatsApp):

```json
{
  "organizationId": "...",
  "unitId": "...",
  "type": "RESPOND",
  "origin": "SELF_INITIATED",
  "initialStatus": "EN_ROUTE",
  "channel": "WHATSAPP",
  "occurredAt": "2026-10-05T03:14:00Z",
  "note": "Pos Damkar A berangkat 2 unit"
}
```

Mengisi `recordedBy` = dispatcher, `channel`, `occurredAt`, dan menulis `dispatch_status_history` dengan `occurred_at` ≠ `recorded_at`.

### 5.7 Permintaan bantuan tambahan (resource request)

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/incidents/{id}/resource-requests` | `resource_request.create` | Body: `resourceType` (jenis organisasi/unit), `quantity`, `urgency` (`NORMAL`/`URGENT`), `reason`. Hanya dari organisasi **lead** (`403 NOT_LEAD_ORGANIZATION`) |
| GET | `/resource-requests` | `resource_request.decide` | Filter `status=PENDING`, `incidentId` |
| POST | `/resource-requests/{id}/approve` | `resource_request.decide` | Body: `dispatches: [ { organizationId, unitId?, type, note? } ]`. Membuat dispatch `origin = REQUESTED` yang tertaut |
| POST | `/resource-requests/{id}/reject` | `resource_request.decide` | Body: `note` |
| DELETE | `/resource-requests/{id}` | `resource_request.create` | Pemohon membatalkan selama `PENDING` |

### 5.8 Unit

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| PUT | `/units/{id}/status` | `unit.update_own` atau `org.manage_own` | `AVAILABLE`, `BUSY`, `OFFLINE`, `OUT_OF_SERVICE` |
| PUT | `/units/{id}/location` | `unit.update_own` | `lat`, `lng`, `accuracyM`, `recordedAt`. Fase 1: hanya mengisi `last_location`. Pengiriman berkala lewat WebSocket (dokumen berikutnya) |
| GET | `/units` | `incident.read_all` | Daftar unit untuk dispatcher: filter `orgType`, `status`, `districtId` |

### 5.9 Alert bencana

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/alerts` | auth | Alert `ACTIVE`. Warga: otomatis yang relevan dengan wilayah rumah (`scope=mine`, default). Parameter `scope=all`, `category`, `cursor` |
| GET | `/alerts/{id}` | auth | Detail |
| GET | `/admin/alerts` | `alert.create` | Semua status termasuk `DRAFT`/`CLOSED` |
| POST | `/admin/alerts` | `alert.create` | Buat. Body: `category`, `level`, `title`, `body`, `instruction?`, `regionIds[]` **atau** `area` (GeoJSON MultiPolygon), `deliveryMode` (`REGION_TOPIC`/`GEOFENCE`), `startsAt?`, `expiresAt?`, `publish?` |
| PATCH | `/admin/alerts/{id}` | `alert.create` | Ubah `DRAFT` (alert `ACTIVE` hanya boleh mengubah teks, dicatat sebagai revisi) |
| POST | `/admin/alerts/{id}/publish` | `alert.create` | `DRAFT → ACTIVE`, memicu pengiriman ke topic atau geofence |
| POST | `/admin/alerts/{id}/close` | `alert.close` | `ACTIVE → CLOSED`, memicu notifikasi pembaruan |
| GET | `/condition-reports` | `condition_report.read` | Peta laporan kondisi: `bbox`, `since`, `typeCode`. Keluaran ringkas untuk peta |

Teks `level` dan `category` bebas dalam batas daftar yang dikonfigurasi (`system_settings.alert_levels`), mengikuti istilah BPBD. 🔶

### 5.10 Notifikasi in-app

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/notifications` | auth | Riwayat sendiri. Filter `unreadOnly`, `kind` |
| GET | `/notifications/unread-count` | auth | Jumlah belum dibaca |
| POST | `/notifications/{id}/seen` | auth | Tandai dibaca |
| POST | `/notifications/seen-all` | auth | Tandai semua |
| POST | `/notifications/{id}/delivered` | auth | Ack terima (dipanggil klien saat push diterima, dipakai `notification_deliveries` untuk memutus retry dan eskalasi) |

### 5.11 Shift dispatcher dan dashboard

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| POST | `/shifts/start` | `shift.manage` | Mulai shift |
| POST | `/shifts/end` | `shift.manage` | Akhiri shift. Body: `handoverNote?`, `handedOverTo?`. Melepas seluruh kunci milik pengguna |
| GET | `/shifts/current` | `shift.manage` | Shift aktif |
| GET | `/shifts/handover` | `shift.manage` | Ringkasan untuk operator berikutnya: incident belum selesai, dispatch aktif, resource request menunggu, catatan shift sebelumnya |
| GET | `/dashboard/summary` | `dashboard.read` | Hitungan: incident per status, dispatch aktif, offer menunggu, unit tersedia, rata-rata waktu respons |

Peta dashboard (incident dan unit di peta) ditunda ke fase 3.

### 5.12 Administrasi organisasi, staf, role

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/organizations` | `org.manage_all` atau auth (daftar ringkas) | Filter `type`. Responder/dispatcher mendapat daftar ringkas untuk memilih RS tujuan |
| POST | `/organizations` | `org.manage_all` | Buat organisasi |
| PATCH | `/organizations/{id}` | `org.manage_all` / `org.manage_own` | Ubah data |
| PUT | `/organizations/{id}/service-areas` | `org.manage_all` | Body: `regionIds[]` |
| GET | `/organizations/{id}/units` | `org.manage_own` | Daftar unit |
| POST | `/organizations/{id}/units` | `org.manage_own` | Buat unit |
| PATCH | `/units/{id}` | `org.manage_own` | Ubah unit |
| GET | `/organizations/{id}/staff` | `staff.manage_own` | Daftar staf |
| POST | `/organizations/{id}/staff` | `staff.manage_own` | Buat akun staf: `fullName`, `phone`, `email?`, `roleCodes[]`, `unitId?`. Kata sandi sementara dikirim lewat kanal aman, `mustChangePassword = true` |
| PATCH | `/staff/{userId}` | `staff.manage_own` | Ubah unit, role (dalam batas yang boleh diberikan Admin Org) |
| POST | `/staff/{userId}/deactivate` | `staff.manage_own` | Nonaktifkan: mencabut seluruh sesi dan token FCM seketika |
| POST | `/staff/{userId}/reset-password` | `staff.manage_own` | Setel ulang |
| GET | `/users` | `staff.manage_all` | Semua pengguna. Filter `userType`, `status`, `q` |
| PATCH | `/users/{id}/status` | `staff.manage_all` | `ACTIVE`/`SUSPENDED`/`DEACTIVATED` |
| GET | `/roles`, `/permissions` | `role.manage` | Daftar |
| PUT | `/roles/{id}/permissions` | `role.manage` | Ganti kumpulan permission |
| PUT | `/users/{id}/roles` | `staff.manage_all` | Ganti role pengguna |
| GET | `/audit-logs` | `audit.read_all` / `audit.read_own_org` | Filter `entityType`, `entityId`, `actorUserId`, `action`, `from`, `to` |
| GET | `/settings` | `settings.manage` | Semua pengaturan |
| PUT | `/settings/{key}` | `settings.manage` | Ubah satu pengaturan (tercatat di audit) |

Pembatas Admin Organisasi: hanya boleh membuat role `RESPONDER` dan `ORG_ADMIN` untuk organisasinya sendiri. Role `DISPATCHER`, `SUPERVISOR`, `SUPER_ADMIN` hanya oleh Super Admin. 🔶

### 5.13 Sinkronisasi (pendukung reconnect)

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/sync/snapshot` | auth | Kondisi terkini sesuai role. Dispatcher: incident aktif (dengan `dispatchSummary` dan `attentionReasons[]`) + dispatch aktif + resource request menunggu. Responder: dispatch aktif milik unit. Warga: laporan aktif. Respons memuat `lastEventId` |
| GET | `/sync/events?afterId=&limit=` | auth | Event yang **boleh dilihat pemanggil** dengan `id > afterId`. Respons: `data[]`, `lastId`, `hasMore`, `resetRequired` |

Cara pakai klien setelah koneksi realtime terputus: panggil `/sync/events?afterId=<lastId>`. Bila `resetRequired = true` (kursor terlalu lama atau event sudah dipangkas), ambil `/sync/snapshot` lalu lanjutkan dari `lastEventId`.

### 5.14 Kesehatan

| Method | Path | Izin | Ringkasan |
|---|---|---|---|
| GET | `/health` | - | Hidup (liveness) |
| GET | `/health/ready` | - | Siap: database, Redis, object storage |

---

## 6. Transisi Status

Transisi di luar tabel ini ditolak dengan `409 INVALID_STATUS_TRANSITION`. Status hanya boleh **maju**. Pengecualian koreksi (mundur) hanya oleh supervisor dengan alasan, tercatat di audit. 🔶

### 6.1 Incident

| Dari | Ke | Pemicu | Oleh |
|---|---|---|---|
| (baru) | `SUBMITTED` | Laporan/input manual | Sistem |
| `SUBMITTED` | `VERIFIED` | `verify` | Dispatcher |
| `SUBMITTED`, `VERIFIED` | `INVALID` | `invalidate` | Dispatcher |
| `SUBMITTED`, `VERIFIED` | `DUPLICATE` | `merge` | Dispatcher |
| `VERIFIED` | `IN_PROGRESS` | Dispatch pertama `ACCEPTED`/`EN_ROUTE` | **Otomatis** |
| `VERIFIED`, `IN_PROGRESS` | `RESOLVED` | `resolve` | Dispatcher |
| `RESOLVED` | `CLOSED` | `close`, atau otomatis setelah N jam | Dispatcher/sistem |

### 6.2 Dispatch tipe RESPOND

| Dari | Ke | Oleh |
|---|---|---|
| `OFFERED` | `ACCEPTED` | Responder (atau dispatcher atas nama) |
| `OFFERED` | `REJECTED` | Responder |
| `OFFERED` | `EXPIRED` | Sistem (timer) |
| `OFFERED`, `ACCEPTED`, `EN_ROUTE` | `CANCELLED` | Dispatcher |
| `ACCEPTED` | `EN_ROUTE` | Responder / dispatcher atas nama |
| `EN_ROUTE` | `ON_SCENE` | Responder / dispatcher atas nama |
| `ON_SCENE`, `EN_ROUTE` | `DONE` | Responder / dispatcher atas nama |
| (tidak ada) | `EN_ROUTE` | `self-initiate` atau `on-behalf` |

- **Melompati tahap ke depan diperbolehkan** (mis. `ACCEPTED → ON_SCENE`, karena petugas sering lupa menekan "berangkat"). Waktu tahap yang dilompati dibiarkan kosong. 🔶
- `DONE` dari `EN_ROUTE` dipakai untuk kasus "tidak ditemukan di lokasi", dengan `outcomeCode = NOT_FOUND`.
- `outcomeCode` awal: `COMPLETED`, `NOT_FOUND`, `HANDED_OVER`, `PATIENT_TRANSPORTED`, `FALSE_ALARM`.

### 6.3 Dispatch tipe NOTIFY (IGD)

| Dari | Ke | Oleh |
|---|---|---|
| `NOTIFIED` | `READY` / `FULL` | Responder IGD |
| `READY` | `PATIENT_ARRIVED` | Responder IGD |
| `PATIENT_ARRIVED` | `DONE` | Responder IGD |
| `NOTIFIED`, `READY`, `FULL` | `CANCELLED` | Dispatcher / sistem |

Bila IGD menjawab `FULL`, dispatcher/ambulans memilih RS lain lewat `/dispatches/{id}/destination`, yang membuat NOTIFY baru dan membatalkan yang lama.

---

## 7. Katalog Error

| HTTP | `code` | Arti |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Isi permintaan tidak valid (`details[]` per field) |
| 401 | `UNAUTHENTICATED` | Token tidak ada/kedaluwarsa |
| 401 | `REFRESH_TOKEN_REUSED` | Refresh token dipakai ulang, sesi dicabut |
| 401 | `OTP_INVALID` / `OTP_EXPIRED` | OTP salah/kedaluwarsa |
| 401 | `TWO_FACTOR_REQUIRED` | Perlu kode TOTP |
| 403 | `FORBIDDEN` | Tidak punya permission |
| 403 | `NOT_LEAD_ORGANIZATION` | Aksi khusus organisasi pemegang komando |
| 403 | `ACCOUNT_DEACTIVATED` | Akun nonaktif/ditangguhkan |
| 404 | `NOT_FOUND` | Resource tidak ada **atau tidak boleh dilihat pemanggil** (tidak dibedakan, agar tidak membocorkan keberadaan) |
| 409 | `VERSION_CONFLICT` | `version` tidak cocok (`currentVersion` disertakan) |
| 409 | `INCIDENT_LOCKED` | Dikunci pengguna lain (`lockedBy`, `lockedAt`) |
| 409 | `LOCK_REQUIRED` | Aksi butuh kunci, belum dipegang |
| 409 | `INVALID_STATUS_TRANSITION` | Transisi tidak diizinkan |
| 409 | `INCIDENT_NOT_DISPATCHABLE` | Incident belum `VERIFIED` atau sudah selesai |
| 409 | `ACTIVE_DISPATCHES_EXIST` | Masih ada dispatch aktif saat `resolve` |
| 409 | `UNIT_NOT_AVAILABLE` | Unit tidak tersedia |
| 409 | `OFFER_NO_LONGER_AVAILABLE` | Offer sudah kedaluwarsa/dibatalkan |
| 409 | `DISPATCH_ALREADY_ACCEPTED` | Sudah diterima unit lain |
| 409 | `RESOURCE_REQUEST_ALREADY_DECIDED` | Sudah diputuskan |
| 410 | `ATTACHMENT_EXPIRED` | Unggahan kedaluwarsa |
| 422 | `REPORT_KIND_NOT_ALLOWED` | Jenis kejadian tidak menerima laporan kondisi |
| 422 | `IDEMPOTENCY_CONFLICT` | `Idempotency-Key` sama, isi berbeda |
| 422 | `ATTACHMENT_INVALID` | Tipe/ukuran berkas tidak sesuai |
| 422 | `OCCURRED_AT_OUT_OF_RANGE` | Waktu kejadian di luar batas |
| 429 | `RATE_LIMITED` | Terlalu sering (`Retry-After` disertakan) |
| 429 | `OTP_TOO_MANY_ATTEMPTS` | Percobaan OTP melebihi batas |
| 503 | `SERVICE_UNAVAILABLE` | Dependensi bermasalah |

Aturan 404 vs 403: bila pengguna **tahu** resource itu ada tetapi tidak berhak aksinya → 403. Bila resource tidak boleh diketahui keberadaannya (mis. incident milik orang lain bagi warga) → 404.

---

## 8. Pembatasan Laju (rate limit)

Penghitung di Redis. Respons 429 memuat `Retry-After`. Angka di bawah adalah titik awal untuk disetel setelah pilot. 🔶

| Cakupan | Batas |
|---|---|
| `POST /auth/otp/request` | 3 per nomor per 10 menit, 10 per IP per jam |
| Verifikasi OTP | 5 percobaan per OTP |
| Login staf | 5 gagal per akun per 15 menit |
| `POST /reports` (HELP_REQUEST) | 3 per pengguna per 10 menit, 10 per hari. Pengguna dengan skor reputasi rendah dibatasi lebih ketat |
| `POST /reports` (CONDITION_REPORT) | 10 per pengguna per 10 menit |
| Unggahan lampiran | 20 per pengguna per jam |
| Endpoint staf (umum) | 300 per menit per pengguna |
| Endpoint publik | 60 per menit per IP |

Idempotensi `clientReportId` tidak dihitung ke batas (pengiriman ulang dari antrean offline tidak boleh terblokir).

---

## 9. Aksi yang Wajib Masuk Audit Log

`pii.view_reporter` (buka kontak pelapor), `incident.lock_override`, `incident.set_lead`, `incident.invalidate`, `incident.merge`, `dispatch.record_on_behalf`, `dispatch.cancel`, `dispatch.ignore_availability`, `alert.publish`, `alert.close`, `staff.create`, `staff.deactivate`, `staff.reset_password`, `user.role_change`, `role.permissions_change`, `settings.change`, `auth.refresh_reuse_detected`, `status.backward_correction`.

---

## 10. Skenario Uji dari Business Flow

Dipakai agent code sebagai kriteria penerimaan (test end-to-end).

**S1. Kecelakaan, satu stakeholder utama**
1. Warga `POST /reports` (HELP_REQUEST) → 201, incident `SUBMITTED`, `publicStatus = RECEIVED`.
2. Dispatcher `GET /incidents` melihatnya, `POST /incidents/{id}/lock`.
3. `POST /verify` (severity `HIGH`) → lead otomatis `POLICE`.
4. `POST /dispatches/batch` ke ambulans dan polisi → keduanya `OFFERED`.
5. Responder ambulans `GET /dispatches/{id}` → `OfferView` **tanpa** lokasi presisi.
6. `POST /dispatches/{id}/accept` → respons memuat `UnitView` dengan lokasi presisi. Incident menjadi `IN_PROGRESS`.
7. Responder polisi `POST /milestones` (`SCENE_RELEASED`) → diterima. Responder ambulans memanggil endpoint yang sama → `403 NOT_LEAD_ORGANIZATION`.
8. Ambulans `POST /dispatches/{id}/destination` → dispatch NOTIFY ke IGD terbentuk, IGD menjawab `READY`.
9. Semua dispatch `DONE` → dispatcher `resolve` → `close`.

**S2. Offer ditolak dan kedaluwarsa**
- Responder `reject` → `REJECTED`, dispatcher menerima notifikasi. Dispatcher membuat dispatch baru ke unit lain.
- Offer tidak dijawab → job timer mengubah ke `EXPIRED`. `accept` setelahnya → `409 OFFER_NO_LONGER_AVAILABLE`.

**S3. Kebakaran, damkar berangkat duluan**
- Dispatcher menerima telepon, `POST /incidents/{id}/dispatches/on-behalf` (`channel = PHONE`, `initialStatus = EN_ROUTE`, `occurredAt` lebih awal dari saat dicatat) → riwayat memuat `occurred_at` ≠ `recorded_at`.
- Atau responder `POST /incidents/{id}/self-initiate` → dispatch langsung `EN_ROUTE`, dispatcher dinotifikasi.
- Damkar (lead) mengajukan `resource-requests` → dispatcher `approve` → dispatch `origin = REQUESTED` terbentuk.
- Damkar mencatat milestone `EXTERNAL_UNIT_ARRIVED` untuk pemadam swasta.

**S4. Banjir, laporan massal**
- Warga mengirim 20 laporan: 10 `CONDITION_REPORT` (tidak muncul di antrean, muncul di `/condition-reports`) dan 10 `HELP_REQUEST` (muncul di antrean).
- Dispatcher memakai `/nearby` lalu `merge` untuk duplikat.
- Admin BPBD `POST /admin/alerts` (publish) → warga di wilayah terdampak menerima alert, `GET /alerts` menampilkannya.

**S5. Laporan offline dan idempotensi**
- Klien mengirim `POST /reports` dengan `clientReportId` yang sama tiga kali → respons pertama 201, sisanya 200, hanya satu incident terbentuk.

**S6. Konkurensi**
- Dispatcher A dan B menekan `lock` bersamaan → satu berhasil, satu `409 INCIDENT_LOCKED`.
- Dua responder dari satu organisasi menekan `accept` bersamaan → satu berhasil, satu `409 DISPATCH_ALREADY_ACCEPTED`.
- Dua dispatcher mengubah `severity` dengan `version` sama → satu `409 VERSION_CONFLICT`.

**S7. Privasi**
- Responder sebelum accept memanggil `GET /incidents/{id}` → tidak ada `location`, `addressText`, lampiran, atau pelapor.
- Dispatcher memanggil `reveal-contact` → baris `pii.view_reporter` muncul di audit.
- Warga membuka laporan milik warga lain → `404 NOT_FOUND`.
- Akun responder dinonaktifkan → token akses berikutnya ditolak, token FCM dicabut.

**S8. Reconnect**
- Klien terputus, kembali lagi → `GET /sync/events?afterId=...` mengembalikan hanya event yang boleh dilihat. Dengan `afterId` terlalu lama → `resetRequired = true`, lalu `/sync/snapshot`.

---

## 11. Hal yang Perlu Ditinjau 🔶

1. **Lokasi di luar wilayah**: diterima dengan flag, bukan ditolak. Setuju?
2. **Masa berlaku refresh token** (30 hari warga, 12 jam staf) dan masa kunci incident (5 menit dengan heartbeat).
3. **Mundur status** hanya oleh supervisor dengan alasan, dan **boleh melompati tahap ke depan** untuk dispatch.
4. **Responder melihat kontak pelapor** langsung atau selalu lewat dispatcher. Draf ini: selalu lewat dispatcher.
5. **`ignoreAvailability`** pada dispatch (memaksa unit yang tidak `AVAILABLE`), tercatat di audit.
6. **Siapa yang boleh membuat alert**: BPBD sendiri (ORG_ADMIN), dispatcher, atau keduanya.
7. **Batas Admin Organisasi** dalam membuat akun (hanya `RESPONDER` dan `ORG_ADMIN`).
8. **Batas rate limit** dan batas lampiran (angka awal).
9. **Peta dashboard** ditunda ke fase 3, hanya `summary` di fase 1.
10. **Endpoint ekspor/ringkasan incident** (untuk laporan akhir dan Jasa Raharja di masa depan) belum dimasukkan.
11. **Staf menemukan incident untuk `self-initiate`** (hasil penyusunan arsitektur Flutter): staf belum dapat melihat incident sebelum ada dispatch. Usulan `GET /incidents/by-code/{code}` (izin `dispatch.self_initiate`, keluaran setara `OfferView`, tanpa lokasi presisi). Untuk sampel diganti "Terima dan berangkat" dari offer.
12. **Cookie HttpOnly untuk refresh token klien web** (hasil penyusunan dashboard): opsi `transport=cookie` pada login staf agar refresh token tidak dapat dibaca skrip. Sampel memakai `sessionStorage`.
13. **Membuat incident dari laporan kondisi** (`POST /incidents/{id}/from-condition-report/{reportId}` atau setara) untuk banjir: laporan kondisi yang ternyata butuh bantuan.
14. **Estimasi jumlah penerima alert** sebelum diterbitkan (`GET /admin/alerts/recipient-estimate`).

---

## 12. Di Luar Cakupan Dokumen Ini

- Event WebSocket (namespace, room, payload, ack) dan siklus langganan.
- Payload FCM (topic, high priority, deep link, channel Android).
- Konversi ke OpenAPI YAML (dilakukan setelah dokumen ini disetujui).
- Dokumen serah terima untuk agent code (konvensi kode, urutan pembangunan, kriteria selesai per modul).
