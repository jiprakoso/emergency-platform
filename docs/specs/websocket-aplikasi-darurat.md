# Spesifikasi WebSocket v1: Aplikasi Informasi Bencana & Kejadian Darurat

> Status: draft v1 (spesifikasi, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `erd-aplikasi-darurat.md` (v1.1), `rest-api-aplikasi-darurat.md`
> Cakupan: kanal realtime (Socket.IO). Payload FCM dibahas di dokumen terpisah.
> Fokus dokumen ini: cukup rinci untuk membangun **aplikasi sampel** yang berjalan. Hal yang masih menunggu keputusan client diberi asumsi default (lihat bagian 12).

---

## 1. Prinsip

1. **REST adalah satu-satunya jalur tulis.** WebSocket hanya mengantar kejadian dari server ke klien. Semua aksi yang mengubah data (accept, verify, buat dispatch, dll.) tetap lewat REST agar validasi, permission, audit, dan idempotensi hanya ada satu tempat.
   Pengecualian kecil, dari klien ke server: `ack`, `auth.refresh`, `app.state`, `unit.location`.
2. **Keadaan yang benar ada di REST/database, bukan di WebSocket.** Event adalah pemberitahuan. Bila klien meragukan datanya, ia mengambil ulang lewat REST (`/sync/events`, `/sync/snapshot`, atau resource terkait).
3. **At-least-once, bukan exactly-once.** Event bisa terkirim ganda. Klien wajib membuang duplikat berdasarkan `eid`.
4. **Jangan emit sebelum commit.** Event dikirim setelah transaksi database berhasil (lihat bagian 9). Klien tidak boleh pernah menerima event tentang data yang akhirnya batal.
5. **Server yang mengatur room.** Klien tidak bisa join room sembarang. Keanggotaan room ditentukan dari identitas (role, organisasi, unit) dan relasi ke incident.
6. **Event dibentuk per audiens.** Satu kejadian domain bisa menghasilkan payload berbeda untuk dispatcher, unit, dan warga. Aturan visibilitas sama dengan bagian 4 dokumen REST (tidak ada lokasi presisi untuk responder yang belum accept, tidak ada data pelapor ke luar dispatcher).
7. **WebSocket bukan jaminan sampai.** Untuk kejadian kritis (offer dispatch), jalur FCM berjalan bersamaan dan ada ack serta eskalasi.

---

## 2. Transport dan Koneksi

| Item | Keputusan |
|---|---|
| Pustaka | Socket.IO v4 (NestJS `@WebSocketGateway`) dengan adapter Redis (`@socket.io/redis-adapter`) |
| Namespace | Satu: `/realtime` |
| Path | `/socket.io` |
| Transport | `websocket` lebih dulu, fallback `polling` bila gagal (jaringan lapangan sering buruk). Fallback polling di multi-instance membutuhkan sticky session 🔶 |
| Skema | `wss://` wajib |
| Heartbeat | Bawaan Socket.IO: `pingInterval 25 s`, `pingTimeout 20 s` |
| Reconnect (klien) | Backoff eksponensial 1 s → maksimum 10 s dengan jitter, tanpa batas percobaan |
| Batas payload | 64 KB per pesan |
| Batas koneksi | Maksimal 3 koneksi aktif per pengguna (mis. beberapa tab web admin). Koneksi tertua ditutup dengan alasan `too_many_connections` 🔶 |

### 2.1 Autentikasi saat handshake

```js
io("wss://api.example.com/realtime", {
  auth: { token: "<accessToken>", appFlavor: "STAFF", appVersion: "1.0.0", deviceId: "<deviceTokenId>" },  // appFlavor: CITIZEN | STAFF | ADMIN_WEB
  transports: ["websocket", "polling"]
});
```

- Token dikirim lewat `auth`, **bukan query string** (tidak masuk log URL).
- Server memverifikasi JWT, memeriksa sesi (`sid`) belum dicabut, dan akun masih aktif. Gagal → koneksi ditolak dengan error `UNAUTHENTICATED`.
- Berhasil → server memasukkan socket ke room sesuai identitas (bagian 3), lalu mengirim `connection.ready`.

### 2.2 Token kedaluwarsa

Access token berumur 15 menit, sedangkan koneksi bisa berhari-hari.

| Langkah | Arah | Event |
|---|---|---|
| 1. ±60 detik sebelum `exp` | server → klien | `auth.expiring` `{ expiresInSeconds }` |
| 2. Klien memperbarui token lewat REST `/auth/refresh` | | |
| 3. Klien mengirim token baru | klien → server | `auth.refresh` `{ accessToken }` (ack: `{ ok: true }`) |
| 4. Bila tidak diperbarui sampai `exp` | server → klien | `auth.expired`, lalu server memutus koneksi |

Sesi yang dicabut (logout, akun dinonaktifkan, refresh token dipakai ulang): server mengirim `session.revoked` `{ reason }` lalu memutus koneksi seketika.

---

## 3. Room

Klien tidak mengirim permintaan join. Server memasukkan socket ke room secara otomatis.

| Room | Anggota | Dipakai untuk |
|---|---|---|
| `user:{userId}` | Semua koneksi milik pengguna itu | Event personal (offer ke responder tertentu, status laporan warga, notifikasi in-app) |
| `role:dispatcher` | `DISPATCHER`, `SUPERVISOR` | Seluruh event incident dan dispatch, antrean |
| `role:supervisor` | `SUPERVISOR` | Eskalasi (laporan tak tertangani, offer tak dilihat) |
| `org:{orgId}` | Staf organisasi itu | Offer yang ditujukan ke organisasi, pembatalan, status unit |
| `unit:{unitId}` | Responder yang terikat ke unit | Offer yang ditujukan ke unit tertentu |
| `incident:{incidentId}` | Responder yang punya dispatch `ACCEPTED`+ di incident itu, dan staf organisasi **lead** | Pembaruan incident untuk unit di lapangan |
| `region:{districtId}` | Warga yang `home_region_id`-nya berada di kecamatan itu, dan staf BPBD | Alert wilayah |

Aturan keanggotaan dinamis `incident:{id}`:
- **Masuk:** saat dispatch menjadi `ACCEPTED` (atau langsung `EN_ROUTE` pada `SELF_INITIATED`/`on-behalf`) dan saat organisasi ditetapkan sebagai lead. Server memanggil `socketsJoin` untuk socket yang relevan, termasuk socket baru yang terhubung kemudian.
- **Keluar:** saat dispatch `DONE`/`CANCELLED`, atau incident `CLOSED`. Diberi tenggang 10 menit agar unit masih menerima kabar penutupan. 🔶
- Responder dengan offer `OFFERED` belum masuk room incident (belum berhak melihat detail). Offer dikirim lewat `user:`, `unit:`, atau `org:`.

Satu pengguna bisa berada di beberapa room sekaligus. Server membentuk **satu payload per jenis audiens** dan mengirimnya ke room yang sesuai.

---

## 4. Amplop Event

Nama event Socket.IO = nilai `type` (mis. `dispatch.offered`). Semua event server → klien memakai amplop yang sama:

```json
{
  "eid": "0192f3a0-7b1e-7c00-9e55-1c2d3e4f5a6b",
  "id": "48213",
  "type": "dispatch.offered",
  "v": 1,
  "ts": "2026-10-05T03:15:02.114Z",
  "incidentId": "...",
  "dispatchId": "...",
  "resourceVersion": 3,
  "class": "CRITICAL",
  "ackRequired": true,
  "data": { }
}
```

| Field | Arti |
|---|---|
| `eid` | UUID unik per **pengiriman logis**. Dipakai klien untuk membuang duplikat (termasuk duplikat dari jalur FCM) |
| `id` | Id `incident_events` (string angka) untuk event yang disimpan. `null` untuk event sementara (mis. `unit.location_updated`). Dipakai sebagai kursor `/sync/events` |
| `type` | Nama event |
| `v` | Versi skema payload (naik bila format `data` berubah tidak kompatibel) |
| `ts` | Waktu server |
| `incidentId`, `dispatchId` | Rujukan, bila ada |
| `resourceVersion` | `version` resource utama setelah perubahan (incident atau dispatch). Dipakai deteksi celah |
| `class` | Kelas pengiriman: `CRITICAL`, `STANDARD`, `INFO` (bagian 7) |
| `ackRequired` | Bila true, klien wajib mengirim `ack` |
| `data` | Isi spesifik event |

### 4.1 Aturan klien

1. **Buang duplikat:** simpan `eid` yang sudah diproses (cukup 500 terakhir).
2. **Deteksi celah:** untuk event bertanda `resourceVersion`, bila versi lokal + 1 ≠ `resourceVersion`, ambil ulang resource lewat REST.
3. **Simpan kursor:** untuk event ber-`id`, simpan `lastEventId` terbesar yang sudah diproses.
4. **Event hanyalah petunjuk.** Bila data di event kurang untuk layar yang dibuka, ambil ulang lewat REST.

---

## 5. Katalog Event: Server → Klien

Kolom "Audiens" menyebut room tujuan. `Kelas`: C = CRITICAL, S = STANDARD, I = INFO. Payload disingkat ke field penting. `IncidentSummary`, `DispatchSummary`, dan `OfferView` mengikuti bentuk di dokumen REST.

### 5.1 Sistem dan sesi

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `connection.ready` | koneksi itu | I | `serverTime`, `userId`, `rooms[]` (ringkas), `minAppVersion`, `resyncRecommended: true` |
| `auth.expiring` | koneksi itu | I | `expiresInSeconds` |
| `auth.expired` | koneksi itu | I | - |
| `session.revoked` | koneksi itu | I | `reason`: `LOGOUT`, `ACCOUNT_DEACTIVATED`, `REFRESH_REUSE`, `ADMIN_REVOKED` |
| `system.notice` | semua / per role | I | `level`, `message` (mis. pemeliharaan terjadwal) |

### 5.2 Incident (dispatcher dan unit)

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `incident.created` | `role:dispatcher` | S | `incident: IncidentSummary`, `suggestedIncidentId?`, `flags[]` |
| `incident.report_added` | `role:dispatcher` | S | `reportId`, `kind` (`FOLLOW_UP`, dll.), `incident: IncidentSummary` |
| `incident.updated` | `role:dispatcher`; `incident:{id}` (hanya field aman) | S | `changes` (`severity`, `escalationLevel`, `summary`, ...) |
| `incident.location_updated` | `incident:{id}` | S | `location`, `addressText` (dispatcher mengoreksi lokasi; hanya anggota yang sudah berhak) |
| `incident.status_changed` | `role:dispatcher`; `incident:{id}` | S | `from`, `to`, `incident: IncidentSummary` |
| `incident.locked` / `incident.unlocked` | `role:dispatcher` | S | `lockedBy { id, name }`, `lockExpiresAt` |
| `incident.lock_overridden` | `role:dispatcher` | S | `previousHolder`, `newHolder`, `reason` |
| `incident.merged` | `role:dispatcher` | S | `sourceId`, `targetId` |
| `incident.lead_changed` | `role:dispatcher`; `incident:{id}`; `org:{newLead}`, `org:{oldLead}` | S | `leadOrganization { id, name }` |
| `incident.casualties_updated` | `role:dispatcher`; `incident:{id}` | S | `injured`, `deceased`, `critical?`, `missing?`, `reportedAt` |
| `incident.milestone_recorded` | `role:dispatcher`; `incident:{id}` | S | `code`, `note?`, `payload?`, `occurredAt` |
| `incident.note_added` | `role:dispatcher` (atau sesuai `visibility`) | I | `noteId`, `visibility` |

### 5.3 Dispatch

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `dispatch.offered` | `unit:{id}` bila ada unit, selain itu `org:{id}`; juga `user:{id}` responder yang dituju | **C** (`ackRequired`) | `offer: OfferView`, `offerExpiresAt` |
| `dispatch.notified` | `org:{id}` (IGD) | **C** (`ackRequired`) | Ringkas medis: `incidentType`, `casualties`, `etaMinutes`, `sourceDispatchId` |
| `dispatch.created` | `role:dispatcher` | S | `dispatch: DispatchSummary` |
| `dispatch.accepted` | `role:dispatcher`; `org:{id}` (agar staf lain menutup tampilan offer) | S | `dispatchId`, `acceptedBy { id, name }`, `unit`, `etaMinutes?` |
| `dispatch.rejected` | `role:dispatcher`; `role:supervisor` | **C** | `dispatchId`, `organization`, `reason` (dispatcher harus memilih pengganti) |
| `dispatch.expired` | `role:dispatcher`; `role:supervisor`; `org:{id}` | **C** | `dispatchId`, `organization` |
| `dispatch.cancelled` | `unit:{id}` / `org:{id}`; `role:dispatcher`; `incident:{id}` | S | `dispatchId`, `reason` |
| `dispatch.self_initiated` | `role:dispatcher` | **C** | `dispatch: DispatchSummary`, `channel` |
| `dispatch.status_changed` | `role:dispatcher`; `incident:{id}` (ringkasan) | S | `dispatchId`, `from`, `to`, `occurredAt`, `recordedBy`, `channel` |
| `dispatch.offer_unseen` | `role:dispatcher`; `role:supervisor` | **C** | `dispatchId`, `organization`, `secondsSinceOffer` (offer belum dilihat sampai batas) |

### 5.4 Resource request

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `resource_request.created` | `role:dispatcher` | **C** (`ackRequired`) | `requestId`, `incident: IncidentSummary`, `resourceType`, `quantity`, `urgency`, `reason` |
| `resource_request.decided` | `user:{requester}`; `org:{leadOrg}` | S | `requestId`, `status` (`APPROVED`/`REJECTED`), `note?` |

### 5.5 Warga (laporan)

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `report.status_changed` | `user:{reporterId}` (semua pelapor tertaut) | S | `reportId`, `publicStatus`, `message` |
| `report.timeline_updated` | `user:{reporterId}` | I | `reportId`, `entry { ts, text }` (hanya `visibility = PUBLIC`) |

Saat incident digabung (`merged`), seluruh pelapor di incident sumber menerima `report.status_changed` yang menunjukkan status incident induk.

### 5.6 Alert dan notifikasi

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `alert.published` | `region:{districtId}` untuk tiap kecamatan terdampak; `user:{id}` untuk hasil geofence | C bila level tertinggi, selain itu S | `alert` (bentuk sama dengan daftar `/alerts`) |
| `alert.updated` | sama | S | `alertId`, `changes` |
| `alert.closed` | sama | I | `alertId` |
| `notification.created` | `user:{id}` | I | `notificationId`, `kind`, `title`, `unreadCount` |

### 5.7 Unit

| Event | Audiens | Kelas | `data` |
|---|---|---|---|
| `unit.status_changed` | `role:dispatcher`; `org:{id}` | I | `unitId`, `status` |
| `unit.location_updated` | `role:dispatcher` | I (sementara, `id = null`) | `unitId`, `location`, `recordedAt`. **Fase 3** (peta live). Di fase 1 hanya `last_location` yang diperbarui tanpa siaran |

---

## 6. Event Klien → Server

| Event | Pengirim | Isi | Respons (ack) |
|---|---|---|---|
| `ack` | semua | `{ eid, state: "DELIVERED" \| "SEEN", at? }` | `{ ok: true }` |
| `auth.refresh` | semua | `{ accessToken }` | `{ ok: true }` atau `{ ok: false, code }` |
| `app.state` | semua | `{ state: "FOREGROUND" \| "BACKGROUND" }` | - |
| `unit.location` | responder | `{ lat, lng, accuracyM, recordedAt, heading?, speedMps? }` | `{ ok: true }` |

Aturan:
- **`ack`** memperbarui `notification_deliveries` (`DELIVERED`) dan, untuk `dispatch.offered` dengan state `SEEN`, mengisi `dispatches.offer_seen_at`. Ini membatalkan pengiriman ulang dan eskalasi. Padanannya di REST: `POST /notifications/{id}/delivered` dan `POST /dispatches/{id}/seen` (dipakai bila socket tidak tersedia).
- **`app.state`** memberi tahu server apakah aplikasi sedang aktif, untuk keputusan pengiriman FCM (bagian 7). Status disimpan di Redis dengan TTL, dan hilang otomatis saat koneksi terputus.
- **`unit.location`** hanya dari akun dengan `unit.update_own`. Batas 1 kiriman per 5 detik per koneksi (kelebihan dibuang tanpa error). Fase 1: memperbarui `units.last_location`. Fase 3: ditambah ke tabel log lokasi dan disiarkan ke dispatcher.
- Semua event klien → server divalidasi (DTO), dibatasi lajunya, dan **tidak pernah mengubah data domain**.

---

## 7. Kebijakan Pengiriman (WebSocket + FCM)

Tiap event punya kelas pengiriman. Detail payload dan konfigurasi FCM ada di dokumen berikutnya, di sini hanya aturan kapan FCM ikut.

| Kelas | Contoh | Aturan |
|---|---|---|
| **CRITICAL** | `dispatch.offered`, `dispatch.notified`, `resource_request.created`, `dispatch.rejected`, `dispatch.expired`, `dispatch.self_initiated`, `dispatch.offer_unseen`, alert level tertinggi | WebSocket **dan FCM dikirim bersamaan** sejak awal (prioritas tinggi). Klien membuang duplikat dengan `eid`. Wajib `ack` untuk yang `ackRequired` |
| **STANDARD** | `incident.*`, `dispatch.status_changed`, `report.status_changed`, alert biasa | WebSocket bila pengguna terhubung. Bila tidak ada koneksi, atau tidak ada `ack` dalam 15 detik, FCM dikirim |
| **INFO** | `incident.note_added`, `notification.created`, `unit.status_changed`, `alert.closed` | Hanya WebSocket. Tidak ada FCM (informasi akan terlihat saat aplikasi dibuka lewat sinkronisasi) |

FCM hanya dikirim ke perangkat yang terdaftar (`device_tokens`). Web admin dispatcher memakai WebSocket dan alarm di dalam halaman web. Web push untuk dispatcher ditunda ke fase 2. Detail pesan, channel, dan siklus token ada di `fcm-aplikasi-darurat.md`.

### 7.1 Eskalasi offer dispatch (contoh ritme, nilai bisa diubah di `system_settings`)

```
t = 0 s     Dispatcher membuat dispatch → status OFFERED
            ├─ WebSocket: dispatch.offered ke unit/org
            └─ FCM (prioritas tinggi) ke semua perangkat responder terkait

t = 20 s    Belum ada ack DELIVERED → kirim ulang FCM sekali

t = 60 s    Belum ada ack SEEN → kirim dispatch.offer_unseen
            ke dispatcher dan supervisor ("hubungi lewat telepon")

t = 120 s   Batas offer habis → dispatch EXPIRED
            └─ dispatch.expired ke dispatcher, supervisor, dan org
               (tampilan offer di app responder ditutup)
```

**Catatan FCM:** notifikasi yang ditampilkan sistem Android saat aplikasi mati tidak menjalankan kode aplikasi, sehingga ack `DELIVERED` bisa tidak pernah datang. Karena itu eskalasi bertumpu pada `SEEN` (petugas membuka penugasan). Kirim ulang FCM pada t=20 s dilakukan **sekali**, dengan `tag` yang sama agar menggantikan notifikasi lama dan tidak menumpuk.

Pewaktu dijalankan job terjadwal (BullMQ) berdasarkan `dispatches.offer_expires_at` dan `notification_deliveries`, bukan di memori proses, sehingga tetap berjalan bila server restart.

### 7.2 Peran `app.state`

- Pengguna `FOREGROUND` dan terhubung: event STANDARD cukup lewat WebSocket.
- Pengguna `BACKGROUND` atau tidak terhubung: event STANDARD dikirim lewat FCM tanpa menunggu 15 detik.
- Event CRITICAL tidak bergantung pada `app.state`, selalu dua jalur.

---

## 8. Reconnect dan Sinkronisasi

Prinsip: **satu mekanisme pemulihan**, yaitu REST `/sync/events` dan `/sync/snapshot`. WebSocket tidak mengulang event yang terlewat.

```
Klien terputus ──► Socket.IO menyambung ulang otomatis (backoff)
                         │
                         ▼
              Handshake dengan token (perbarui lewat /auth/refresh bila sudah kedaluwarsa)
                         │
                         ▼
                server mengirim  connection.ready
                         │
                         ▼
        klien: GET /sync/events?afterId=<lastEventId>
                         │
          ┌──────────────┴───────────────┐
   resetRequired = false          resetRequired = true
   terapkan event berurutan       GET /sync/snapshot, ganti state lokal,
   lalu lanjut dari lastId        lanjut dari lastEventId snapshot
```

Aturan:
- **Selalu** panggil `/sync/events` setelah `connection.ready` (murah, hasil kosong bila tidak ada yang terlewat). Id event global tidak berurutan untuk satu pengguna karena sebagian event tidak boleh dilihatnya, sehingga celah tidak dapat dideteksi hanya dari angka `id`.
- Saat terhubung normal, celah dideteksi lewat `resourceVersion` (bagian 4.1).
- **Aplikasi dibuka dari notifikasi FCM** (proses sebelumnya mati): jalankan sinkronisasi yang sama, lalu buka layar sesuai deep link.
- Kursor `lastEventId` disimpan di penyimpanan lokal perangkat.
- Klien menjaga satu antrean pemrosesan agar event WebSocket yang tiba selama sinkronisasi berlangsung diurutkan berdasarkan `id` dan tidak diproses ganda.

---

## 9. Catatan Implementasi (untuk agent code)

**Urutan publikasi event (wajib):**

```
Aksi REST ──► transaksi DB: ubah data + tulis incident_events (+ outbox)
          ──► COMMIT
          ──► (setelah commit) RealtimeService menyusun proyeksi per audiens
          ──► emit ke room + antrean FCM
```

Gunakan pola *transactional outbox* (tabel/antrean kecil yang ditulis dalam transaksi yang sama, dibaca worker) atau hook setelah-commit. Tidak boleh emit di tengah transaksi.

**Komponen NestJS (usulan nama):**

| Komponen | Tugas |
|---|---|
| `RealtimeGateway` | Handshake, autentikasi, join room awal, menerima event klien → server |
| `RealtimeService` | `emitToRoom`, `emitToUser`, `joinIncidentRoom`, `leaveIncidentRoom`, pencatatan presence |
| `EventProjector` | Satu fungsi proyeksi per jenis event per audiens (dispatcher, unit, lead, warga). Pusat aturan visibilitas, sama dengan serializer REST |
| `DeliveryPolicyService` | Memutuskan jalur WS/FCM berdasarkan kelas, presence, dan `app.state` |
| `AckService` | Mencatat ack, memutus retry |
| `OfferTimerProcessor` (BullMQ) | Retry FCM, `offer_unseen`, `EXPIRED` |
| `PresenceService` (Redis) | `presence:user:{id}` (kumpulan socket id, TTL), `appstate:user:{id}` |

**Infrastruktur:**
- Adapter Redis agar room dan emit lintas instance. Penskalaan horizontal bukan prioritas awal, tetapi adapter dipasang sejak awal.
- Presence dan pengiriman ulang tidak boleh bergantung pada memori satu proses.
- Event yang punya `id` berasal dari `incident_events` (urutan global). Event sementara tidak disimpan.

**Batas dan perlindungan:**

| Hal | Batas awal |
|---|---|
| `unit.location` | 1 per 5 detik per koneksi |
| `ack` | 20 per detik per koneksi |
| Event klien lain | 10 per detik per koneksi |
| Pelanggaran berulang | Koneksi diputus dengan alasan `rate_limited` |
| CORS | Hanya origin web admin dan stakeholder |

---

## 10. Pemetaan Aksi REST → Event

Dipakai agent code sebagai daftar kerja: setiap aksi REST harus menghasilkan event berikut (setelah commit).

| Aksi REST | Event yang dihasilkan |
|---|---|
| `POST /reports` (HELP_REQUEST) | `incident.created` (dispatcher) |
| `POST /reports` (CONDITION_REPORT) | Tidak ada event realtime (peta kondisi dimuat lewat REST) |
| `POST /reports/{id}/follow-ups` | `incident.report_added` (dispatcher) |
| `POST /incidents` (manual) | `incident.created` |
| `POST /incidents/{id}/lock`, `DELETE .../lock` | `incident.locked`, `incident.unlocked` (`incident.lock_overridden` bila force) |
| `PATCH /incidents/{id}` | `incident.updated`; bila lokasi berubah, `incident.location_updated` ke `incident:{id}` |
| `POST /incidents/{id}/verify` | `incident.status_changed`; `report.status_changed` (pelapor) |
| `POST /incidents/{id}/invalidate` | `incident.status_changed`; `report.status_changed` (pelapor) |
| `POST /incidents/{id}/merge` | `incident.merged`, `incident.status_changed`; `report.status_changed` (pelapor di incident sumber) |
| `PUT /incidents/{id}/lead` | `incident.lead_changed`; server join/leave `incident:{id}` |
| `POST /incidents/{id}/dispatches` (+ `batch`) | `dispatch.created` (dispatcher); `dispatch.offered` / `dispatch.notified` (target) + FCM; `report.status_changed` (pelapor, `UNIT_DISPATCHED`) |
| `POST /incidents/{id}/dispatches/on-behalf` | `dispatch.created`, `dispatch.status_changed`; join `incident:{id}`; `report.status_changed` |
| `POST /incidents/{id}/self-initiate` | `dispatch.self_initiated` (CRITICAL ke dispatcher); join `incident:{id}`; `report.status_changed` |
| `POST /dispatches/{id}/seen` | Tidak ada event; memperbarui `offer_seen_at` dan membatalkan eskalasi |
| `POST /dispatches/{id}/accept` | `dispatch.accepted` (dispatcher, `org:{id}`); join `incident:{id}`; `incident.status_changed` bila ini dispatch pertama (→ `IN_PROGRESS`); `report.status_changed` |
| `POST /dispatches/{id}/reject` | `dispatch.rejected` (CRITICAL ke dispatcher dan supervisor) |
| (job timer) offer habis | `dispatch.expired` (CRITICAL); `dispatch.offer_unseen` pada ambang `SEEN` |
| `POST /dispatches/{id}/status` | `dispatch.status_changed`; `report.status_changed` pada `EN_ROUTE`/`ON_SCENE`; `incident.status_changed` bila pemicu otomatis |
| `POST /dispatches/{id}/destination` | `dispatch.notified` (IGD, CRITICAL) + FCM; `dispatch.created` |
| `POST /dispatches/{id}/cancel` | `dispatch.cancelled` (unit/org + dispatcher + incident); leave `incident:{id}` |
| `POST /incidents/{id}/casualties` | `incident.casualties_updated` |
| `POST /incidents/{id}/milestones` | `incident.milestone_recorded` |
| `POST /incidents/{id}/resource-requests` | `resource_request.created` (CRITICAL ke dispatcher) |
| `POST /resource-requests/{id}/approve` / `reject` | `resource_request.decided`; bila approve: `dispatch.created` + `dispatch.offered` |
| `POST /incidents/{id}/resolve` / `close` | `incident.status_changed`; `report.status_changed`; leave `incident:{id}` (dengan tenggang) |
| `POST /incidents/{id}/notes` | `incident.note_added` |
| `PUT /units/{id}/status` | `unit.status_changed` |
| `POST /admin/alerts/{id}/publish` | `alert.published` ke `region:{districtId}` dan hasil geofence + FCM topic |
| `POST /admin/alerts/{id}/close` | `alert.closed` |
| `PATCH /admin/alerts/{id}` (alert aktif) | `alert.updated` |
| Pembuatan notifikasi personal | `notification.created` |
| `POST /staff/{id}/deactivate`, logout, refresh reuse | `session.revoked`, lalu koneksi diputus |

---

## 11. Contoh Payload

**`connection.ready`**

```json
{
  "eid": "0192f3a0-0001-7000-8000-000000000001",
  "id": null, "type": "connection.ready", "v": 1,
  "ts": "2026-10-05T03:10:00.000Z", "class": "INFO", "ackRequired": false,
  "data": {
    "serverTime": "2026-10-05T03:10:00.000Z",
    "userId": "...",
    "rooms": ["user", "org", "unit"],
    "minAppVersion": "1.0.0",
    "resyncRecommended": true
  }
}
```

**`dispatch.offered`** (ke responder, tanpa lokasi presisi)

```json
{
  "eid": "0192f3a0-7b1e-7c00-9e55-1c2d3e4f5a6b",
  "id": "48213", "type": "dispatch.offered", "v": 1,
  "ts": "2026-10-05T03:15:02.114Z",
  "incidentId": "...", "dispatchId": "...", "resourceVersion": 1,
  "class": "CRITICAL", "ackRequired": true,
  "data": {
    "offerExpiresAt": "2026-10-05T03:17:02Z",
    "offer": {
      "dispatchId": "...",
      "incident": {
        "code": "INC-20261005-000123",
        "type": { "code": "TRAFFIC_ACCIDENT", "name": "Kecelakaan Lalu Lintas" },
        "severity": "HIGH",
        "district": { "name": "Gubeng" }, "village": { "name": "Airlangga" },
        "distanceM": 1800
      },
      "type": "RESPOND", "origin": "DISPATCHER", "status": "OFFERED",
      "note": "Korban lebih dari satu"
    }
  }
}
```

**`incident.created`** (ke dispatcher)

```json
{
  "eid": "...", "id": "48201", "type": "incident.created", "v": 1,
  "ts": "2026-10-05T03:12:40.000Z", "incidentId": "...", "resourceVersion": 1,
  "class": "STANDARD", "ackRequired": false,
  "data": {
    "incident": {
      "id": "...", "code": "INC-20261005-000123", "status": "SUBMITTED",
      "type": { "code": "TRAFFIC_ACCIDENT" },
      "location": { "lat": -7.2655, "lng": 112.7471, "accuracyM": 9.5 },
      "district": { "name": "Gubeng" }, "reportCount": 1, "version": 1
    },
    "suggestedIncidentId": null,
    "flags": []
  }
}
```

**`dispatch.status_changed`** (ke `incident:{id}`, ringkasan untuk unit lain)

```json
{
  "eid": "...", "id": "48230", "type": "dispatch.status_changed", "v": 1,
  "ts": "2026-10-05T03:21:10.000Z", "incidentId": "...", "dispatchId": "...", "resourceVersion": 4,
  "class": "STANDARD", "ackRequired": false,
  "data": {
    "from": "EN_ROUTE", "to": "ON_SCENE",
    "organization": { "name": "Polres Kota" },
    "occurredAt": "2026-10-05T03:20:50Z"
  }
}
```

**`report.status_changed`** (ke warga)

```json
{
  "eid": "...", "id": null, "type": "report.status_changed", "v": 1,
  "ts": "2026-10-05T03:21:11.000Z", "class": "STANDARD", "ackRequired": false,
  "data": {
    "reportId": "...",
    "publicStatus": "UNIT_ON_SCENE",
    "message": "Unit telah tiba di lokasi"
  }
}
```

**`session.revoked`**

```json
{ "eid": "...", "id": null, "type": "session.revoked", "v": 1,
  "ts": "2026-10-05T04:00:00.000Z", "class": "INFO", "ackRequired": false,
  "data": { "reason": "ACCOUNT_DEACTIVATED" } }
```

**`ack`** (klien → server)

```json
{ "eid": "0192f3a0-7b1e-7c00-9e55-1c2d3e4f5a6b", "state": "SEEN", "at": "2026-10-05T03:15:05Z" }
```

---

## 12. Skenario Uji WebSocket

Dipakai sebagai kriteria penerimaan, melengkapi S1-S8 di dokumen REST.

| Kode | Skenario | Hasil yang diharapkan |
|---|---|---|
| W1 | Warga mengirim laporan | Semua dispatcher yang terhubung menerima `incident.created` dalam waktu singkat (target < 1 detik) |
| W2 | Dispatcher membuat dispatch ke ambulans | Responder ambulans (terhubung) menerima `dispatch.offered`; responder yang tidak terhubung menerima FCM; payload **tanpa** lokasi presisi |
| W3 | Responder memberi `ack SEEN`, lalu `accept` | Dispatcher menerima `dispatch.accepted`; staf lain di organisasi yang sama menerima `dispatch.accepted` (offer ditutup); socket responder join `incident:{id}`; warga menerima `report.status_changed` |
| W4 | Offer tidak dijawab | t=20s FCM dikirim ulang; t=60s `dispatch.offer_unseen` ke dispatcher dan supervisor; t=120s `dispatch.expired` |
| W5 | Isolasi room | Responder organisasi A **tidak** menerima event dispatch milik organisasi B; warga tidak menerima event incident milik warga lain; responder yang belum accept tidak menerima `incident.location_updated` |
| W6 | Koneksi terputus 2 menit lalu tersambung | Setelah `connection.ready`, `/sync/events` mengembalikan event yang terlewat, tanpa duplikat di UI |
| W7 | Event ganda (WebSocket + FCM untuk `dispatch.offered`) | Klien hanya memproses satu kali (dedup `eid`), `offer` tidak muncul dua kali |
| W8 | Token kedaluwarsa saat terhubung | `auth.expiring` diterima, klien memperbarui lewat `auth.refresh`, koneksi tidak terputus |
| W9 | Akun responder dinonaktifkan oleh Admin Org | `session.revoked` diterima, koneksi diputus, tidak bisa tersambung ulang |
| W10 | Incident digabung | Dispatcher menerima `incident.merged`; pelapor di incident sumber menerima `report.status_changed` dengan status incident induk |
| W11 | Alert dipublikasikan | Warga terhubung di kecamatan terdampak menerima `alert.published`; warga di kecamatan lain tidak |
| W12 | Dua dispatcher membuka incident yang sama | Dispatcher kedua menerima `incident.locked` dan antreannya menandai "sedang ditangani A" |
| W13 | Server di-restart saat ada offer aktif | Setelah restart, timer offer tetap berjalan (berbasis job), `EXPIRED` tetap terjadi tepat waktu |

---

## 13. Asumsi Default untuk Aplikasi Sampel

Poin yang masih menunggu keputusan client **tidak menghalangi pembangunan sampel**. Selama sampel, nilai di bawah dipakai dan disimpan di `system_settings` sehingga bisa diubah tanpa mengubah kode.

| Hal | Nilai default sampel |
|---|---|
| Batas waktu offer | 120 detik |
| Retry FCM / ambang `offer_unseen` | 20 detik / 60 detik |
| Eskalasi laporan `SUBMITTED` tak tertangani | 3 menit, ke supervisor |
| Penutupan otomatis incident | 24 jam setelah `RESOLVED` |
| Masa kunci incident | 5 menit, perpanjang tiap 60 detik |
| Tenggang keluar room incident | 10 menit |
| Maksimal koneksi per pengguna | 3 |
| Transport | `websocket` dengan fallback `polling`, satu instance (tanpa sticky session) |
| Redis | Satu instance, dipakai untuk adapter Socket.IO, presence, rate limit, BullMQ |

---

## 14. Hal yang Perlu Ditinjau (Setelah Sampel, Bersama Client) 🔶

1. Ritme eskalasi offer (20 / 60 / 120 detik) dan kapan supervisor dilibatkan.
2. Apakah tenggang 10 menit keluar room incident sesuai kebutuhan unit di lapangan.
3. Batas koneksi per pengguna untuk dispatcher yang memakai beberapa layar.
4. Sticky session vs `websocket` saja bila nanti memakai lebih dari satu instance.
5. Apakah warga perlu melihat posisi unit yang mendekat (live tracking), dan seberapa presisi (fase 3).
6. Apakah alert level tertinggi dikirim sebagai CRITICAL (selalu dua jalur) atau cukup STANDARD.
7. Apakah presence dispatcher (siapa sedang online/jaga) perlu tampil di dashboard.

---

## 15. Di Luar Cakupan Dokumen Ini

- Payload FCM (topic, prioritas, channel Android, deep link): dokumen berikutnya.
- Layar dan perilaku aplikasi Flutter dan dashboard.
- Konversi ke spesifikasi event machine-readable (AsyncAPI), dilakukan bersama konversi OpenAPI.
