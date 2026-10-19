# Arsitektur Aplikasi Flutter v1: Warga dan Stakeholder

> Status: draft v1 (spesifikasi arsitektur, **bukan source code**)
> Tanggal: 5 Oktober 2026
> Acuan: `konsep-aplikasi-darurat.md`, `rest-api-aplikasi-darurat.md`, `websocket-aplikasi-darurat.md`, `fcm-aplikasi-darurat.md`
> Keputusan dari Anda: **state management memakai GetX**, struktur direktori **model / view / controller / services**.
> Fokus: cukup rinci untuk membangun aplikasi sampel. Poin yang menunggu keputusan client diberi asumsi default (bagian 14). Tanda 🔶 = perlu ditinjau.
> Potongan kode di dokumen ini hanya **ilustrasi pola**, bukan implementasi.

---

## 1. Keputusan Arsitektur

| Topik | Keputusan |
|---|---|
| Framework | Flutter (Dart), Android lebih dulu |
| State management, DI, routing | **GetX** (`GetxController`, `GetxService`, `Bindings`, `GetPage`, `GetMiddleware`) |
| Pola struktur | **MVC + Services**: `models/`, `views/`, `controllers/`, `services/` |
| Basis kode | **Satu proyek, dua flavor**: `citizen` (warga) dan `staff` (stakeholder). Kode bersama di `core/`, `models/`, `services/`. Entry point terpisah |
| HTTP | `dio` dengan interceptor (autentikasi, refresh, idempotensi, galat) |
| Realtime | `socket_io_client` (kontrak di dokumen WebSocket) |
| Push | `firebase_messaging` + `flutter_local_notifications` (kontrak di dokumen FCM) |
| Penyimpanan | Token: `flutter_secure_storage`. Preferensi ringan dan kursor sinkronisasi: `get_storage`. Antrean offline (outbox): SQLite (`drift`) 🔶 |
| Model data | **Dibuat pemilik proyek dengan quicktype** dari contoh JSON di `contracts/examples/` (agent tidak membuat model). Enum diberi penanganan nilai tak dikenal (`unknown`) secara manual agar kompatibel ke depan |
| Peta | `flutter_map` dengan tile OSM untuk sampel 🔶. Navigasi eksternal lewat aplikasi peta di perangkat |
| Lokalisasi | Bahasa Indonesia dulu, lewat `Translations` bawaan GetX |

Catatan tentang GetX: versi paket **dipin** saat proyek dibuat dan diverifikasi kompatibel dengan versi Flutter/Dart dan paket Firebase yang dipakai saat itu. Untuk menjaga kemungkinan berganti pustaka di masa depan, **logika bisnis dan akses data ditaruh di `services/`**, dan controller dibuat tipis. Dengan begitu lapisan state bisa diganti tanpa menyentuh service dan model.

---

## 2. Peran Tiap Lapisan

