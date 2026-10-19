# Prompt Fase 0 (siap tempel)

> Letakkan berkas ini di `docs/prompts/fase-0.md`. Tempel satu prompt per sesi agent, **berurutan** (0a → 0b → 0c), dan tinjau hasilnya sebelum lanjut.
> Agent otomatis membaca `CLAUDE.md` → `AGENTS.md` di akar repositori. Prompt di bawah menambahkan tugas spesifik.
> Fase 0 hanya fondasi dan kontrak. **Tidak ada logika bisnis backend** (itu Fase 1 dan seterusnya).

---

## Sebelum memanggil agent

- [ ] Repositori dibuat dan folder awal ada (`docs/spec`, `contracts`, `backend`, `dashboard`, `mobile`, `infra`).
- [ ] 11 dokumen spesifikasi disalin ke `docs/spec/` (nama tidak diubah).
- [ ] `AGENTS.md` dan `CLAUDE.md` di akar repositori.
- [ ] `DECISIONS.md` di `docs/DECISIONS.md`.
- [ ] `docs/CONTRACT_CHANGES.md`, `ASSUMPTIONS.md`, `QUESTIONS.md`, `PROGRESS.md` dibuat sebagai berkas kosong dengan judul.
- [ ] Commit awal.

---

## Prompt 0a: Fondasi repositori dan lingkungan

```
Konteks:
Kita membangun aplikasi sampel sistem manajemen insiden darurat. Baca AGENTS.md,
lalu docs/spec/handoff-agent-code-aplikasi-darurat.md (terutama bagian 1-6 dan 9)
dan docs/spec/struktur-direktori.md. Baca juga docs/DECISIONS.md (keputusan pemilik
proyek yang tidak boleh diubah).

Tugas: Fase 0, bagian 0a (fondasi). Jangan membuat logika bisnis.
1. Susun struktur repositori sesuai struktur-direktori.md (folder kosong diberi .gitkeep).
2. Buat infra/docker-compose.yml untuk dev: PostgreSQL+PostGIS, Redis, MinIO
   (bucket "attachments" dibuat lewat skrip inisialisasi), backend, dashboard.
   `make up` dari klon bersih harus berjalan.
3. Buat Makefile dengan target: up, down, migrate, seed, reset-live, verify, test,
   lint, contract, demo-bots. Target yang belum bisa dijalankan diberi pesan jelas
   ("belum diimplementasikan, Fase X"), bukan gagal diam-diam.
4. Inisialisasi backend NestJS (TypeScript strict) dengan: konfigurasi env tervalidasi
   (gagal start bila tidak valid), logger pino dengan redaksi PII, endpoint /health dan
   /health/ready, koneksi PostgreSQL (TypeORM) dan Redis. .env.example lengkap
   (handoff bagian 5.2).
5. Migrasi dasar dari docs/spec/erd-aplikasi-darurat.md (v1.3): ekstensi postgis,
   seluruh 32 tabel, kolom, index (termasuk GiST) dan CHECK. Status/tipe varchar,
   BUKAN enum PostgreSQL. SQL mentah untuk bagian geospasial. Migrasi harus dapat
   naik dan turun.
6. Inisialisasi dashboard (Vite + React + TypeScript strict) sebatas kerangka dan
   halaman kosong yang berjalan. Tidak mengimplementasikan fitur.
7. CI-AGNOSTIK: seluruh pemeriksaan dipanggil lewat target make. JANGAN membuat berkas
   CI khusus penyedia (keputusan D-008 belum diambil).
8. Perbarui AGENTS.md bagian "Perintah standar" bila ada perubahan nama.

Acuan: handoff §4-5, §6.1 (Fase 0), §9; ERD seluruhnya; struktur-direktori.md.

Keluaran: struktur repo, compose, Makefile, backend dan dashboard kerangka,
migrasi, README singkat cara menjalankan, docs/PROGRESS.md (bagian Fase 0a).

Selesai bila:
- `make up` dari klon bersih sukses; /health/ready hijau (DB, Redis, penyimpanan).
- `make migrate` naik dan turun tanpa galat; jumlah tabel sesuai ERD v1.3 (32).
- `make lint` hijau.
- Tidak ada rahasia di repositori; hanya .env.example.

Batasan:
- Jangan mengubah dokumen di docs/spec tanpa mencatat di docs/CONTRACT_CHANGES.md.
- Jika ERD tidak konsisten atau ambigu, catat di docs/QUESTIONS.md, ambil default
  yang paling konservatif, dan lanjut (catat di docs/ASSUMPTIONS.md).
- Berhenti setelah 0a selesai dan laporkan. Jangan lanjut ke 0b.
```

---

## Prompt 0b: Kontrak OpenAPI

