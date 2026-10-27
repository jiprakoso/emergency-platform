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
- Status: applied (menunggu konfirmasi C0)

## CC-002: `POST /auth/staff/login` — `oneOf` tidak eksklusif
- Tanggal: 2026-10-05
- Sumber: REST (`contracts/openapi.yaml`)
- Usulan: cabang 2FA diberi `required: [twoFactorRequired]` + `additionalProperties: false`
  sehingga `TokenPair` dan bentuk 2FA saling eksklusif (benar-benar `oneOf`).
- Alasan: tanpa pengetatan, objek `TokenPair` juga cocok dengan cabang 2FA (kedua
  skema permisif) → `oneOf` selalu gagal saat validasi.
- Dampak: perbaikan skema; bentuk respons tidak berubah.
- Status: applied (menunggu konfirmasi C0)

---

Usulan yang **belum** diterapkan (menunggu keputusan manusia di titik tinjau C0):

## CC-003: `RegionLevel` vs seed (`CITY` tidak ada)
- Tanggal: 2026-10-05
- Sumber: REST/seed (`seed-demo-aplikasi-darurat.md` §3)
- Usulan: tambahkan `CITY` ke enum `RegionLevel`, atau konfirmasi bahwa level kota
  tidak dipakai di `regions` (hanya DISTRICT/VILLAGE + `PROVINCE` cadangan).
- Alasan: seed mendefinisikan wilayah kota; enum kontrak `PROVINCE|DISTRICT|VILLAGE`.
- Status: proposed

## CC-004: `OrganizationType` vs seed (`COMMAND_CENTER`, `AMBULANCE_SERVICE`)
- Tanggal: 2026-10-05
- Sumber: REST/seed (`seed-demo-aplikasi-darurat.md` §4.1)
- Usulan: selaraskan enum `OrganizationType` dengan daftar seed
  (CC, POLRES, DAMKAR, RSUD, RSPM, AMBULANS, BPBD) — mis. `AMBULANCE` vs `AMBULANCE_SERVICE`,
  `COMMAND_CENTER` tak ada, `OTHER` tak dipakai seed.
- Alasan: enum kontrak `POLICE|FIRE|AMBULANCE|BPBD|HOSPITAL|OTHER`.
- Status: proposed

## CC-005: Respons mutasi tanpa isi
- Tanggal: 2026-10-05
- Sumber: REST (`PATCH /incidents/{id}`, verify, dsb.)
- Usulan: pertimbangkan mengembalikan entitas ter-update (bukan 200/201 kosong)
  agar klien tidak perlu refetch. Alternatif: dokumentasikan eksplisit "204/tanpa isi,
  klien wajib refetch".
- Alasan: dokumen diam; banyak operasi hanya menunjukkan sukses tanpa body.
- Status: proposed

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
- Status: applied (menunggu konfirmasi C0) — diputuskan pemilik 2026-10-26.

## CC-006: Respons tak-tertiping (generic `object`)
- Tanggal: 2026-10-05
- Sumber: REST (`alerts`, `notifications`, `events`, `incident-types`, `roles`,
  `settings`, `shifts`, `condition-reports`, `auth sessions`)
- Usulan: beri skema eksplisit (property + enum) agar contoh quicktype lengkap dan
  kontrak lebih ketat. Saat ini contoh memakai field minimal yang terdokumentasi.
- Status: proposed