| Lapisan | Isi | Boleh memakai | Tidak boleh |
|---|---|---|---|
| **models/** | Kelas data, enum, DTO, penerjemah JSON | Hanya Dart murni | Mengimpor controller, view, service |
| **services/** | Akses API, WebSocket, push, penyimpanan, lokasi, antrean offline, sinkronisasi. Tidak tahu tentang UI | models, paket pihak ketiga, service lain | Memanggil `BuildContext`, widget, navigasi |
| **controllers/** | Status layar dan aksi pengguna. Memanggil service, menyimpan `Rx`/`Obx` state, memutuskan navigasi | models, services | `BuildContext`, widget |
| **views/** | Halaman dan widget. Menampilkan state controller, meneruskan aksi | controllers (lewat `GetView<T>`), models, `core/widgets` | Memanggil service atau API langsung |

Arah ketergantungan satu arah:

```
views ──► controllers ──► services ──► (dio / socket / storage / platform)
   └────────────┴────────────┴──► models
```

Dua jenis controller:
- **Controller global** (`controllers/global/`): hidup selama aplikasi berjalan (`permanent`). Memegang keadaan lintas layar: sesi, koneksi, penugasan aktif, daftar laporan, notifikasi.
- **Controller layar** (`controllers/citizen|staff/`): hidup selama layar ada (dibuat lewat `Binding`, dibuang otomatis). Memegang keadaan form dan tampilan.

---

## 3. Struktur Direktori

```
emergency_app/
├── android/
│   └── app/src/
│       ├── main/                       # kode Android bersama
│       ├── citizen/                    # google-services.json warga, ikon, nama aplikasi
│       └── staff/                      # google-services.json staf, ikon, res/raw/alarm_dispatch.mp3
├── env/
│   ├── dev.json                        # API_BASE_URL, WS_URL, ENV, dll. (--dart-define-from-file)
│   ├── staging.json
│   └── prod.json
├── assets/
│   ├── images/  icons/  sounds/  l10n/
├── test/                               # unit + widget test (cermin struktur lib/)
├── integration_test/
└── lib/
    ├── main_citizen.dart               # entry flavor warga
    ├── main_staff.dart                 # entry flavor stakeholder
    ├── bootstrap.dart                  # inisialisasi bersama (urutan di bagian 7)
    │
    ├── app/
    │   ├── config/
    │   │   ├── app_config.dart         # baca --dart-define: ENV, API_BASE_URL, WS_URL, scheme
    │   │   ├── flavor.dart             # enum AppFlavor { citizen, staff }
    │   │   └── constants.dart
    │   ├── routes/
    │   │   ├── app_routes.dart         # nama rute (konstanta)
    │   │   ├── citizen_pages.dart      # daftar GetPage warga
    │   │   ├── staff_pages.dart        # daftar GetPage staf
    │   │   └── middlewares/
    │   │       ├── auth_middleware.dart
    │   │       ├── role_middleware.dart
    │   │       └── min_version_middleware.dart
    │   ├── bindings/
    │   │   ├── citizen_initial_binding.dart   # daftarkan controller global warga
    │   │   └── staff_initial_binding.dart
    │   ├── citizen_app.dart            # GetMaterialApp warga
    │   └── staff_app.dart              # GetMaterialApp staf
    │
    ├── core/
    │   ├── theme/                      # warna, tipografi, komponen tema (terang/gelap)
    │   ├── errors/
    │   │   ├── api_exception.dart      # code, message, details, httpStatus, requestId
    │   │   ├── error_codes.dart        # kode error stabil dari dokumen REST
    │   │   └── error_messages.dart     # kode → pesan Bahasa Indonesia
    │   ├── utils/                      # uuid_v7, geo, debouncer, mask_phone, date_format, server_clock
    │   ├── l10n/                       # id_id.dart (Translations GetX)
    │   └── widgets/                    # widget bersama: loading, error, empty, status_chip,
    │                                   # offline_banner, emergency_call_bar, countdown_timer, map_pin_picker
    │
    ├── models/
    │   ├── common/                     # api_envelope, page_info, geo_point, view_state
    │   ├── auth/                       # app_user, token_pair, device_registration
    │   ├── reference/                  # incident_type, region, public_config, emergency_contact
    │   ├── report/                     # report, report_draft, public_status, timeline_entry, attachment
    │   ├── incident/                   # incident_summary, unit_view, casualty, milestone, severity
    │   ├── dispatch/                   # dispatch, offer_view, dispatch_status, dispatch_type, outcome_code
    │   ├── resource_request/           # resource_request
    │   ├── alert/                      # disaster_alert, alert_level
    │   ├── notification/               # app_notification
    │   └── realtime/                   # event_envelope, event_types, ack_payload
    │
    ├── services/
    │   ├── api/
    │   │   ├── api_client.dart         # Dio + interceptor + penerjemah galat
    │   │   ├── interceptors/           # auth, refresh_single_flight, idempotency, request_id, logging_redacted
    │   │   ├── auth_api.dart
    │   │   ├── config_api.dart         # /config/public, /incident-types, /regions
    │   │   ├── device_api.dart         # /me/devices
    │   │   ├── report_api.dart
    │   │   ├── attachment_api.dart
    │   │   ├── alert_api.dart
    │   │   ├── notification_api.dart
    │   │   ├── dispatch_api.dart       # offer, accept, reject, status, destination
    │   │   ├── incident_api.dart       # bagian untuk staf: detail, casualties, milestones
    │   │   ├── resource_request_api.dart
    │   │   ├── unit_api.dart
    │   │   └── sync_api.dart           # /sync/events, /sync/snapshot
    │   ├── session/
    │   │   └── session_service.dart    # token, refresh, status login, deviceTokenId
    │   ├── realtime/
    │   │   ├── socket_service.dart     # koneksi, reconnect, auth.refresh, ack, app.state
    │   │   ├── event_router.dart       # envelope → aliran event bertipe
    │   │   └── event_deduper.dart      # buang duplikat berdasarkan eid
    │   ├── sync/
    │   │   └── sync_service.dart       # /sync/events berulang, snapshot, kursor lastEventId
    │   ├── push/
    │   │   ├── push_service.dart       # token, izin, handler FCM, pendaftaran perangkat
    │   │   ├── notification_channels.dart   # pembuatan channel Android berversi
    │   │   ├── local_notification_service.dart
    │   │   ├── alarm_service.dart      # suara/getar saat layar offer terbuka (foreground)
    │   │   └── deep_link_service.dart  # emergency://... → rute, aman terhadap cold start
    │   ├── offline/
    │   │   ├── outbox_service.dart     # antrean pekerjaan tertunda + retry
    │   │   ├── outbox_db.dart          # tabel SQLite (drift)
    │   │   └── connectivity_service.dart   # status jaringan + uji jangkauan /health
    │   ├── location/
    │   │   └── location_service.dart   # izin, fix cepat lalu halus, akurasi, pelacak posisi unit
    │   ├── media/
    │   │   ├── media_service.dart      # ambil foto, kompres, siapkan berkas
    │   │   └── upload_service.dart     # alur 3 langkah presigned URL
    │   ├── storage/
    │   │   ├── secure_store.dart
    │   │   └── prefs_store.dart
    │   └── system/
    │       ├── lifecycle_service.dart  # foreground/background → app.state, sinkronisasi saat resume
    │       ├── permission_service.dart # notifikasi, lokasi, kamera
    │       └── server_clock_service.dart   # selisih jam server vs perangkat
    │
    ├── controllers/
    │   ├── global/
    │   │   ├── auth_controller.dart            # status login, peran, logout
    │   │   ├── config_controller.dart          # config publik, jam operasional, nomor darurat
    │   │   ├── realtime_controller.dart        # status koneksi, menyalurkan event ke controller lain
    │   │   ├── connectivity_controller.dart    # online/offline untuk banner
    │   │   ├── notification_controller.dart    # riwayat dan jumlah belum dibaca
    │   │   ├── my_reports_controller.dart      # (warga) laporan milik saya, keyed by id
    │   │   └── assignment_controller.dart      # (staf) dispatch milik unit, offer aktif, keyed by id
    │   ├── citizen/
    │   │   ├── onboarding_controller.dart
    │   │   ├── phone_login_controller.dart     # OTP request + verify (login & register)
    │   │   ├── home_controller.dart
    │   │   ├── report_wizard_controller.dart   # jenis → lokasi → detail/foto → konfirmasi
    │   │   ├── report_list_controller.dart
    │   │   ├── report_detail_controller.dart   # status, timeline, susulan, tarik laporan
    │   │   ├── alert_list_controller.dart
    │   │   ├── alert_detail_controller.dart
    │   │   └── profile_controller.dart         # profil, lokasi rumah
    │   └── staff/
    │       ├── staff_login_controller.dart     # sandi + 2FA
    │       ├── assignment_list_controller.dart
    │       ├── offer_controller.dart           # hitung mundur, terima/tolak
    │       ├── dispatch_detail_controller.dart # UnitView, aksi status, navigasi
    │       ├── incident_detail_controller.dart
    │       ├── casualty_controller.dart
    │       ├── milestone_controller.dart       # hanya tampil bila organisasi lead
    │       ├── resource_request_controller.dart
    │       ├── destination_controller.dart     # pilih RS tujuan
    │       ├── unit_status_controller.dart
    │       └── settings_controller.dart        # kesehatan izin: notifikasi, baterai, lokasi
    │
    ├── bindings/
    │   ├── citizen/                    # satu binding per layar (lazyPut controller layar)
    │   └── staff/
    │
    └── views/
        ├── shared/
        │   ├── splash_page.dart
        │   ├── force_update_page.dart
        │   ├── notification_list_page.dart
        │   └── widgets/
        ├── citizen/
        │   ├── auth/        # phone_page, otp_page, register_page
        │   ├── home/        # home_shell_page (tab), home_tab, widgets/
        │   ├── report/      # report_wizard_page, steps/, report_list_page, report_detail_page, widgets/
        │   ├── alert/       # alert_list_page, alert_detail_page
        │   └── profile/     # profile_page, home_location_page
        └── staff/
            ├── auth/        # staff_login_page, two_factor_page
            ├── home/        # staff_shell_page (tab)
            ├── assignment/  # assignment_list_page, offer_page, dispatch_detail_page, status_sheet, destination_page
            ├── incident/    # incident_detail_page, casualty_form, milestone_form, resource_request_form
            ├── unit/        # unit_status_page
            └── settings/    # permission_health_page
```

Konvensi penamaan:
- Berkas `snake_case`. Sufiks: `*_controller.dart`, `*_binding.dart`, `*_service.dart`, `*_api.dart`, `*_page.dart` (layar penuh), `*_sheet.dart` (bottom sheet), `*_form.dart`.
- Satu kelas publik utama per berkas. Model tidak memakai sufiks `_model`.
- Widget yang hanya dipakai satu layar ditaruh di `widgets/` pada folder fitur itu. Yang dipakai lintas layar masuk `core/widgets/` atau `views/shared/widgets/`.

---

## 4. Paket yang Dipakai

Versi dipin saat proyek dibuat dan diperiksa kompatibilitasnya (jangan menyalin versi dari dokumen ini).

| Kebutuhan | Paket |
|---|---|
| State, DI, rute | `get` |
| HTTP | `dio` |
| Realtime | `socket_io_client` |
| Firebase | `firebase_core`, `firebase_messaging` |
| Notifikasi lokal | `flutter_local_notifications` |
| Penyimpanan aman | `flutter_secure_storage` |
| Penyimpanan ringan | `get_storage` |
| Basis data lokal (outbox) | `drift` (+ `sqlite3_flutter_libs`) 🔶 |
| Jaringan | `connectivity_plus` |
| Lokasi | `geolocator` |
| Izin | `permission_handler` |
| Kamera/galeri, kompres | `image_picker`, `flutter_image_compress` |
| Peta | `flutter_map`, `latlong2` 🔶 |
| Telepon, tautan | `url_launcher` |
| Informasi perangkat/aplikasi | `device_info_plus`, `package_info_plus` |
| Model JSON | Hasil **quicktype** (dibuat pemilik proyek). Paket tambahan hanya bila dibutuhkan oleh opsi keluaran quicktype yang dipilih |
| Utilitas | `uuid`, `intl`, `equatable` |
| Suara alarm foreground | `audioplayers` atau setara 🔶 |

---

## 5. Pola GetX yang Dipakai

### 5.1 Service dan controller global

- Semua service turunan `GetxService` (tidak dibuang saat berpindah rute). Didaftarkan sekali di `bootstrap.dart`, **berurutan** (bagian 7).
- Controller global didaftarkan di `InitialBinding` dengan `Get.put(..., permanent: true)`.
- Controller layar didaftarkan di `Binding` per rute dengan `Get.lazyPut`. Tidak memakai `fenix: true` kecuali ada alasan yang dicatat.

Ilustrasi pola (bukan implementasi):

```dart
// bindings/staff/offer_binding.dart
class OfferBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut(() => OfferController(
          dispatchApi: Get.find<DispatchApi>(),
          assignments: Get.find<AssignmentController>(),
          clock: Get.find<ServerClockService>(),
        ));
  }
}

// controllers/staff/offer_controller.dart  (tipis: panggil service, simpan state)
class OfferController extends GetxController {
  final dispatch = Rxn<OfferView>();
  final state = ViewState.loading.obs;
  final secondsLeft = 0.obs;
  Worker? _ticker;
  // ... accept(), reject(), onClose() membatalkan _ticker
}

// views/staff/assignment/offer_page.dart
class OfferPage extends GetView<OfferController> {
  @override
  Widget build(BuildContext context) => Obx(() => /* tampilkan state */);
}
```

### 5.2 Aturan pakai

| Aturan | Alasan |
|---|---|
| View memakai `GetView<T>` dan membaca state lewat `Obx` pada bagian sekecil mungkin | Membatasi rebuild |
| View **tidak** memanggil `Get.find` untuk service | Menjaga batas lapisan |
| Controller tidak menyimpan `BuildContext` atau widget | Mencegah kebocoran memori dan memudahkan uji |
| Navigasi dan snackbar boleh lewat `Get.toNamed` / `Get.snackbar`, tetapi **teks pesan berasal dari `error_messages.dart`** | Praktis tanpa mencampur logika tampilan |
| Semua `Worker` (`ever`, `debounce`, `interval`) dan `StreamSubscription` dibatalkan di `onClose()` | Mencegah bocor |
| State yang berasal dari server disimpan **dalam peta berkunci id** (`RxMap<String, Dispatch>`) dengan upsert | Event ganda atau berurutan salah tidak merusak state |
| Upsert menolak data dengan `version` lebih kecil dari yang sudah dimiliki | Event datang tidak berurutan |
| Layar memakai `ViewState` (`loading`, `data`, `empty`, `error`) sebagai satu-satunya model status tampilan | Konsisten dan mudah diuji |
| Service yang perlu di-mock saat uji (API, socket, push) didefinisikan lewat kelas abstrak | Controller dapat diuji tanpa jaringan |

### 5.3 Middleware rute

| Middleware | Tugas |
|---|---|
| `MinVersionMiddleware` | Bila versi aplikasi di bawah `minAppVersion` dari `/config/public` → `/force-update` |
| `AuthMiddleware` | Belum login → `/login`. Menyimpan tujuan awal (termasuk dari deep link) untuk dilanjutkan setelah login |
| `RoleMiddleware` | Memastikan peran sesuai flavor (mis. rute staf hanya untuk akun staf) |

### 5.4 Penanganan galat

- Seluruh pemanggilan API melempar `ApiException` (`code`, `message`, `details`, `httpStatus`, `requestId`) dari satu tempat (`api_client.dart`).
- Controller menangkap dan memetakan `code` ke pesan lewat `error_messages.dart`. **Kode yang punya perilaku khusus** ditangani eksplisit: `OFFER_NO_LONGER_AVAILABLE`, `DISPATCH_ALREADY_ACCEPTED`, `VERSION_CONFLICT`, `NOT_LEAD_ORGANIZATION`, `RATE_LIMITED`, `OTP_*`, `UNAUTHENTICATED`.
- `ViewState.error` menampilkan pesan dan tombol coba lagi. `requestId` ditampilkan kecil di layar galat agar mudah dilaporkan ke tim.

### 5.5 Forward compatibility

- Enum dari server (status, jenis, level): hasil quicktype **tidak** menangani nilai tak dikenal, jadi pemilik proyek menambahkan penanganan `unknown` secara manual (mis. pemetaan dengan nilai bawaan `unknown`). Nilai tak dikenal tidak boleh membuat aplikasi gagal. Tampilan menampilkan teks generik.
- Field baru dari server diabaikan. Field yang hilang dari event mengikuti nilai default model.

---

## 6. Service: Perilaku Rinci

### 6.1 `ApiClient` dan interceptor

| Item | Aturan |
|---|---|
| Timeout | Sambung 10 detik, terima 20 detik. Aksi penugasan (accept/reject/status) 10 detik agar tidak menggantung |
| Amplop | Membuka `{ data }` dan `{ data, page }`. Galat `{ error }` diterjemahkan ke `ApiException` |
| `AuthInterceptor` | Menambahkan `Authorization: Bearer`. Pada 401 `UNAUTHENTICATED`: refresh **satu kali untuk semua permintaan yang gagal bersamaan** (single-flight: satu `Completer` dipakai bersama), lalu ulangi permintaan sekali. Bila refresh gagal (`REFRESH_TOKEN_REUSED` atau 401) → `AuthController.logout()` |
| `IdempotencyInterceptor` | Menambahkan header `Idempotency-Key` pada panggilan bertanda `extra: { idempotent: true }`. Kunci dibuat **sekali per aksi logis** dan disimpan di pekerjaan outbox, sehingga pengiriman ulang memakai kunci yang sama |
| `RequestIdInterceptor` | Menambahkan `X-Request-Id` (uuid). Dicantumkan di layar galat |
| Pengulangan otomatis | `GET`: maksimal 2 kali dengan backoff pada galat jaringan/5xx. `POST` ber-kunci idempotensi: maksimal 2 kali pada galat jaringan/5xx/timeout. `POST` tanpa kunci: tidak diulang otomatis |
| Waktu server | Header `Date` setiap respons memperbarui `ServerClockService` |
| Log | `LoggingInterceptor` hanya aktif di build debug/sampel. Token, nomor telepon, dan isi `description` dimask |

### 6.2 `SessionService`

- Menyimpan `accessToken`, `refreshToken`, `deviceTokenId`, `userId`, peran di `secure_store`.
- `restore()` saat bootstrap tanpa jaringan. Menyediakan `Rx` status: `unknown`, `authenticated`, `unauthenticated`.
- `refresh()` single-flight, memutar refresh token (menyimpan pasangan baru sebelum membuang yang lama).
- `clear()` saat logout: hapus token, cabut perangkat (`DELETE /me/devices/{id}` bila online), putus socket, berhenti sinkronisasi.
- Tidak menyimpan kata sandi. Warga login dengan OTP.

### 6.3 `SocketService`

| Item | Aturan |
|---|---|
| Koneksi | Dibuka setelah login dan setelah `SessionService` siap, dengan `auth: { token, appFlavor, appVersion, deviceId }`. Ditutup saat logout |
| Reconnect | Backoff eksponensial 1 s → 10 s dengan jitter, tanpa batas percobaan. Token dibaca ulang dari `SessionService` setiap percobaan |
| `connection.ready` | Memicu `SyncService.syncNow()` dan `app.state` awal |
| `auth.expiring` | Memanggil `SessionService.refresh()`, lalu `emit('auth.refresh', {accessToken})` |
| `session.revoked` / `auth.expired` | Meneruskan ke `AuthController` (logout bersih dengan pesan alasan) |
| Ack | `ack(eid, state)` dengan fallback REST (`POST /notifications/{id}/delivered`, `POST /dispatches/{id}/seen`) bila socket tidak tersambung |
| `app.state` | Dikirim setiap perubahan `FOREGROUND`/`BACKGROUND` oleh `LifecycleService` |
| `unit.location` | Hanya flavor staf, hanya saat ada penugasan aktif dan aplikasi di latar depan. Maksimal 1 kiriman per 5 detik |
| Aliran keluar | `Stream<EventEnvelope>` yang sudah melewati `EventDeduper` |

### 6.4 `EventRouter` dan `EventDeduper`

- `EventDeduper` menyimpan 500 `eid` terakhir dalam memori. Jalur WebSocket dan FCM (foreground) melewati deduper yang sama.
- Dedup bukan satu-satunya pengaman: state disimpan **berkunci id dengan upsert dan pemeriksaan `version`**, sehingga event ganda atau terlambat tidak merusak tampilan (bagian 5.2).
- `EventRouter` memetakan `type` ke aliran bertipe. Controller global berlangganan aliran yang relevan:

| Event | Dikonsumsi controller global | Controller layar (bila terbuka) |
|---|---|---|
| `report.status_changed`, `report.timeline_updated` | `MyReportsController` | `ReportDetailController` |
| `alert.published/updated/closed` | `NotificationController` (lencana), banner foreground bila CRITICAL | `AlertListController`, `AlertDetailController` |
| `notification.created` | `NotificationController` | `NotificationListPage` |
| `dispatch.offered`, `dispatch.notified` | `AssignmentController` (memicu `AlarmService` dan prompt/navigasi ke layar offer) | `OfferController` |
| `dispatch.cancelled`, `dispatch.expired`, `dispatch.accepted` (oleh staf lain satu organisasi) | `AssignmentController` (menutup tampilan offer) | `OfferController` |
| `dispatch.status_changed` | `AssignmentController` | `DispatchDetailController` |
| `incident.updated`, `incident.status_changed`, `incident.location_updated`, `incident.casualties_updated`, `incident.milestone_recorded`, `incident.lead_changed` | `AssignmentController` (memperbarui cache incident untuk dispatch yang sudah diterima) | `IncidentDetailController` |
| `resource_request.decided` | `NotificationController` | `ResourceRequestController` |
| `session.revoked`, `auth.*` | `AuthController` | - |
| `system.notice` | `ConfigController` (banner) | - |

### 6.5 `SyncService`

- `syncNow()` bersifat **single-flight** (panggilan bersamaan digabung).
- Memanggil `GET /sync/events?afterId=<lastEventId>` berulang selama `hasMore`, menyalurkan setiap event ke `EventRouter` seperti event live.
- `resetRequired = true` → `GET /sync/snapshot`, mengganti state lokal (`MyReportsController` / `AssignmentController`), lalu melanjutkan dari `lastEventId` snapshot.
- `lastEventId` disimpan di `prefs_store` per pengguna.
- Pemicu: `connection.ready`, aplikasi kembali ke latar depan, jaringan pulih, membuka dari notifikasi, tarik-untuk-muat-ulang.

### 6.6 `PushService`

Perilaku menurut keadaan aplikasi:

| Keadaan | Pesan FCM | Yang dilakukan |
|---|---|---|
| **Foreground** | `onMessage` | Tidak ada notifikasi sistem. Masuk ke `EventDeduper` lalu `EventRouter` (sama seperti WebSocket). UI dalam aplikasi (banner/layar offer + alarm) |
| **Background** | Sistem menampilkan notifikasi di channel yang ditentukan | Diketuk → `onMessageOpenedApp` → `DeepLinkService` |
| **Terminated** | Sistem menampilkan notifikasi | Diketuk → `getInitialMessage` → `DeepLinkService` setelah bootstrap selesai |
| **Data-only** (`SYNC_HINT`, `SESSION_REVOKED`, `alert.closed`) | Handler latar belakang (fungsi top-level) | Hanya pekerjaan ringan: `sync.hint` → set penanda `needs_sync` di prefs (dibaca saat aplikasi aktif), `SESSION_REVOKED` → hapus token di secure store, `alert.closed` → batalkan notifikasi lokal bertag `alert_{id}` |

Tanggung jawab lain:
- Meminta izin notifikasi (Android 13+) pada saat yang kontekstual. Flavor staf **wajib** (bagian 10.4).
- Mengambil token, mendaftarkan lewat `POST /me/devices` (dengan `pushEnabled`), dan memanggil ulang setiap `onTokenRefresh` dan tiap aplikasi dibuka (maksimal sekali per hari untuk memperbarui `last_seen_at`).
- Membuat **channel Android** sebelum pesan pertama (bagian 7) memakai ID berversi dari dokumen FCM.
- `AlarmService`: memutar suara dan getar hanya selama layar offer terbuka dan offer masih aktif. Berhenti saat dilihat/diterima/ditolak/kedaluwarsa. Tidak ada alarm berulang di latar belakang pada sampel.

### 6.7 `DeepLinkService`

- Mengurai `emergency://dispatch/{id}`, `incident/{id}`, `report/{id}`, `alert/{id}`, `notifications`.
- **Daftar putih rute**, dan semua `id` divalidasi sebagai UUID. Tautan lain diabaikan.
- Cold start: tujuan disimpan sebagai `pendingRoute` sampai bootstrap dan pemeriksaan sesi selesai (`AuthMiddleware` melanjutkannya setelah login).
- Setelah sampai di layar tujuan, data selalu dimuat dari REST (bukan dari isi tautan atau payload push).

