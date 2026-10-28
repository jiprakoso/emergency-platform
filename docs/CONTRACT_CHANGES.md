# CONTRACT_CHANGES.md

Catatan usulan perubahan kontrak (endpoint/field/event/status) dari agent.
Menunggu keputusan pemilik proyek sebelum diterapkan.

Format: `CC-001`, tanggal, sumber (REST/WS/FCM/handoff), usulan, alasan, dampak, status (proposed/approved/rejected).

---

## CC-001: `Envelope.data` tidak boleh dipatok `type: object`
- Tanggal: 2026-10-05
- Sumber: REST (`contracts/openapi.yaml`)
- Usulan: ubah `Envelope.data` dari `{ type: object }` menjadi tanpa batasan tipe,
  dan biarkan tiap operasi menentukan tipe `data` (objek atau larik).
- Alasan: beberapa respons sukses beramplop `Envelope` mengembalikan **larik**
  (mis. `POST /incidents/{id}/dispatches/batch`). Karena JSON Schema `allOf`,
  `{type: object}` ∩ `{type: array}` = kosong → respons mustahil dibuat. Endpoint
  semacam itu tidak dapat pernah valid.
- Dampak: tidak ada perubahan bentuk respons nyata; hanya memperbaiki kekakuan
  skema. Sudah **diterapkan** sebagai koreksi cacat (blok bersarang tetap
  mendefinisikan `data`).
- Status: **approved (C0, 2026-10-28)** — sudah diterapkan sebagai koreksi cacat

## CC-002: `POST /auth/staff/login` — `oneOf` tidak eksklusif
- Tanggal: 2026-10-05
- Sumber: REST (`contracts/openapi.yaml`)
- Usulan: cabang 2FA diberi `required: [twoFactorRequired]` + `additionalProperties: false`
  sehingga `TokenPair` dan bentuk 2FA saling eksklusif (benar-benar `oneOf`).
- Alasan: tanpa pengetatan, objek `TokenPair` juga cocok dengan cabang 2FA (kedua
  skema permisif) → `oneOf` selalu gagal saat validasi.
- Dampak: perbaikan skema; bentuk respons tidak berubah.
- Status: **approved (C0, 2026-10-28)** — sudah diterapkan (perbaikan skema)

---

Usulan yang disetujui pemilik di titik tinjau **C0 (2026-10-28)** dan diterapkan:

## CC-003: `RegionLevel` vs seed (`CITY` tidak ada)
- Tanggal: 2026-10-05
- Sumber: REST/seed (`seed-demo-aplikasi-darurat.md` §3)
- Usulan: tambahkan `CITY` ke enum `RegionLevel`, atau konfirmasi bahwa level kota
  tidak dipakai di `regions` (hanya DISTRICT/VILLAGE + `PROVINCE` cadangan).
- Alasan: seed mendefinisikan wilayah kota; enum kontrak `PROVINCE|DISTRICT|VILLAGE`.
- Keputusan pemilik (2026-10-28): **kontrak diselaraskan ke `CITY|DISTRICT|VILLAGE`**
  (sesuai `CHECK` migrasi dan data seed); `PROVINCE` dibuang karena tidak diizinkan
  DB dan tidak dipakai seed.
- Status: **approved (C0, 2026-10-28) — diterapkan**

## CC-004: `OrganizationType` vs seed (`COMMAND_CENTER`, `AMBULANCE_SERVICE`)
- Tanggal: 2026-10-05
- Sumber: REST/seed (`seed-demo-aplikasi-darurat.md` §4.1)
- Usulan: selaraskan enum `OrganizationType` dengan daftar seed
  (CC, POLRES, DAMKAR, RSUD, RSPM, AMBULANS, BPBD) — mis. `AMBULANCE` vs `AMBULANCE_SERVICE`,
  `COMMAND_CENTER` tak ada, `OTHER` tak dipakai seed.