```
Konteks:
Fase 0a selesai. Sekarang kita membuat kontrak REST yang mesin-baca (contract-first).
Baca AGENTS.md dan handoff bagian 6.4 (konversi kontrak), lalu
docs/spec/rest-api-aplikasi-darurat.md SELURUHNYA.

Tugas: Fase 0, bagian 0b. Buat contracts/openapi.yaml (OpenAPI 3.1).
- Satu path + operation untuk SETIAP baris tabel endpoint di dokumen REST (bagian 5.1-5.14).
  operationId konsisten (camelCase, mis. getDispatch, acceptDispatch).
- Komponen bersama: amplop (Envelope, PageEnvelope, ErrorEnvelope), Coordinates,
  enum (status, jenis, level), Error dengan code dari katalog (bagian 7).
- View per audiens, sebagai skema terpisah: CitizenReportView, OfferView, UnitView,
  DispatcherView, IncidentSummary (dengan dispatchSummary dan attentionReasons[]),
  sesuai bagian 4 dan penyesuaian di dashboard §16.
- securitySchemes: bearerAuth. Ekstensi: x-permission (kode permission), x-policy
  (lead|related|own), x-idempotent, x-rate-limit, x-audit.
- Header umum: Idempotency-Key, X-Request-Id, Retry-After. Parameter: cursor, limit, sort.
- Contoh (examples) dari dokumen. Jangan membuat contoh JSON lengkap di sini (itu 0c).
- contracts/.spectral.yaml: aturan (semua operasi punya x-permission kecuali endpoint
  publik, respons galat memakai ErrorEnvelope, operationId unik).
- Skrip pemeriksaan cakupan (contracts/scripts/check-coverage): mem-parse tabel endpoint
  di docs/spec/rest-api-aplikasi-darurat.md dan membandingkannya dengan paths di
  openapi.yaml. Selisih apa pun = gagal. Sambungkan ke `make contract`.

Acuan: REST §1-9 (konvensi, auth, permission, view, endpoint, transisi, error, rate limit,
audit); dashboard §16 (penyesuaian kontrak).

Selesai bila:
- `make contract` hijau: lint Spectral lulus dan cakupan 100% terhadap tabel endpoint.
- Setiap permission di katalog (REST §3) dipakai oleh minimal satu operasi.

Batasan:
- Jangan mengarang endpoint/field yang tidak ada di dokumen. Bila ada celah atau
  pertentangan, catat di docs/CONTRACT_CHANGES.md, JANGAN diselesaikan sendiri.
- Berhenti setelah 0b dan laporkan ringkasan (jumlah operasi, jumlah skema, daftar
  catatan di CONTRACT_CHANGES.md). Jangan lanjut ke 0c.
```

---

## Prompt 0c: AsyncAPI, contoh JSON, mock server

```
Konteks:
Fase 0a dan 0b selesai. Baca AGENTS.md, handoff bagian 6.4 dan 6.5, lalu
docs/spec/websocket-aplikasi-darurat.md dan docs/spec/fcm-aplikasi-darurat.md (bagian 4-5).

Tugas: Fase 0, bagian 0c.
1. contracts/asyncapi.yaml (AsyncAPI 3): satu pesan per event di katalog WebSocket
   (bagian 5), dengan amplop (eid, id, type, v, ts, class, ackRequired, data).
   Ekstensi: x-rooms (audiens), x-class (kelas pengiriman), x-fcm (padanan pesan FCM bila ada).
   Pesan klien -> server: ack, auth.refresh, app.state, unit.location.
2. contracts/examples/ sesuai handoff 6.5 (struktur dan 8 aturan isi contoh):
   - rest/<operationId>.<variasi>.json dan rest/errors/<code>.json
   - ws/<event.type>.<audiens>.json
   Data memakai seed fiktif (docs/spec/seed-demo-aplikasi-darurat.md). Sertakan varian
   field null/tidak ada, semua nilai enum, daftar dengan >1 elemen, contoh page.
   Contoh ini adalah bahan quicktype untuk model Dart (dibuat pemilik proyek).
3. Perluas `make contract`: validasi SEMUA contoh terhadap skema OpenAPI/AsyncAPI;
   setiap operasi punya >= 1 contoh sukses; setiap kode galat punya contoh; setiap event
   punya contoh untuk tiap audiens di x-rooms; pemeriksaan cakupan katalog event WebSocket.
4. Mock server dari kontrak (mis. Prism) yang mengembalikan contoh tersebut, dengan
   target `make mock`. Dashboard dan mobile memakainya sebelum backend selesai.
5. contracts/README.md: cara memakai kontrak, contoh, mock server, dan petunjuk singkat
   quicktype untuk pemilik proyek.

Selesai bila:
- `make contract` hijau, termasuk validasi contoh dan cakupan event.
- `make mock` menjawab semua endpoint dengan contoh yang valid.
- docs/PROGRESS.md Fase 0 lengkap; daftar pertanyaan dan usulan perubahan kontrak
  dikelompokkan di docs/QUESTIONS.md dan docs/CONTRACT_CHANGES.md.

Batasan:
- Jangan membuat model Dart (keputusan D-002).
- Jangan mengarang event/field. Catat celah di CONTRACT_CHANGES.md.
- Setelah selesai: BERHENTI di titik tinjau C0 dan tunggu persetujuan pemilik proyek
  atas openapi.yaml, asyncapi.yaml, dan contoh. Jangan mulai Fase 1.
```

---

## Setelah 0c: titik tinjau C0 (untuk Anda)

Periksa:
1. `docs/CONTRACT_CHANGES.md`: setiap usulan perubahan, setujui atau tolak (catat di `docs/DECISIONS.md`).
2. `docs/QUESTIONS.md`: jawab yang memblokir.
3. Contoh acak 5-10 berkas di `contracts/examples/` terhadap dokumen REST/WebSocket.
4. `make up`, `make contract`, `make mock` dari klon bersih.

Bila disetujui, lanjut ke **Fase 1** dengan templat instruksi di handoff §3.3 (acuan: REST §1-3, §5.1-5.2, §5.12; seed §3-8, §12; ERD).