### 6.8 `LocationService`

| Kebutuhan | Aturan |
|---|---|
| Warga membuat laporan | Ambil **posisi terakhir yang diketahui langsung** untuk menampilkan peta cepat, lalu pembaruan akurasi tinggi dengan batas waktu 10 detik. Menampilkan nilai akurasi. Akurasi di atas ambang (default 50 m) menampilkan peringatan dan menawarkan menggeser pin |
| Izin ditolak | Laporan tetap bisa dibuat dengan menentukan lokasi manual di peta atau alamat teks. Tidak ada jalan buntu |
| Staf | Posisi unit hanya saat aplikasi di latar depan dan ada penugasan aktif. Pelacakan latar belakang (layanan foreground) ditunda ke fase 3 |
| Pengiriman | Lewat `SocketService` (`unit.location`), cadangan `PUT /units/{id}/location` tiap 30 detik bila socket tidak tersambung |

### 6.9 `MediaService` dan `UploadService`

- Foto: kompres ke sisi terpanjang ±1600 px dan ukuran ≤ ±1,5 MB sebelum diunggah. Metadata EXIF lokasi dibuang. Lokasi resmi hanya dari bidang `location` laporan. 🔶
- Batas: sesuai `/config/public.limits` (default 5 lampiran, foto 10 MB, video 50 MB).
- Alur 3 langkah: `POST /attachments/uploads` → `PUT` ke URL → `POST /attachments/{id}/confirm`. Tiap langkah dapat dilanjutkan dan idempoten. Unggahan putus dimulai ulang dari langkah gagal.
- Unggahan berjalan sebagai pekerjaan outbox terpisah (bagian 11), tidak memblokir pengiriman laporan.