- Alasan: enum kontrak `POLICE|FIRE|AMBULANCE|BPBD|HOSPITAL|OTHER`.
- Keputusan pemilik (2026-10-28): **enum kontrak diselaraskan ke daftar DB**
  (`COMMAND_CENTER|POLICE|FIRE|HOSPITAL|BPBD|AMBULANCE_SERVICE|PRIVATE_FIRE|DISHUB|OTHER`,
  9 nilai); `AMBULANCE` diganti `AMBULANCE_SERVICE` agar sama dengan `CHECK`
  migrasi dan data seed (D-009).
- Status: **approved (C0, 2026-10-28) — diterapkan**

## CC-005: Respons mutasi tanpa isi
- Tanggal: 2026-10-05
- Sumber: REST (`PATCH /incidents/{id}`, verify, dsb.)
- Usulan: pertimbangkan mengembalikan entitas ter-update (bukan 200/201 kosong)
  agar klien tidak perlu refetch. Alternatif: dokumentasikan eksplisit "204/tanpa isi,
  klien wajib refetch".
- Alasan: dokumen diam; banyak operasi hanya menunjukkan sukses tanpa body.
- Keputusan pemilik (2026-10-28): **operasi mutasi 200/201 mengembalikan entitas
  ter-update** (bukan sekadar sukses tanpa isi), sehingga klien tidak perlu refetch.
  Operasi yang memang murni ack/hapus (204: logout, hapus sesi/perangkat/kunci,
  tandai notifikasi, ganti sandi, enable 2FA) tetap `204` tanpa isi dan kini
  **didokumentasikan eksplisit** di dokumen REST (§1.1) beserta kewajiban
  klien untuk menyegarkan state sendiri. Halaman `/health` bukan mutasi.
- Status: **approved (C0, 2026-10-28) — diterapkan**

## CC-007: Tambah `sampleMode` pada `GET /config/public`
- Tanggal: 2026-10-26
- Sumber: seed (§8 `sample_mode`, skenario V7) vs REST (§5.2)
- Usulan: tambahkan field boolean `sampleMode` ke respons `GET /config/public`
  (openapi + dokumen REST §5.2), diisi dari `system_settings.sample_mode`
  (default `true` pada aplikasi sampel).
- Alasan: skenario V7 mensyaratkan `/config/public` mengembalikan
  `sampleMode = true` agar klien menampilkan lencana **MODE SAMPEL**; dokumen
  REST §5.2 dan kontrak sebelumnya tidak memuat field ini (pertentangan antar-dokumen).
- Dampak: penambahan field opsional; tidak merusak klien lama. Contoh JSON
  `GETConfigPublic` ikut diperbarui.
- Status: **approved (C0, 2026-10-28)** — diputuskan pemilik 2026-10-26, dikonfirmasi di C0

## CC-006: Respons tak-tertiping (generic `object`)
- Tanggal: 2026-10-05
- Sumber: REST (`alerts`, `notifications`, `events`, `incident-types`, `roles`,
  `settings`, `shifts`, `condition-reports`, `auth sessions`)
- Usulan: beri skema eksplisit (property + enum) agar contoh quicktype lengkap dan
  kontrak lebih ketat. Saat ini contoh memakai field minimal yang terdokumentasi.
- Keputusan pemilik (2026-10-28): **setujui — beri skema eksplisit** untuk seluruh
  resource dalam daftar, diturunkan dari contoh JSON yang sudah ada dan definisi ERD
  (bukan mengarang field); diperlukan agar contoh quicktype lengkap (D-002).
- Status: **approved (C0, 2026-10-28) — diterapkan**

---

Usulan **baru** yang ditemukan saat menerapkan CC-003..CC-006 (2026-10-28), belum
diputuskan — sengaja tidak ditegakkan sepihak; kontrak sementara memakai bentuk
yang tidak memaksakan salah satu pihak:

