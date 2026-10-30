# AGENTS.md: Aplikasi Informasi Bencana & Kejadian Darurat (Sampel)

Berkas ini adalah konteks ringkas untuk agent code. **Baca ini dulu, lalu `docs/spec/handoff-agent-code-aplikasi-darurat.md`.**

## Apa yang dibangun

Sistem manajemen insiden darurat untuk **satu kabupaten/kota**, berdiri sendiri (belum terhubung ke Command Center 112), dalam bentuk **aplikasi sampel yang dapat didemokan** (bukan produksi).

Tiga antarmuka:
1. **Dashboard web** (dispatcher, supervisor, admin): Vite + React + TypeScript → `dashboard/`
2. **Aplikasi stakeholder** (ambulans, damkar, polisi, BPBD, IGD): Flutter, flavor `staff` → `mobile/`
3. **Aplikasi warga** (lapor dan info bencana): Flutter, flavor `citizen` → `mobile/`

Backend: **NestJS** (modular monolith), PostgreSQL + PostGIS, Redis (BullMQ, Socket.IO adapter), MinIO, FCM → `backend/`

Alur inti: warga melapor → dispatcher memverifikasi → dispatcher menugaskan stakeholder (dispatch) → stakeholder menerima → lokasi presisi dibuka → status diperbarui sampai selesai.

## Dokumen sumber (di `docs/spec/`)

| Dokumen | Isi |
|---|---|
| `konsep-aplikasi-darurat.md` | Keputusan, prinsip, alur bisnis, peran |
| `erd-aplikasi-darurat.md` | Skema basis data |
| `rest-api-aplikasi-darurat.md` | Kontrak REST, permission, view per role, transisi status, error |
| `websocket-aplikasi-darurat.md` | Event realtime (Socket.IO), room, kebijakan pengiriman |
| `fcm-aplikasi-darurat.md` | Notifikasi push (topic, channel, payload, token) |
| `flutter-aplikasi-darurat.md` | Arsitektur Flutter (GetX, MVC + services, outbox offline) |
| `dashboard-aplikasi-darurat.md` | Dashboard web, console dispatcher |
| `seed-demo-aplikasi-darurat.md` | Data seed, simulator, skrip demo, `seed:verify` |
| `handoff-agent-code-aplikasi-darurat.md` | **Rencana fase, aturan kerja, kriteria selesai** |
| `deployment-aplikasi-darurat.md` | Deployment produksi (**Fase 7, setelah sampel disetujui**; Fase 0-6 hanya memakai Compose dev) |

Kontrak mesin-baca (dibuat di Fase 0): `contracts/openapi.yaml`, `contracts/asyncapi.yaml`, dan contoh JSON di `contracts/examples/`. Keputusan pemilik: `DECISIONS.md`.

Prioritas bila bertentangan: kontrak (setelah disetujui) > dokumen spesifikasi > catatan konsep. **Jika ada pertentangan: berhenti, catat di `docs/CONTRACT_CHANGES.md`, minta keputusan manusia.**

## Aturan wajib

1. **Jangan mengarang** endpoint, field, event, atau status. Butuh sesuatu yang tidak ada? Catat usulan di `docs/CONTRACT_CHANGES.md`, perbarui kontrak dan dokumen bersama-sama.
2. **Catat asumsi** di `docs/ASSUMPTIONS.md` (`A-001`, ...). Pakai default dari bagian "Asumsi Default" tiap dokumen. Bertanya hanya untuk hal yang memblokir.
3. **Kerja per fase** dan **irisan kecil** (satu modul/fitur per perubahan, sertakan tes dan dokumen). Jangan lanjut fase berikutnya sebelum gerbang fase lulus.
4. **REST satu-satunya jalur tulis.** WebSocket hanya mengantar event ke klien. Klien → server hanya: `ack`, `auth.refresh`, `app.state`, `unit.location`.
5. **Visibilitas data di satu tempat:** serializer view (`CitizenView`, `OfferView`, `UnitView`, `DispatcherView`) dipakai bersama oleh REST, WebSocket, dan FCM.
6. **Lokasi presisi dan kontak pelapor tidak boleh bocor** (REST, WebSocket, FCM, log, galat, audit). Responder baru melihat lokasi presisi **setelah accept**.
7. **Event dikirim setelah commit** (tabel outbox). Tidak emit di tengah transaksi.
8. **Mesin status** berbasis tabel transisi (REST §6), diuji penuh. Status/tipe `varchar` + `CHECK`, **bukan enum PostgreSQL**.
9. **Optimistic locking** (`version`), kunci incident atomik, dan balapan `accept` ditangani di tingkat SQL.
10. **Migrasi saja** (tanpa `synchronize`). Rahasia tidak masuk repositori.
11. **Seed menolak berjalan jika `ENV=prod`.** Nomor darurat sampel adalah nomor **contoh** (bukan 112/110/113/118/119 asli).
12. **Jangan log** token, sandi, OTP, nomor telepon pelapor, `description`, koordinat presisi, token FCM.
13. **Berhenti di titik tinjau** (C0-C4) dan tunggu persetujuan manusia.