### 6.10 `ServerClockService`

- Menyimpan selisih (offset) antara jam server dan jam perangkat dari `/config/public.serverTime`, `connection.ready.serverTime`, dan header `Date`.
- Dipakai untuk hitung mundur offer (`offerExpiresAt − serverNow`) dan untuk mengisi `occurredAt` pada aksi lapangan, sehingga jam ponsel yang salah tidak merusak data.

---

## 7. Bootstrap dan Siklus Hidup

### 7.1 Urutan inisialisasi (`bootstrap.dart`)

```
1. WidgetsFlutterBinding.ensureInitialized()
2. AppConfig dari --dart-define-from-file (ENV, API_BASE_URL, WS_URL, DEEP_LINK_SCHEME) + flavor
3. Firebase.initializeApp (opsi per flavor)
   FirebaseMessaging.onBackgroundMessage(<fungsi top-level>)
4. GetStorage.init(), SecureStore, PrefsStore
5. ServerClockService, ConnectivityService
6. ApiClient + seluruh *_api  (SessionService direferensikan lewat Get.find lazy)
7. SessionService.restore()          (tanpa jaringan)
8. ConfigController: muat config dari cache lokal (nomor darurat tersedia offline),
                     segarkan di latar belakang
9. LocalNotificationService.init() → NotificationChannels.createAll()   (SEBELUM pesan pertama)
10. SocketService (idle), SyncService, EventRouter, OutboxService, PushService.init()
11. runApp(...) → SplashPage
```