## CC-008: `notifications.kind` — `REPORT_UPDATE` vs `CHECK` DB
- Tanggal: 2026-10-28
- Sumber: FCM (§tabel pesan, `REPORT_UPDATE`) + contoh `GETNotifications.json` vs ERD/migrasi (`notifications.kind CHECK` = `DISPATCH_OFFER|INCIDENT_UPDATE|ALERT|RESOURCE_REQUEST|SYSTEM`).
- Usulan: samakan salah satu — tambahkan `REPORT_UPDATE` ke `CHECK` (perlu migrasi), atau ganti nilai FCM/contoh jadi `INCIDENT_UPDATE`.
- Alasan: keduanya sumber resmi dan saling bertentangan; modul notifikasi dibangun Fase 4-5.
- Dampak: `NotificationView.kind` sementara `type: string` (tanpa enum) agar cepat diputuskan; quicktype kehilangan enum bila tidak diselesaikan.
- Status: proposed

## CC-009: `severity` — `MASS` (ERD/DB) vs `CRITICAL` (kontrak)
- Tanggal: 2026-10-28
- Sumber: ERD §4 + `CHECK incidents.severity` (`LOW|MEDIUM|HIGH|MASS`) vs `Severity` OpenAPI (`LOW|MEDIUM|HIGH|CRITICAL`).
- Usulan: pilih satu; rekomendasi samakan ke `MASS` (ERD + DB + memerlukan migrasi bila sebaliknya) atau perbarui ERD/DB ke `CRITICAL`.
- Alasan: dokumen REST tidak menyebut nilai mana pun; contoh memakai `HIGH` (lulus di kedua versi). Menyentuh input severity Fase 2.
- Status: proposed

## CC-010: `level`/`category` alert — daftar terkonfigurasi vs enum/CHECK
- Tanggal: 2026-10-28
- Sumber: REST §5.9 ("teks `level` dan `category` bebas dalam batas daftar `system_settings.alert_levels`", seed: WASPADA/SIAGA/AWAS) vs enum `AlertLevel` kontrak (`INFO|WARNING|ALERT|EMERGENCY`, disetujui C0) + `CHECK alerts.category` (`FLOOD|EARTHQUAKE|WEATHER|LANDSLIDE|OTHER`) + contoh (`BANJIR`).
- Usulan: tetapkan apakah `level` memakai kode konfigurasi BPBD (WASPADA/SIAGA/AWAS) atau enum kontrak; samakan `category` antara contoh/dokumen dan `CHECK` DB.
- Alasan: tiga pihak berbeda; seed tidak menanam alert sehingga belum ada kegagalan nyata.
- Dampak: `AlertView.category` sementara `type: string`, `level` mengikuti enum kontrak yang sudah disetujui.
- Status: proposed

## CC-011: `incident_events.event_type` — UPPERCASE (ERD) vs dot-lowercase (kontrak/contoh)
- Tanggal: 2026-10-28
- Sumber: ERD §6 (`STATUS_CHANGED`, `NOTE_ADDED`, `MILESTONE`, dst.) vs contoh REST `GETIncidentsIdEvents` + pesan AsyncAPI (`incident.verified`, `incident.note_added`).
- Usulan: samakan vocabulary — mutasi penulisan di DB (VALUE) atau penamaan contoh/pesan; satu daftar menjadi acuan.
- Alasan: `IncidentEventView.type` dan pesan WS harus memakai katalog yang sama agar Fase 2/4 konsisten.
- Status: proposed

## CC-012: `AttachmentRef.kind` — `IMAGE|VIDEO|DOCUMENT` vs `CHECK` `PHOTO|VIDEO`
- Tanggal: 2026-10-28
- Sumber: kontrak `AttachmentRef.kind` (disetujui C0) vs `CHECK attachments.kind` (`PHOTO|VIDEO`).
- Usulan: samakan (mis. `PHOTO|VIDEO` di kontrak, atau perluas `CHECK` + seed lampiran).
- Alasan: contoh `POSTDispatchesIdAccept` memakai `IMAGE`; modul lampiran dibangun Fase 2.
- Status: proposed