## Keputusan pemilik proyek yang sudah ditetapkan (lihat `DECISIONS.md`)

- **ORM: TypeORM**, dan **seluruh logika geospasial memakai SQL mentah PostGIS** (tanpa pustaka geospasial tambahan).
- **Model Dart tidak dibuat agent.** Pemilik proyek membuatnya dengan **quicktype** dari `contracts/examples/`. Tugas agent: menyediakan **contoh JSON lengkap** (varian opsional/null, semua nilai enum, per audiens/view) dan menjaganya cocok dengan respons nyata.
- **Pemilik keputusan: satu orang.** Pertanyaan non-blokir: pakai default, catat di `docs/ASSUMPTIONS.md`, lanjut. Pertanyaan blokir: kelompokkan di `docs/QUESTIONS.md`. Titik tinjau C0-C4: selalu berhenti.
- Nama target `make`, struktur repo, dan CI: **default sementara** (CI-agnostik: semua pemeriksaan ada di target `make`). Jangan membuat berkas CI khusus penyedia sebelum diputuskan.

## Istilah penting

| Istilah | Arti |
|---|---|
| Report | Laporan warga (satu kejadian bisa punya banyak laporan) |
| Incident | Kejadian (SUBMITTED → VERIFIED → IN_PROGRESS → RESOLVED → CLOSED, plus INVALID/DUPLICATE) |
| Dispatch | Penugasan satu incident ke satu organisasi/unit. Tipe `RESPOND` (berangkat) atau `NOTIFY` (disiapkan, mis. IGD). Status: OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → DONE (+REJECTED/EXPIRED/CANCELLED) |
| Lead organization | Pemegang komando di lapangan (polisi: kecelakaan, damkar: kebakaran, BPBD: banjir) |
| Resource request | Permintaan bantuan tambahan dari lead, diputuskan dispatcher |
| Milestone | Catatan koordinasi (mis. `SCENE_RELEASED`) di `incident_events` |
| `OfferView` / `UnitView` | Tampilan data responder sebelum / sesudah accept |
| `publicStatus` | Status sederhana untuk warga |
| `eid` | Id pengiriman logis (sama untuk WebSocket dan FCM, dipakai dedup) |
| On-behalf | Dispatcher mencatat kejadian atas nama unit (telepon/WhatsApp/radio) |

## Perintah standar (`Makefile`)

`make up` · `make down` · `make migrate` · `make seed` · `make reset-live` · `make verify` · `make test` · `make lint` · `make contract` · `make demo-bots`

Nama dapat disesuaikan di Fase 0, **dan harus diperbarui di berkas ini**.

Swagger UI (dev/test, mati di `NODE_ENV=production`): `http://<host>:<PORT>/api/docs` — menyajikan `contracts/openapi.yaml` apa adanya; "Try it out" memanggil server ini (`/api/v1`).

## Konvensi singkat

- Backend: NestJS, lapisan Controller (tipis) → Service (transaksi) → Repository; mesin status dan kebijakan terpisah; satu use case yang mengubah state = satu transaksi (data + `incident_events` + `outbox_events` + `audit_logs`).
- JSON `camelCase`, enum `UPPER_SNAKE_CASE`, DB `snake_case`, koordinat API `{lat, lng}` (PostGIS `(lng, lat)`, konversi hanya di repository).
- Galat: `{ error: { code, message, details, requestId } }`, `code` stabil (bahasa Inggris), `message` Bahasa Indonesia.
- Waktu: UTC di penyimpanan/API (ISO 8601), tampilan WIB (`Asia/Jakarta`). Gunakan `ClockService` (dapat disuntikkan untuk tes).
- Commit: Conventional Commits. Perubahan kontrak ikut memperbarui `contracts/*` dan dokumen di commit yang sama.
- Flutter: GetX (state/DI/routing), struktur `models/ views/ controllers/ services/`, view tidak memanggil service, controller tipis.
- Dashboard: Vite + React + TS, TanStack Query + Zustand, event WebSocket menulis ke cache hanya di `realtime/handlers`.

## Definisi selesai (ringkas)

Perilaku sesuai kontrak · tes lulus (unit + integrasi + skenario yang dirujuk gerbang fase) · `make lint` dan `make contract` hijau · tidak ada PII di log · migrasi naik-turun · dokumen/kontrak diperbarui · `docs/PROGRESS.md` diperbarui.

Rincian: `docs/spec/handoff-agent-code-aplikasi-darurat.md` bagian 7.