`SplashPage` memutuskan: cek versi minimum → bila ada sesi: hubungkan socket, daftarkan perangkat, `syncNow()`, lalu ke beranda → bila tidak: ke login (warga tetap dapat melihat nomor darurat sebelum login).

### 7.2 Siklus hidup aplikasi

| Peristiwa | Tindakan |
|---|---|
| Kembali ke latar depan | `app.state = FOREGROUND`, sambungkan ulang socket bila putus, `syncNow()`, `OutboxService.flush()`, cek penanda `needs_sync` |
| Ke latar belakang | `app.state = BACKGROUND`. Hentikan `AlarmService`. Hentikan pengiriman posisi |
| Jaringan pulih | Uji `/health` → sambungkan ulang socket, `syncNow()`, `flush()` outbox |
| Jaringan hilang | Banner "Tidak ada koneksi", antrean outbox aktif, tombol telepon darurat tetap |
| Token hampir habis | Lewat `auth.expiring` atau 401, `SessionService.refresh()` |
| `session.revoked` | Logout bersih, layar login dengan alasan |

---

## 8. Katalog Controller

### 8.1 Global (`permanent`)

| Controller | Tanggung jawab | State utama | Service |
|---|---|---|---|
| `AuthController` | Status login, peran, logout, alasan logout | `status`, `user`, `roles` | `SessionService`, `AuthApi`, `DeviceApi` |
| `ConfigController` | Config publik, jam operasional, nomor darurat, versi minimum, banner sistem | `config`, `operatingNow`, `notice` | `ConfigApi`, `PrefsStore` |
| `RealtimeController` | Status koneksi, menyalurkan event ke controller lain | `connected`, `lastEventId` | `SocketService`, `SyncService` |
| `ConnectivityController` | Online/offline, jumlah item outbox untuk banner | `isOnline`, `pendingCount` | `ConnectivityService`, `OutboxService` |
| `NotificationController` | Riwayat, jumlah belum dibaca, tandai dibaca | `items`, `unreadCount` | `NotificationApi` |
| `MyReportsController` *(warga)* | Laporan milik saya, keyed by id, status terbaru, item outbox | `reports: RxMap` | `ReportApi`, `OutboxService` |
| `AssignmentController` *(staf)* | Dispatch unit, offer aktif, cache incident (UnitView), keyed by id | `dispatches: RxMap`, `activeOffer` | `DispatchApi`, `IncidentApi`, `AlarmService` |

### 8.2 Warga

| Controller | Tanggung jawab | Catatan |
|---|---|---|
| `OnboardingController` | Penjelasan singkat, izin lokasi dan notifikasi | Izin diminta kontekstual |
| `PhoneLoginController` | Alur OTP: minta kode, hitung mundur kirim ulang, verifikasi, daftar vs masuk | Menangani `OTP_*` dan `RATE_LIMITED` |
| `HomeController` | Tombol **Lapor**, tombol telepon darurat, ringkasan laporan aktif, alert aktif, banner jam operasional | Tidak bergantung jaringan untuk menampilkan tombol darurat |
| `ReportWizardController` | Langkah jenis → lokasi → detail/foto → konfirmasi. Membuat `clientReportId` di awal. Mengirim lewat outbox | Draf disimpan lokal bila aplikasi ditutup di tengah jalan |
| `ReportListController` | Daftar laporan (kursor), status outbox | |
| `ReportDetailController` | Status, timeline `PUBLIC`, laporan susulan, tarik laporan | Berlangganan event untuk laporan ini |
| `AlertListController` / `AlertDetailController` | Alert wilayah, detail, imbauan | Cache lokal untuk tampilan offline |
| `ProfileController` | Profil, lokasi rumah (memicu penghitungan ulang wilayah), perangkat, logout | |

### 8.3 Staf

| Controller | Tanggung jawab | Catatan |
|---|---|---|
| `StaffLoginController` | Sandi, 2FA bila diminta, ganti sandi awal (`mustChangePassword`) | |
| `AssignmentListController` | Tab Penugasan: aktif, menunggu, riwayat | Dari `AssignmentController` |
| `OfferController` | Menampilkan `OfferView`, hitung mundur (jam server), terima/tolak, "Terima dan berangkat", kirim `seen` | Mengelola `AlarmService`, menangani `409` |
| `DispatchDetailController` | `UnitView`, lokasi presisi, navigasi, tombol status berikutnya, hasil penanganan | Hanya transisi yang diizinkan yang ditampilkan |
| `IncidentDetailController` | Ringkasan incident, dispatch unit lain (ringkas, lengkap bila lead), korban, milestone | |
| `CasualtyController` | Memperbarui jumlah korban | Mendukung antrean offline |
| `MilestoneController` | Mencatat milestone (kode + catatan) | **Hanya organisasi lead** |
| `ResourceRequestController` | Mengajukan bantuan, melihat keputusan | **Hanya organisasi lead** |
| `DestinationController` | Memilih RS tujuan dan ringkasan pasien (ambulans) | Membuat dispatch NOTIFY ke IGD |
| `UnitStatusController` | Status unit (`AVAILABLE`/`BUSY`/`OFFLINE`), pengiriman posisi | |
| `SettingsController` | Kesehatan izin: notifikasi, lokasi, penghemat baterai, status koneksi, versi | Menampilkan peringatan bila `pushEnabled = false` |

---

## 9. Rute dan Layar

### 9.1 Warga

| Rute | Layar | Binding | Penjaga |
|---|---|---|---|
| `/splash` | `SplashPage` | - | - |
| `/force-update` | `ForceUpdatePage` | - | - |
| `/onboarding` | Onboarding | `OnboardingBinding` | - |
| `/login` | Nomor HP | `PhoneLoginBinding` | - |
| `/login/otp` | Verifikasi OTP | (sama) | - |
| `/register` | Nama + lokasi rumah | (sama) | - |
| `/home` | `HomeShellPage` (tab: Beranda, Laporan Saya, Informasi, Profil) | `HomeBinding` | Auth |
| `/report/new` | `ReportWizardPage` | `ReportWizardBinding` | Auth |
| `/report/:id` | `ReportDetailPage` | `ReportDetailBinding` | Auth |
| `/alerts` | `AlertListPage` | `AlertListBinding` | Auth |
| `/alert/:id` | `AlertDetailPage` | `AlertDetailBinding` | Auth |
| `/notifications` | `NotificationListPage` | - | Auth |
| `/profile/home-location` | `HomeLocationPage` | `ProfileBinding` | Auth |

