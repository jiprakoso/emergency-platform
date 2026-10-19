# Spesifikasi Notifikasi FCM v1: Aplikasi Informasi Bencana & Kejadian Darurat

> Status: draft v1 (spesifikasi, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `erd-aplikasi-darurat.md` (v1.2), `rest-api-aplikasi-darurat.md`, `websocket-aplikasi-darurat.md`
> Cakupan: pesan push lewat Firebase Cloud Messaging (FCM): topic, payload, channel Android, siklus token, kebijakan dua jalur dengan WebSocket, dan deep link.
> Fokus: cukup rinci untuk aplikasi sampel. Poin yang menunggu keputusan client diberi asumsi default (bagian 13). Tanda 🔶 = perlu ditinjau.

---

## 1. Prinsip

1. **FCM adalah pembangun dan jalur kedua, bukan sumber data.** Pesan hanya berisi petunjuk (id dan jenis). Isi sebenarnya diambil aplikasi lewat REST dengan autentikasi.
2. **Tidak ada data pribadi dan lokasi presisi di payload.** Pesan melewati infrastruktur Google dan muncul di layar kunci. Isi dibatasi pada jenis kejadian, kecamatan/kelurahan, dan jarak kasar. Aturan ini sama dengan `OfferView` di dokumen REST.
3. **Pesan darurat harus tampil walau aplikasi mati.** Karena itu pesan kritis memakai tipe **notification + data** (ditampilkan sistem), bukan data-only. Alasannya di bagian 4.4.
4. **Payload hanya petunjuk, tidak dipercaya untuk mengubah state.** Aplikasi tidak pernah menganggap isi push sebagai kebenaran. Ia selalu memuat ulang lewat REST.
5. **Pengiriman best effort.** FCM tidak memberi tanda terima ke server. Karena itu ada `ack` dari klien, kirim ulang terbatas, WebSocket sebagai jalur paralel, dan eskalasi manual ke dispatcher.
6. **Satu abstraksi penyedia.** Backend memakai antarmuka `NotificationProvider` dengan dua implementasi: `FcmProvider` dan `MockProvider` (untuk sampel tanpa kredensial).
7. **Dedup lintas jalur.** Pesan FCM dan event WebSocket untuk kejadian yang sama membawa `eid` yang sama, sehingga klien hanya memprosesnya sekali.

---

## 2. Platform dan Proyek

| Item | Keputusan |
|---|---|
| Platform utama | **Android** (aplikasi warga dan stakeholder, Flutter) |
| iOS (warga) | Disiapkan di payload (blok `apns`), namun aktivasi menunggu keputusan client 🔶 |
| Web (stakeholder web, web admin) | Web push **ditunda ke fase 2**. Dispatcher memakai WebSocket dan alarm di dalam aplikasi web |
| Proyek Firebase | **Satu proyek per lingkungan** (`dev`, `staging`, `prod`). Kredensial akun layanan disimpan di secret store, tidak di repo |
| Pengiriman | Dari backend (Firebase Admin SDK / HTTP v1) lewat antrean BullMQ `fcm-send` |
| Aplikasi Flutter | Dua flavor (`CITIZEN`, `STAFF`) dengan konfigurasi Firebase masing-masing, bisa satu proyek dengan dua app id |

---

## 3. Topic

### 3.1 Penamaan

FCM hanya mengizinkan karakter `a-z A-Z 0-9 - _ . ~ %` pada nama topic. Awalan lingkungan wajib agar sampel dan produksi tidak tercampur.

| Topic | Anggota | Dipakai untuk |
|---|---|---|
| `{env}_city` | Semua warga terdaftar | Alert seluruh kota |
| `{env}_kec_{kodeKecamatan}` | Warga dengan lokasi rumah di kecamatan itu | Alert per kecamatan. Contoh `prod_kec_357807` (titik pada kode wilayah dibuang) |
| `{env}_staff_alerts` | Staf BPBD dan staf stakeholder yang berhak menerima alert | Alert bencana untuk petugas |
| `{env}_test` | Perangkat penguji | Alert uji (`isTest = true`) |

**Pesan dispatch tidak memakai topic.** Dispatch ditujukan ke pengguna tertentu, butuh pelacakan per perangkat, dan butuh ack, jadi dikirim langsung ke token.

### 3.2 Siapa yang berlangganan: server yang memegang kendali

Langganan topic dilakukan **dari server** (`subscribeToTopic` dengan Admin SDK, maksimal 1000 token per panggilan), bukan dari klien. Alasannya: klien tidak bisa melanggani topic wilayah lain, dan server dapat merekonsiliasi bila langganan hilang (instal ulang, token berganti).

| Pemicu | Tindakan server |
|---|---|
| Warga mendaftarkan perangkat (`POST /me/devices`) | Langganankan `{env}_city` dan `{env}_kec_{kode}` sesuai `home_region_id` |
| Warga mengubah lokasi rumah (`PATCH /me`) | Berhenti langganan kecamatan lama, langganan kecamatan baru, untuk seluruh perangkat aktif |
| Token berganti (`POST /me/devices` dengan token baru) | Langganan ulang untuk token baru |
| Logout / perangkat dicabut / akun dinonaktifkan | Berhenti langganan semua topic untuk token itu |
| Staf BPBD/stakeholder berhak alert | Langganan `{env}_staff_alerts` |
| Job rekonsiliasi (harian) | Bandingkan `device_topic_subscriptions` dengan keadaan seharusnya, perbaiki selisih |

Catatan: `GET /me/alert-topics` tetap ada, tetapi hanya sebagai informasi dan verifikasi di sisi klien (tidak dipakai klien untuk berlangganan).

Langganan dicatat di tabel `device_topic_subscriptions` (ERD v1.2) agar bisa direkonsiliasi tanpa bergantung pada API pihak ketiga.

### 3.3 Aturan pengiriman ke topic

- Pesan topic **tanpa ack dan tanpa tanda terima**. Sumber kebenaran untuk alert adalah `GET /alerts` (feed di aplikasi), bukan push.
- Kondisi gabungan maksimal 5 topic per pesan, misalnya `'prod_kec_357807' in topics || 'prod_kec_357808' in topics`. Alert yang mencakup lebih dari 5 kecamatan dikirim sebagai beberapa pesan.
- Alert mode `GEOFENCE` (polygon/radius) tidak memakai topic. Server mencari warga dengan `home_location` di dalam area (PostGIS), mengambil token aktif, lalu mengirim per kelompok maksimal 500 token (`sendEachForMulticast`).
- Pembatasan: tidak lebih dari N alert per jam per wilayah (`system_settings.alert_rate_limit`), agar warga tidak dibanjiri.

---

## 4. Katalog Pesan

### 4.1 Jenis pesan

| Kode | Sumber event | Target | Tampil? | Prioritas Android | TTL | Channel (Android) | `tag` / `collapse_key` |
|---|---|---|---|---|---|---|---|
| `DISPATCH_OFFER` | `dispatch.offered` | Token responder yang dituju | Ya | HIGH | sampai `offerExpiresAt` | `dispatch_offer_v1` | `dispatch_{dispatchId}` |
| `DISPATCH_NOTIFIED` | `dispatch.notified` (IGD) | Token staf IGD | Ya | HIGH | 10 menit | `dispatch_offer_v1` | `dispatch_{dispatchId}` |
| `DISPATCH_UPDATE` | `dispatch.cancelled`, `dispatch.expired` | Token responder terkait | Ya (menggantikan notifikasi offer) | HIGH | 10 menit | `dispatch_update_v1` | `dispatch_{dispatchId}` |
| `ALERT` | `alert.published` | Topic atau token (geofence) | Ya | HIGH untuk kritis, NORMAL lainnya | min(sisa masa berlaku, 6 jam) | `alert_critical_v1` / `alert_info_v1` | `alert_{alertId}` |
| `ALERT_UPDATE` | `alert.updated` | sama dengan alert asalnya | Ya (menggantikan) | NORMAL | sama | `alert_info_v1` | `alert_{alertId}` |
| `REPORT_UPDATE` | `report.status_changed` | Token warga pelapor | Ya | NORMAL | 1 jam | `report_update_v1` | `report_{reportId}` (hanya yang terbaru yang tampil) |
| `SYNC_HINT` | Event STANDARD untuk staf tanpa koneksi WebSocket | Token staf | Tidak (data-only) | NORMAL | 1 jam | - | `sync` |
| `SESSION_REVOKED` | `session.revoked` | Token perangkat terkait | Tidak (data-only) | HIGH | 1 jam | - | `session` |

Catatan:
- **Tidak ada FCM** untuk event yang hanya relevan bagi dispatcher (`dispatch.rejected`, `dispatch.expired` ke dispatcher, `dispatch.offer_unseen`, `resource_request.created`, `dispatch.self_initiated`). Dispatcher memakai web admin dengan WebSocket dan alarm di dalam halaman. Web push untuk dispatcher menyusul di fase 2.
- **TTL pendek untuk offer** disengaja: bila perangkat baru online setelah penawaran kedaluwarsa, pesan itu dibuang dan tidak membunyikan alarm basi.
- **`tag` yang sama** membuat notifikasi baru **menggantikan** yang lama di perangkat. Itu cara `DISPATCH_UPDATE` (dibatalkan/kedaluwarsa) menimpa alarm offer sehingga petugas tidak mengejar penugasan yang sudah tidak berlaku.
- **`collapse_key`** membuat FCM hanya menyimpan pesan terbaru bila perangkat sedang offline.

### 4.2 Target penerima

| Kasus | Penerima |
|---|---|
| Dispatch ke unit tertentu | Semua pengguna aktif dengan `staff_profiles.unit_id` = unit itu dan permission `dispatch.respond` |
| Dispatch ke organisasi tanpa unit | Semua responder aktif organisasi itu 🔶 (bisa ramai untuk organisasi besar. Setelah ada penanda "bertugas" (on-duty), dibatasi ke yang bertugas) |
| `report.status_changed` | Semua pelapor yang laporannya tertaut ke incident (termasuk yang digabung) |
| Alert | Lihat bagian 3 |

Satu pengguna bisa punya beberapa perangkat. Pesan dikirim ke seluruh token aktif pengguna itu, maksimal 5 token terbaru.

### 4.3 Teks tampilan (aman untuk layar kunci)

Judul dan isi dibuat server, singkat, tanpa data pribadi. Contoh dalam Bahasa Indonesia:

| Kode | Judul | Isi |
|---|---|---|
| `DISPATCH_OFFER` | `Penugasan baru: Kecelakaan Lalu Lintas` | `Kec. Gubeng, ±1,8 km. Buka untuk menerima atau menolak.` |
| `DISPATCH_NOTIFIED` | `Persiapan IGD: korban kecelakaan` | `Perkiraan tiba 12 menit, 2 korban luka.` |
| `DISPATCH_UPDATE` | `Penugasan dibatalkan` / `Penugasan kedaluwarsa` | `Kecelakaan Lalu Lintas, Kec. Gubeng.` |
| `ALERT` | `[Siaga] Potensi banjir Kec. Gubeng` | Ringkasan satu-dua kalimat. Imbauan lengkap di dalam aplikasi |
| `REPORT_UPDATE` | `Laporan Anda diperbarui` | `Unit menuju lokasi` (status disederhanakan sesuai `publicStatus`) |

Aturan: tidak ada alamat jalan, nama pelapor, nomor telepon, atau koordinat. Kode incident boleh ditampilkan pada notifikasi staf.

### 4.4 Mengapa notification + data, bukan data-only

| Pertimbangan | Notification + data | Data-only |
|---|---|---|
| Tampil saat aplikasi mati/di latar belakang | **Ditampilkan sistem**, tidak bergantung kode aplikasi | Bergantung aplikasi menjalankan handler. Sering gagal di perangkat dengan penghemat baterai agresif |
| Prioritas tinggi | Dianggap berhasil bila menghasilkan notifikasi yang terlihat | FCM bisa menurunkan prioritas pesan data-only berprioritas tinggi yang tidak menghasilkan notifikasi |
| Kontrol suara/channel | Lewat `channel_id` | Harus dibuat sendiri lewat notifikasi lokal |
| Ack `DELIVERED` | **Tidak otomatis** (handler Dart tidak berjalan saat aplikasi mati) | Bisa, bila handler berjalan |

Konsekuensi yang diterima: pada kondisi aplikasi mati, ack `DELIVERED` bisa tidak pernah datang. Eskalasi (lihat bagian 6) karena itu bertumpu pada **`SEEN`** (petugas membuka penugasan), bukan `DELIVERED`.

---

## 5. Payload

### 5.1 Kunci `data` (nilai harus string)

| Kunci | Contoh | Keterangan |
|---|---|---|
| `v` | `"1"` | Versi skema payload |
| `eid` | `"0192f3a0-..."` | **Sama** dengan `eid` event WebSocket yang berpadanan. Dipakai dedup |
| `type` | `"dispatch.offered"` | Jenis event |
| `class` | `"CRITICAL"` | Kelas pengiriman |
| `eventId` | `"48213"` | Id `incident_events` bila ada |
| `incidentId`, `dispatchId`, `reportId`, `alertId` | UUID | Rujukan, sesuai jenis |
| `deepLink` | `"{scheme}://dispatch/0192..."` | Tujuan saat notifikasi diketuk |
| `ackRequired` | `"true"` | Apakah klien wajib `ack` |
| `expiresAt` | `"2026-10-05T03:17:02Z"` | Batas relevansi (offer, alert) |

Batas ukuran 4 KB. Praktiknya jauh di bawah 1 KB. **Dilarang** memasukkan lokasi presisi, alamat, deskripsi bebas, atau data pelapor.

### 5.2 Contoh pesan `DISPATCH_OFFER` (HTTP v1, ke satu token)

```json
{
  "message": {
    "token": "<fcmToken>",
    "notification": {
      "title": "Penugasan baru: Kecelakaan Lalu Lintas",
      "body": "Kec. Gubeng, ±1,8 km. Buka untuk menerima atau menolak."
    },
    "data": {
      "v": "1",
      "eid": "0192f3a0-7b1e-7c00-9e55-1c2d3e4f5a6b",
      "type": "dispatch.offered",
      "class": "CRITICAL",
      "eventId": "48213",
      "incidentId": "0192f39f-...",
      "dispatchId": "0192f3a0-...",
      "deepLink": "emergency://dispatch/0192f3a0-...",
      "ackRequired": "true",
      "expiresAt": "2026-10-05T03:17:02Z"
    },
    "android": {
      "priority": "HIGH",
      "ttl": "120s",
      "collapse_key": "dispatch_0192f3a0-...",
      "notification": {
        "channel_id": "dispatch_offer_v1",
        "tag": "dispatch_0192f3a0-...",
        "visibility": "PUBLIC",
        "notification_priority": "PRIORITY_MAX",
        "sticky": true
      }
    },
    "apns": {
      "headers": { "apns-priority": "10", "apns-push-type": "alert" },
      "payload": { "aps": { "sound": "default", "interruption-level": "time-sensitive", "thread-id": "dispatch" } }
    }
  }
}
```

Catatan: pada Android 8+ **suara dan getar ditentukan oleh channel**, bukan oleh field `sound` pada pesan. Karena itu channel harus sudah dibuat di perangkat (bagian 6).

### 5.3 Contoh pesan `ALERT` (topic)

```json
{
  "message": {
    "topic": "prod_kec_357807",
    "notification": {
      "title": "[Siaga] Potensi banjir Kec. Gubeng",
      "body": "Curah hujan tinggi. Siapkan perlengkapan dan pantau informasi resmi."
    },
    "data": {
      "v": "1", "eid": "0192f3b1-...", "type": "alert.published", "class": "CRITICAL",
      "alertId": "0192f3b0-...", "deepLink": "emergency://alert/0192f3b0-...",
      "ackRequired": "false", "expiresAt": "2026-10-05T12:00:00Z"
    },
    "android": {
      "priority": "HIGH",
      "ttl": "21600s",
      "collapse_key": "alert_0192f3b0-...",
      "notification": { "channel_id": "alert_critical_v1", "tag": "alert_0192f3b0-...", "visibility": "PUBLIC" }
    }
  }
}
```

### 5.4 Contoh pesan `SYNC_HINT` (data-only)

```json
{
  "message": {
    "token": "<fcmToken>",
    "data": { "v": "1", "eid": "...", "type": "sync.hint", "class": "STANDARD" },
    "android": { "priority": "NORMAL", "ttl": "3600s", "collapse_key": "sync" }
  }
}
```

---

## 6. Channel Notifikasi Android

Channel dibuat **oleh aplikasi saat pertama dijalankan** (sebelum pesan pertama datang). Setelah dibuat, suara dan tingkat kepentingan tidak bisa diubah aplikasi (hanya pengguna), jadi **ID channel diberi versi** (`_v1`). Mengubah suara = membuat channel baru (`_v2`). Bila `channel_id` pada pesan tidak ada di perangkat, Android memakai channel bawaan FCM dan alarm tidak berbunyi sebagaimana mestinya.

| Channel ID | Aplikasi | Kepentingan | Suara | Getar | Layar kunci | Keterangan |
|---|---|---|---|---|---|---|
| `dispatch_offer_v1` | STAFF | Tinggi (heads-up) | `alarm_dispatch` (berkas di `res/raw`) | Pola panjang | PUBLIC | Offer penugasan dan IGD. Aplikasi dapat meminta izin melewati Jangan Ganggu (keputusan akhir ada pada pengguna) |
| `dispatch_update_v1` | STAFF | Tinggi | Nada biasa | Pendek | PUBLIC | Pembatalan/kedaluwarsa |
| `alert_critical_v1` | CITIZEN, STAFF | Tinggi | `siren_alert` | Panjang | PUBLIC | Alert level tertinggi |
| `alert_info_v1` | CITIZEN, STAFF | Default | Nada biasa | Pendek | PUBLIC | Alert biasa dan pembaruan |
| `report_update_v1` | CITIZEN | Default | Nada biasa | Pendek | **PRIVATE** | Status laporan (isi disembunyikan di layar kunci) |
| `system_v1` | Semua | Rendah | Senyap | - | PRIVATE | Info sistem |

Hal yang perlu diperhatikan untuk aplikasi STAFF:
- **Android 13+ mewajibkan izin `POST_NOTIFICATIONS`.** Aplikasi stakeholder harus memintanya saat onboarding dan menampilkan peringatan tetap bila ditolak, karena tanpa izin penugasan tidak akan terlihat. Status ini dilaporkan ke server (`device_tokens.push_enabled`) agar dispatcher tahu responder tersebut tidak bisa dihubungi lewat push.
- **Penghemat baterai** (terutama beberapa merek ponsel) dapat menunda atau membuang pesan. Aplikasi menampilkan panduan pengecualian optimasi baterai di pengaturan.
- **Alarm berulang/full-screen intent** (layar menyala seperti panggilan masuk) tidak dipakai di sampel. Kebijakan Google Play membatasi izin `USE_FULL_SCREEN_INTENT`, dan keputusan distribusi aplikasi stakeholder (Play Store atau internal) menentukan apakah ini bisa diaktifkan. 🔶

---

## 7. Siklus Token Perangkat

| Tahap | Aturan |
|---|---|
| **Pendaftaran** | Saat login dan setiap kali token berganti (`onTokenRefresh`), klien memanggil `POST /me/devices` dengan `fcmToken`, `platform`, `appFlavor`, `appVersion`, **`pushEnabled`** (izin notifikasi aktif atau tidak). Server melakukan upsert berdasarkan `fcm_token` |
| **Perangkat dipakai bergantian** | Bila token yang sama sudah terikat ke pengguna lain (ponsel dinas dipakai bergantian), ikatan lama dicabut dan diikat ke pengguna yang baru login. Langganan topic lama ikut dicabut |
| **Kesegaran** | Klien memperbarui `last_seen_at` setiap aplikasi dibuka (maksimal sekali per hari). Token yang tidak terlihat lebih dari 60 hari dikeluarkan dari pengiriman massal (alert) 🔶 |
| **Logout** | `DELETE /me/devices/{id}`: token dicabut, langganan topic dihapus. Klien boleh memanggil `deleteToken()` |
| **Akun dinonaktifkan** | Semua token pengguna dicabut, langganan topic dihapus, lalu `SESSION_REVOKED` dikirim |
| **Token tidak valid** | Bila FCM membalas `UNREGISTERED`, `INVALID_ARGUMENT` pada token, atau `SENDER_ID_MISMATCH`, server menandai `revoked_at` dan tidak mengirim lagi |
| **Jumlah perangkat** | Maksimal 5 token aktif per pengguna (yang terbaru dipertahankan) |

---

## 8. Alur Pengiriman

### 8.1 Offer dispatch (jalur ganda)

```
Aksi REST: POST /incidents/{id}/dispatches
   │
   ├─ transaksi DB: simpan dispatch + incident_events + notifikasi (outbox)
   └─ COMMIT
         │
         ▼
   DeliveryPolicyService  (kelas CRITICAL → dua jalur)
         │
         ├── WebSocket: dispatch.offered ke unit/org/user   (eid = E1)
         │
         └── FCM: DISPATCH_OFFER ke semua token responder   (eid = E1)
                    └─ simpan ke notification_deliveries (QUEUED → SENT)

Klien (foreground, terhubung): menerima WS dan FCM (onMessage)
        → dedup eid → tampilkan UI penugasan sekali
Klien (background/mati): sistem menampilkan notifikasi (channel alarm)
        → petugas mengetuk → aplikasi dibuka → sinkronisasi → layar penugasan (ack SEEN)

Timer (BullMQ):
   t=20 s  belum ada ack → kirim ulang FCM SEKALI (tag sama, menggantikan, tidak menumpuk)
   t=60 s  belum SEEN    → event dispatch.offer_unseen ke dispatcher (hubungi via telepon)
   t=120 s habis         → EXPIRED; kirim DISPATCH_UPDATE (menggantikan notifikasi offer)
```

Aturan:
- Kirim ulang FCM **hanya sekali** untuk tiap offer, supaya tidak membunyikan alarm berulang tanpa batas.
- Pada aplikasi mati, ack `DELIVERED` mungkin tidak datang (bagian 4.4). Penentu eskalasi sebenarnya adalah **`SEEN`**.
- Pesan berikutnya untuk dispatch yang sama (`DISPATCH_UPDATE`) memakai `tag` dan `collapse_key` yang sama sehingga menimpa notifikasi offer.

### 8.2 Alert wilayah

```
Admin: POST /admin/alerts/{id}/publish
   │
   ├─ COMMIT (status ACTIVE)
   ▼
 Mode REGION_TOPIC:
   - kumpulkan kecamatan terdampak (disaster_alert_regions)
   - kirim ke topic {env}_kec_{kode}  (kondisi gabungan ≤ 5 topic per pesan)
   - kirim ke {env}_staff_alerts

 Mode GEOFENCE:
   - query PostGIS: users.home_location di dalam area
   - ambil token aktif (≤ 60 hari tidak terlihat), kelompokkan ≤ 500 token
   - sendEachForMulticast per kelompok, catat jumlah sukses/gagal

 Selain itu:
   - WebSocket: alert.published ke region:{districtId} dan user yang terhubung
   - Feed GET /alerts menjadi sumber kebenaran (warga yang tidak menerima push tetap melihatnya)
```

Aturan tambahan:
- **Alert uji** (`isTest = true`) hanya dikirim ke `{env}_test`.
- **Pembaruan alert** memakai `tag`/`collapse_key` yang sama, sehingga notifikasi lama ditimpa. **Penutupan alert** mengirim data-only `alert.closed` (best effort, untuk menghapus notifikasi yang masih tampil).
- Kelas alert ditentukan dari `system_settings.alert_levels` (tiap level punya `fcm_class`: `CRITICAL` → channel `alert_critical_v1`, selain itu `alert_info_v1`). 🔶
- Jumlah penerima tidak dilaporkan FCM untuk topic. Pantau lewat jumlah pesan terkirim dan jumlah pengguna yang membuka alert (`GET /alerts/{id}`).

### 8.3 Pembaruan status laporan warga

`report.status_changed` → `REPORT_UPDATE` ke token pelapor. `collapse_key = report_{reportId}`: bila perangkat offline lama, hanya status terbaru yang tampil. Tidak ada eskalasi, tidak ada ack.

### 8.4 Pengiriman gagal

| Kondisi | Tindakan |
|---|---|
| `UNAVAILABLE`, `INTERNAL`, `QUOTA_EXCEEDED`, timeout | Coba ulang dengan backoff eksponensial, maksimal 3 kali. `QUOTA_EXCEEDED` menghormati `Retry-After` |
| `UNREGISTERED`, token tidak valid | Cabut token (bagian 7), jangan coba ulang |
| `THIRD_PARTY_AUTH_ERROR` / kredensial bermasalah | Hentikan antrean, kirim peringatan operasional ke Super Admin |
| Seluruh jalur FCM gagal | WebSocket tetap berjalan. Eskalasi `offer_unseen` ke dispatcher tetap terjadi pada t=60 s. Status `FAILED` tercatat di `notification_deliveries` |

---

## 9. Deep Link dan Perilaku Klien

### 9.1 Rute

Skema ditentukan konfigurasi (`{scheme}`, sampel: `emergency`).

| Deep link | Tujuan | Aplikasi |
|---|---|---|
| `{scheme}://dispatch/{dispatchId}` | Layar penugasan (offer atau detail) | STAFF |
| `{scheme}://incident/{incidentId}` | Detail incident (`UnitView`) | STAFF |
| `{scheme}://report/{reportId}` | Status dan timeline laporan | CITIZEN |
| `{scheme}://alert/{alertId}` | Detail alert | CITIZEN, STAFF |
| `{scheme}://notifications` | Riwayat notifikasi | Semua |

### 9.2 Saat notifikasi diketuk

1. Aplikasi terbuka (dari mati: `getInitialMessage`; dari latar belakang: `onMessageOpenedApp`).
2. Cek sesi. Bila perlu login atau perbarui token, lalu lanjut.
3. Jalankan sinkronisasi (`/sync/events`, atau `/sync/snapshot` bila `resetRequired`).
4. Buka layar sesuai deep link dengan **data dari REST**, bukan dari payload push.
5. Kirim `ack SEEN` (via WebSocket atau `POST /dispatches/{id}/seen`).
6. Bila penugasan sudah tidak berlaku (kedaluwarsa, dibatalkan, diterima unit lain): tampilkan layar status dengan penjelasan, bukan layar error.

### 9.3 Aturan klien

- **Foreground:** pesan FCM tidak menampilkan notifikasi sistem. Aplikasi menampilkan UI dalam aplikasi (banner/alarm), dan membuang pesan bila `eid`-nya sudah diproses dari WebSocket.
- **Dedup:** simpan 500 `eid` terakhir, dipakai bersama dengan jalur WebSocket.
- **Penanganan latar belakang (`onBackgroundMessage`):** hanya untuk pesan data-only (`SYNC_HINT`, `SESSION_REVOKED`, `alert.closed`). Handler harus ringan, tidak bergantung pada status UI.
- **`SESSION_REVOKED`:** bersihkan sesi lokal dan tampilkan layar login.
- **Pengelolaan izin:** minta `POST_NOTIFICATIONS` dalam konteks yang jelas. Untuk STAFF, izin ini wajib dan ada indikator tetap di aplikasi bila nonaktif.
- **Pembuatan channel:** dilakukan di inisialisasi aplikasi, sebelum menerima pesan pertama (bagian 6).

---

## 10. Keamanan dan Privasi

| Hal | Aturan |
|---|---|
| Isi pesan | Tanpa data pribadi, tanpa lokasi presisi. Hanya id, jenis, wilayah kasar, jarak kasar |
| Kepercayaan | Isi push tidak dipakai untuk memutuskan aksi. Data selalu diambil ulang lewat REST yang terautentikasi dan berotorisasi |
| Pemalsuan push | Tidak mungkin dari klien: hanya backend yang memegang kredensial pengirim |
| Pengikatan token | Hanya pengguna terautentikasi yang bisa mendaftarkan token. Token dicabut saat logout/penonaktifan |
| Topic | Hanya server yang melanggankan, sehingga warga tidak dapat melanggani wilayah lain |
| Kredensial | Akun layanan Firebase di secret store, dipisah per lingkungan, hak akses minimum |
| Layar kunci | Notifikasi warga ber-visibilitas `PRIVATE`. Notifikasi offer dan alert `PUBLIC` karena tidak memuat data pribadi |
| Log | Token FCM dimask di log. Payload tidak berisi PII sehingga aman dicatat |
| Retensi | `notification_deliveries` mengikuti kebijakan retensi (lihat bagian pertanyaan terbuka catatan konsep) |

---

## 11. Observabilitas

Metrik yang dicatat (untuk dashboard operasional dan evaluasi pilot):

- Jumlah pesan per jenis dan per status (`QUEUED`, `SENT`, `FAILED`).
- Latensi: dari dispatch dibuat → pesan terkirim → ack `SEEN`.
- Persentase offer yang memerlukan kirim ulang, mencapai `offer_unseen`, dan `EXPIRED`.
- Kegagalan per kode galat FCM, jumlah token dicabut karena tidak valid.
- Jumlah responder dengan `push_enabled = false` atau token kedaluwarsa (indikator kesiapan pilot).
- Alert: jumlah pesan terkirim per kelompok dan lama pengiriman massal.

---

## 12. Skenario Uji FCM

| Kode | Skenario | Hasil yang diharapkan |
|---|---|---|
| F1 | Offer ke responder dengan aplikasi **mati** | Sistem menampilkan notifikasi di channel `dispatch_offer_v1` (suara alarm); diketuk → aplikasi terbuka ke layar penugasan dengan data dari REST |
| F2 | Offer saat aplikasi **foreground** dan WebSocket tersambung | Penugasan muncul **sekali** di UI (dedup `eid`), tanpa notifikasi sistem ganda |
| F3 | Offer dikirim saat perangkat offline hingga setelah offer kedaluwarsa | Pesan tidak diterima setelah TTL, tidak ada alarm basi |
| F4 | Dispatch dibatalkan setelah notifikasi offer tampil | Notifikasi offer **tergantikan** oleh `DISPATCH_UPDATE` (tag sama) |
| F5 | Alert kecamatan A | Hanya warga kecamatan A yang menerima. Warga kecamatan B tidak |
| F6 | Warga pindah lokasi rumah ke kecamatan B | Langganan A dicabut, B dipasang. Alert A berikutnya tidak diterima |
| F7 | Logout, dan login oleh pengguna lain di perangkat yang sama | Pengguna lama tidak menerima push lagi, token terikat ke pengguna baru, langganan topic menyesuaikan |
| F8 | Aplikasi dihapus (token tidak valid) | FCM membalas `UNREGISTERED`, token ditandai `revoked_at`, tidak dikirimi lagi |
| F9 | Pemeriksaan otomatis seluruh payload | Tidak ada koordinat, alamat, nama, atau nomor telepon, ukuran < 1 KB |
| F10 | FCM tidak dapat dijangkau | Pengiriman masuk antrean ulang (maks 3). WebSocket tetap berjalan, `offer_unseen` tetap terjadi pada t=60 s |
| F11 | Offer tanpa ack sampai t=20 s | FCM dikirim ulang **sekali**, notifikasi menggantikan yang lama (tidak menumpuk) |
| F12 | `NOTIFICATION_PROVIDER=mock` | Pengiriman dicatat (log/DB) tanpa menghubungi Firebase, alur demo tetap berjalan |
| F13 | Alert geofence ke 1.200 perangkat | Dikirim dalam 3 kelompok (≤ 500), hitungan sukses/gagal tercatat |
| F14 | Responder menolak izin notifikasi | `push_enabled = false` tercatat, dispatcher melihat penanda "tidak dapat dihubungi lewat push" |
| F15 | Dispatch ke organisasi tanpa unit | Seluruh responder aktif organisasi menerima, yang pertama `accept` memenangkan, lainnya mendapat `DISPATCH_UPDATE` |

---

## 13. Asumsi Default untuk Aplikasi Sampel

| Hal | Default sampel |
|---|---|
| Penyedia | `NOTIFICATION_PROVIDER=mock` secara bawaan. Beralih ke `fcm` untuk uji di perangkat nyata |
| Proyek Firebase | Satu proyek `dev` dengan dua app id (`CITIZEN`, `STAFF`) |
| Platform | Android saja. Blok `apns` disiapkan tetapi tidak diaktifkan |
| Web push | Tidak dipakai (dispatcher memakai WebSocket) |
| TTL offer / notified / update | Sampai `offerExpiresAt` / 10 menit / 10 menit |
| TTL alert | min(sisa masa berlaku, 6 jam) |
| Kirim ulang offer | Sekali pada t=20 s |
| Token dianggap basi | 60 hari tidak terlihat |
| Maksimal token per pengguna | 5 |
| Penerima dispatch ke organisasi | Semua responder aktif (belum ada penanda bertugas) |
| Alarm | Suara channel saja, tanpa full-screen intent dan tanpa alarm berulang |
| Level alert tertinggi | Memakai channel `alert_critical_v1` (kelas CRITICAL) |
| Batas alert | Maksimal 5 alert per jam per wilayah |
| Skema deep link | `emergency://` |

---

## 14. Hal yang Perlu Ditinjau (Setelah Sampel, Bersama Client) 🔶

1. **Distribusi aplikasi stakeholder** (Play Store atau internal). Menentukan apakah full-screen intent, alarm berulang, dan pengecualian baterai dapat dipakai.
2. **iOS untuk warga.** Bila ya: perlu akun Apple Developer, konfigurasi APNs, dan keputusan memakai `time-sensitive` atau mengajukan *critical alerts*.
3. **Penanda "bertugas" (on-duty) responder.** Mencegah seluruh staf organisasi besar (mis. RSUD) menerima setiap offer.
4. **Pemetaan level alert ke kelas pengiriman** (level mana yang CRITICAL) mengikuti istilah BPBD.
5. **Cadangan non-push** bila perangkat responder tidak dapat dijangkau (SMS atau panggilan otomatis).
6. **Web push untuk dispatcher** dan stakeholder web.
7. **Teks notifikasi** (bahasa, panjang, dan istilah yang dipakai di daerah).
8. **Ambang token basi** (60 hari) dan batas jumlah perangkat per pengguna.

---

## 15. Di Luar Cakupan Dokumen Ini

- Arsitektur aplikasi Flutter secara rinci (struktur kode, state management, penyimpanan lokal, antrean offline): dokumen berikutnya.
- Layar dashboard dispatcher dan alarm dalam halaman web.
- Integrasi SMS/WhatsApp sebagai cadangan.
- Konfigurasi Firebase di sisi konsol (pembuatan proyek, kunci akun layanan) dan alur CI/CD.