Tombol telepon darurat dan daftar nomor darurat dapat diakses **tanpa login** dari layar login dan onboarding (data dari cache `/config/public`).

### 9.2 Staf

| Rute | Layar | Penjaga |
|---|---|---|
| `/login` | `StaffLoginPage` | - |
| `/login/2fa` | `TwoFactorPage` | - |
| `/home` | `StaffShellPage` (tab: Penugasan, Riwayat, Informasi, Profil/Pengaturan) | Auth + Role |
| `/dispatch/:id` | `OfferPage` (OFFERED/NOTIFIED) atau `DispatchDetailPage` (setelah diterima), dipilih dari status | Auth + Role |
| `/dispatch/:id/destination` | `DestinationPage` | Auth + Role (ambulans) |
| `/incident/:id` | `IncidentDetailPage` | Auth + Role |
| `/incident/:id/casualties` | `CasualtyForm` | Auth + Role |
| `/incident/:id/milestone` | `MilestoneForm` | Auth + Role + lead |
| `/incident/:id/resource-request` | `ResourceRequestForm` | Auth + Role + lead |
| `/unit` | `UnitStatusPage` | Auth + Role |
| `/settings/health` | `PermissionHealthPage` | Auth |
| `/alerts`, `/alert/:id`, `/notifications` | Seperti warga | Auth |

---

## 10. Alur Utama

### 10.1 Warga membuat laporan

1. Tombol **Lapor** selalu terlihat di beranda, bersama tombol telepon darurat. Banner jam operasional bila `operatingNow = false`.
2. `ReportWizardController` membuat `clientReportId` (UUID) saat wizard dibuka.
3. **Jenis:** daftar dari cache `/incident-types`. Pilihan "Saya butuh bantuan" atau "Saya melaporkan kondisi" (yang kedua hanya untuk jenis yang `allowsConditionReport`).
4. **Lokasi:** posisi cepat lalu halus (bagian 6.8). Tampilkan akurasi, pin bisa digeser, alamat teks dapat dikonfirmasi/diisi. Bila daring, `GET /regions/resolve` memberi tahu bila di luar wilayah layanan (peringatan, bukan penghalang).
5. **Detail:** deskripsi singkat, perkiraan korban (`UNKNOWN/ONE/TWO/MANY`), foto (maks 5).
6. **Kirim:** tombol tidak pernah menunggu jaringan. Pekerjaan masuk **outbox** (bagian 11) dan pengguna langsung diarahkan ke detail laporan dengan status "Mengirim…". Teks dan lokasi dikirim **lebih dulu**, foto menyusul.
7. Hasil: `201`/`200` → "Laporan diterima" dengan `publicStatus`. `flags: OUT_OF_AREA` → pesan agar menghubungi nomor darurat. `429` → pesan batas laju dan saran menelepon 112.
8. Selama menunggu, tombol telepon darurat tetap tersedia di layar detail.

### 10.2 Warga memantau laporan

`ReportDetailController` memuat `GET /reports/{id}` dan `/timeline`, lalu berlangganan `report.status_changed` dan `report.timeline_updated` untuk id itu. Saat offline menampilkan data terakhir dengan penanda waktu. Tersedia aksi **Tambah informasi** (follow-up) dan **Tarik laporan**.

### 10.3 Warga menerima alert

Daftar dari `GET /alerts` (sumber kebenaran). Notifikasi push dan event `alert.published` hanya mempercepat. Alert CRITICAL saat aplikasi di latar depan menampilkan banner penuh. Diketuk dari notifikasi → `/alert/{id}`. Cache lokal agar imbauan tetap terbaca saat offline.

### 10.4 Staf menerima penugasan

Tiga jalur masuk ke layar yang sama:
- **Foreground:** `dispatch.offered` (WebSocket atau `onMessage`) → `AssignmentController.activeOffer` → banner/prompt dan `AlarmService`.
- **Notifikasi diketuk:** `DeepLinkService` → `/dispatch/{id}` setelah sesi dan sinkronisasi siap.
- **Aplikasi dibuka biasa:** tab Penugasan menampilkan offer aktif.

Perilaku `OfferController`:
1. Memuat `OfferView` dari REST (bukan dari payload push). Mengirim `seen` (WebSocket `ack SEEN`, cadangan REST).
2. Hitung mundur dari `offerExpiresAt − serverNow`. Saat nol, tombol dinonaktifkan dan layar menampilkan "Penugasan kedaluwarsa". Server tetap penentu akhir.
3. **Terima:** bila dispatch ditujukan ke organisasi tanpa unit dan responder terikat satu unit, `unitId` diisi otomatis. Respons `accept` memuat `UnitView` sehingga lokasi presisi langsung tampil.
4. **"Terima dan berangkat":** `accept` lalu `status = EN_ROUTE` dalam satu ketukan (panggilan kedua boleh masuk outbox).
5. **Tolak:** meminta alasan singkat (pilihan cepat + teks).
6. Penanganan galat khusus: `OFFER_NO_LONGER_AVAILABLE` → "Penugasan sudah tidak berlaku" (layar status, bukan galat). `DISPATCH_ALREADY_ACCEPTED` → "Sudah diterima rekan satu organisasi". `UNIT_NOT_AVAILABLE` → pilih unit lain atau ubah status unit.
7. Aksi `accept`/`reject` **tidak masuk antrean offline** (bagian 11): penugasan bisa kedaluwarsa, jadi aplikasi mencoba ulang cepat 2 kali lalu menampilkan "Tidak ada koneksi, hubungi dispatcher".

Setelah diterima (`DispatchDetailController`):
- Tombol **Navigasi** membuka aplikasi peta eksternal ke koordinat presisi.
- Tombol status berikutnya hanya yang valid dari status saat ini: `Berangkat` → `Tiba di lokasi` → `Selesai`. Boleh melompati tahap ke depan. `Selesai` meminta `outcomeCode` dan catatan.
- Setiap aksi memakai `Idempotency-Key`, `version` dari state lokal, dan `occurredAt` dari `ServerClockService`. Pada `VERSION_CONFLICT`: muat ulang dispatch, periksa transisi masih valid, ulangi sekali.
- Aksi organisasi **lead** (menu lanjutan): Catat milestone, Ajukan bantuan. Menu ini disembunyikan bila `incident.leadOrganizationId` bukan organisasi pengguna (server tetap menolak dengan `NOT_LEAD_ORGANIZATION`).
- Ambulans: **Pilih RS tujuan** → `DestinationPage` (daftar organisasi bertipe `HOSPITAL`) + ringkasan pasien + ETA.
- **IGD** menerima `dispatch.notified`: layar "Persiapan IGD" dengan tombol Siap / Penuh → Pasien tiba → Selesai.
- Perubahan dari luar (milestone, korban, lokasi dikoreksi dispatcher, pembatalan) masuk lewat event dan memperbarui layar.

### 10.5 Celah yang ditemukan: "Saya berangkat" untuk damkar

Dokumen REST menyediakan `POST /incidents/{id}/self-initiate`, tetapi **staf belum bisa menemukan incident sebelum ada dispatch** (belum ada broadcast incident ke unit, dan `incident.read_related` mensyaratkan relasi). Usulan 🔶:
- **Sampel:** dukung "Terima dan berangkat" dari offer (sudah mencakup sebagian besar kebutuhan). Kasus damkar berangkat duluan tetap dicatat dispatcher lewat `on-behalf`.
- **Setelah sampel:** tambahkan `GET /incidents/by-code/{code}` (izin `dispatch.self_initiate`, mengembalikan `OfferView` tanpa lokasi presisi) agar petugas yang mendapat kabar lewat telepon/WhatsApp dapat memasukkan kode incident dan menekan "Saya berangkat". Setelah `self-initiate`, lokasi presisi dibuka seperti setelah accept.

### 10.6 Status dan posisi unit

`UnitStatusController` mengubah status unit (`PUT /units/{id}/status`). Saat ada penugasan aktif dan aplikasi di latar depan, posisi dikirim lewat `SocketService` (maks 1 per 5 detik). Fase 1: hanya memperbarui `last_location` di server. Pelacakan di latar belakang tidak dibuat di sampel.

### 10.7 Sesi dan reconnect

- **Token hampir habis:** otomatis (bagian 6.1, 6.3).
- **Dicabut** (`session.revoked`): hapus token, putus socket, hentikan alarm, tampilkan layar login dengan alasan ("Akun dinonaktifkan oleh administrator").
- **Terputus lalu tersambung:** `connection.ready` → `syncNow()` → event terlewat diterapkan berurutan, tanpa duplikat. `resetRequired` → snapshot.

---

## 11. Offline dan Outbox

Prinsip: **jangan pernah memblokir laporan darurat atau tombol telepon karena jaringan.**

### 11.1 Model pekerjaan outbox (SQLite)

| Kolom | Isi |
|---|---|
| `id` | UUID pekerjaan |
| `userId` | Pemilik pekerjaan |
| `type` | Lihat 11.2 |
| `payload` | JSON permintaan |
| `idempotencyKey` | Dibuat sekali, dipakai ulang di setiap percobaan (untuk laporan: `clientReportId`) |
| `dependsOnJobId` | Pekerjaan yang harus selesai dulu (mis. unggah foto menunggu laporan) |
| `status` | `PENDING`, `IN_FLIGHT`, `SENT`, `FAILED_PERMANENT` |
| `attempts`, `nextAttemptAt`, `lastError` | Pengaturan ulang |
| `createdAt`, `occurredAt` | Waktu dibuat dan waktu kejadian (jam server terkoreksi) |

### 11.2 Jenis pekerjaan

| Jenis | Flavor | Antre offline? | Catatan |
|---|---|---|---|
| `REPORT_CREATE` | Warga | Ya | Kunci = `clientReportId` |
| `REPORT_MEDIA_UPLOAD` | Warga | Ya | Bergantung pada `REPORT_CREATE`. Satu pekerjaan per berkas. 3 langkah, dapat dilanjutkan |
| `REPORT_FOLLOW_UP`, `REPORT_WITHDRAW` | Warga | Ya | |
| `DISPATCH_SEEN` | Staf | Ya (upaya terbaik) | Tidak kritis |
| `DISPATCH_STATUS` | Staf | Ya | Membawa `occurredAt`. Pada `VERSION_CONFLICT`: ambil ulang dispatch, periksa ulang transisi, ulangi |
| `CASUALTY_UPDATE`, `MILESTONE_CREATE` | Staf | Ya | |
| `UNIT_STATUS` | Staf | Ya | Hanya nilai terakhir yang berlaku (pekerjaan lama digantikan) |
| `accept`, `reject`, `destination`, login, OTP | Staf/Warga | **Tidak** | Butuh keputusan segera atau jaringan. Mencoba ulang cepat lalu menampilkan galat yang jelas |

### 11.3 Kebijakan percobaan ulang

- Backoff: 5 d → 15 d → 45 d → 2 m → 5 m (batas atas 5 menit), dengan jitter.
- Pemicu tambahan di luar jadwal: jaringan pulih, aplikasi kembali aktif, `connection.ready`, tombol **Kirim ulang** manual.
- **Sementara** (diulang): galat jaringan, timeout, 5xx, 429 (menghormati `Retry-After`), `VERSION_CONFLICT` (dengan langkah ambil ulang).
- **Permanen** (`FAILED_PERMANENT`, tampil ke pengguna): 4xx lain, mis. `VALIDATION_FAILED`, `REPORT_KIND_NOT_ALLOWED`, `FORBIDDEN`.
- Laporan: teks dan lokasi dikirim lebih dulu. Bila foto gagal berulang, laporan tetap sah dan UI menampilkan "Foto belum terkirim, coba lagi".

### 11.4 Berkas media

Disalin ke direktori aplikasi sampai terkonfirmasi, lalu dihapus. Berkas yatim dibersihkan setelah 7 hari.

### 11.5 Banyak pengguna di satu perangkat

Pekerjaan terikat `userId`. Saat pengguna lain login, pekerjaan milik pengguna sebelumnya **tidak dikirim** dan tidak dihapus sampai pemiliknya login atau 7 hari lewat. Saat logout dengan antrean tidak kosong, aplikasi memperingatkan "Ada laporan yang belum terkirim". 🔶

### 11.6 Cakupan sampel

Outbox berjalan saat aplikasi berjalan (latar depan atau segera setelah kembali aktif). Pengiriman di latar belakang penuh (`workmanager`/layanan foreground) ditunda ke fase 2.

---

## 12. Keamanan, Build, dan Flavor

### 12.1 Keamanan

| Hal | Aturan |
|---|---|
| Token | Hanya di `flutter_secure_storage`. Tidak ada di log, di `get_storage`, atau di payload push |
| Data pribadi | Tidak disimpan lebih lama dari perlu. Cache laporan milik pengguna dihapus saat logout |
| Deep link | Daftar putih rute, validasi UUID (bagian 6.7) |
| Push | Dianggap petunjuk, tidak dipakai untuk memutuskan aksi |
| Jaringan | HTTPS/WSS saja. *Certificate pinning* dipertimbangkan setelah sampel 🔶 |
| Rilis | Build dengan `--obfuscate --split-debug-info`. Tidak ada kunci rahasia server di aplikasi |
| Log/analitik | Tidak mengirim isi laporan, lokasi, atau nomor telepon. Crash reporting (mis. Crashlytics) opsional 🔶 |
| Izin | Diminta saat dibutuhkan, dengan penjelasan. Aplikasi tetap berguna bila izin ditolak (kecuali notifikasi untuk staf) |

### 12.2 Flavor dan konfigurasi

| Item | Warga | Staf |
|---|---|---|
| Entry point | `lib/main_citizen.dart` | `lib/main_staff.dart` |
| `applicationId` | `…citizen` (nilai final ditentukan saat proyek dibuat) | `…staff` |
| Firebase | `google-services.json` di `android/app/src/citizen/` | di `android/app/src/staff/` |
| Suara channel | `siren_alert` | `alarm_dispatch`, `siren_alert` (di `res/raw` flavor staf) |
| Nama dan ikon | Per flavor | Per flavor |

Konfigurasi lingkungan lewat `--dart-define-from-file=env/<lingkungan>.json`:

| Kunci | Contoh |
|---|---|
| `ENV` | `dev` / `staging` / `prod` |
| `API_BASE_URL` | `https://api.example.com/api/v1` |
| `WS_URL` | `wss://api.example.com/realtime` |
| `DEEP_LINK_SCHEME` | `emergency` |
| `MAP_TILE_URL` | URL tile peta |

Manifest Android (garis besar): `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, lokasi (halus dan kasar) untuk kedua flavor, `CAMERA` untuk warga, serta `intent-filter` skema `emergency`. Izin lokasi latar belakang dan layanan foreground **tidak** diminta di sampel.

---

## 13. Skenario Uji

### 13.1 Warga

| Kode | Skenario | Hasil yang diharapkan |
|---|---|---|
| A1 | Buat laporan saat online | Laporan terkirim, status "Laporan diterima", `incident.code` tersedia |
| A2 | Buat laporan saat offline, lalu online | Laporan masuk antrean ("Menunggu terkirim"), terkirim otomatis saat jaringan pulih, **hanya satu** incident terbentuk |
| A3 | Kirim laporan dengan foto, unggahan foto gagal | Laporan tetap terkirim, foto menunjukkan "belum terkirim" dan bisa diulang |
| A4 | Buka aplikasi tanpa login dan tanpa jaringan | Daftar nomor darurat dan tombol telepon tetap tampil (dari cache) |
| A5 | Status laporan berubah | Tampil realtime (WebSocket) atau lewat push/sinkronisasi bila aplikasi tertutup |
| A6 | Akurasi GPS buruk | Peringatan akurasi dan opsi geser pin. Izin lokasi ditolak tetap bisa memilih lokasi manual |
| A7 | Laporan di luar wilayah | Diterima dengan pesan agar menghubungi nomor darurat |
| A8 | Alert wilayah diterima/ diketuk | Muncul di feed dan membuka detail yang benar. Alert dari kecamatan lain tidak muncul |
| A9 | Logout | Token dan perangkat dicabut, cache pribadi dihapus. Peringatan bila ada antrean |
| A10 | Kirim terlalu sering | Pesan batas laju dan saran menelepon 112 |

### 13.2 Staf

| Kode | Skenario | Hasil yang diharapkan |
|---|---|---|
| B1 | Offer masuk saat aplikasi mati, notifikasi diketuk | Layar offer terbuka dengan data dari REST. Lokasi presisi **tidak** tampil sebelum diterima |
| B2 | Hitung mundur | Mengikuti jam server, bukan jam perangkat (diuji dengan jam perangkat sengaja salah) |
| B3 | Terima offer | `UnitView` dengan lokasi presisi, tombol navigasi, tombol status berikutnya |
| B4 | Rekan satu organisasi menerima lebih dulu | Layar menampilkan "sudah diterima rekan", bukan galat |
| B5 | Offer kedaluwarsa/dibatalkan saat layar terbuka | Layar berubah ke status, tombol nonaktif, alarm berhenti |
| B6 | Ubah status saat offline | Masuk antrean dengan `occurredAt` benar, terkirim saat online, riwayat server menunjukkan waktu kejadian ≠ waktu pencatatan |
| B7 | Izin notifikasi ditolak | Peringatan tetap di aplikasi, `pushEnabled = false` terkirim ke server |
| B8 | `session.revoked` | Logout bersih dengan alasan, socket putus, tidak bisa tersambung ulang |
| B9 | Terputus lalu tersambung | Event terlewat diterapkan lewat sinkronisasi tanpa duplikat |
| B10 | Event sama dari WebSocket dan FCM | Layar offer muncul sekali, alarm tidak ganda |
| B11 | Bukan organisasi lead | Menu milestone dan resource request tidak tampil |
| B12 | Ambulans memilih RS tujuan | Dispatch NOTIFY ke IGD terbentuk, IGD dapat menjawab Siap/Penuh |
| B13 | `VERSION_CONFLICT` saat ubah status | Aplikasi memuat ulang dan mengulang sekali bila transisi masih valid |

### 13.3 Jenis pengujian

- **Unit:** controller (dengan service tiruan), `OutboxService`, `SyncService`, `EventDeduper`, `ServerClockService`, pemeta galat, model (JSON ↔ objek, enum tak dikenal).
- **Widget:** layar kritis (wizard laporan, offer, detail dispatch, banner offline).
- **Integrasi:** alur A1-A4 dan B1-B6 terhadap backend sampel (mode `mock` untuk OTP dan notifikasi).
- **Perangkat nyata:** B1, B7, dan penerimaan push (mode `fcm`) pada minimal dua merek ponsel berbeda.

---

## 14. Asumsi Default untuk Aplikasi Sampel

| Hal | Default sampel |
|---|---|
| Platform | Android saja |
| State management | GetX, MVC + services |
| Basis data lokal | `drift` untuk outbox, `get_storage` untuk preferensi, `flutter_secure_storage` untuk token |
| Peta | `flutter_map` + tile OSM, navigasi lewat aplikasi peta eksternal |
| OTP | Mode sampel (backend `mock`), aplikasi menampilkan petunjuk kode pada build dev |
| Push | Backend `mock` secara bawaan. Uji perangkat nyata dengan mode `fcm` |
| Ambang akurasi GPS | 50 m (peringatan) |
| Kompres foto | Sisi terpanjang ±1600 px, ≤ ±1,5 MB, EXIF lokasi dibuang |
| Batas lampiran | Mengikuti `/config/public.limits` (5 lampiran) |
| Outbox | Berjalan saat aplikasi aktif. Tanpa pengiriman latar belakang |
| Posisi unit | Hanya di latar depan saat ada penugasan aktif |
| Alarm | Hanya saat layar offer terbuka |
| Aksi `accept`/`reject` offline | Tidak diantrekan |
| Self-initiate penuh | Ditunda (lihat 10.5), diganti "Terima dan berangkat" |
| Tampilan | Bahasa Indonesia, tema terang dengan dukungan tema gelap dasar, ukuran huruf mengikuti sistem |

---

## 15. Hal yang Perlu Ditinjau 🔶

1. **GetX:** versi dipin dan dicek kompatibilitasnya saat proyek dibuat, lalu dijaga agar logika tetap di `services/`. Bila kelak ingin berganti pustaka, dampaknya terbatas pada controller dan binding.
2. **Basis data lokal:** `drift` (disarankan) vs `sqflite` vs hanya `get_storage` untuk antrean.
3. **Peta:** `flutter_map`/OSM (tanpa kunci, tetapi ada batasan pemakaian tile publik) vs Google Maps (perlu kunci dan penagihan).
4. **Self-initiate damkar:** perlu endpoint `GET /incidents/by-code/{code}` (bagian 10.5).
5. **Aksi `accept`/`reject` tidak diantrekan offline:** setuju, atau perlu masa tenggang singkat?
6. **Logout dengan antrean belum terkirim:** dihapus, ditahan, atau dilarang?
7. **EXIF:** membuang metadata lokasi pada foto warga.
8. **Pengiriman latar belakang** (outbox, posisi unit): ditunda ke fase 2/3.
9. **Satu aplikasi dua peran:** tetap dua flavor terpisah, atau satu aplikasi dengan peran dinamis.
10. **Crash reporting** dan analitik: perlu atau tidak, dan data apa yang boleh dikirim.
11. **Tablet/layar besar** untuk stakeholder di kendaraan atau pos.
12. **Certificate pinning** setelah sampel.

---

## 16. Di Luar Cakupan Dokumen Ini

- Desain visual (warna, tipografi, komponen) dan tata letak layar rinci.
- Dashboard web dispatcher/admin dan Flutter Web untuk stakeholder.
- Pelacakan lokasi latar belakang dan pengiriman latar belakang (`workmanager`).
- Lokalisasi selain Bahasa Indonesia.
- Pipeline CI/CD dan distribusi aplikasi (Play Store atau internal).
- Konversi kontrak ke OpenAPI/AsyncAPI dan dokumen serah terima agent code.
