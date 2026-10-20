# ASUMPTIONS.md

Daftar asumsi yang diambil agent ketika dokumen tidak eksplisit. Format: `A-001`, `A-002`, ...

## A-001: Lokasi berkas meta
- `DECISIONS.md` berada di `docs/DECISIONS.md` (sesuai struktur-direktori.md). 
- Berkas meta lain (`ASSUMPTIONS.md`, `CONTRACT_CHANGES.md`, `QUESTIONS.md`, `PROGRESS.md`) juga di `docs/`.

## A-002: Struktur direktori
Mengacu pada `docs/specs/struktur-direktori.md` v1. Folder kosong diberi `.gitkeep`.

## A-003: Environment development
Menggunakan `docker-compose.dev.yml` di `infra/` untuk Postgres+PostGIS, Redis, MinIO (sesuai deployment-dev). Backend/dashboard juga bisa dijalankan via compose.

## A-004: Bentuk berkas contoh JSON (full body)
Berkas `contracts/examples/rest/<opId>[.<variasi>].json` berisi **bentuk lengkap
respons sukses** (amplop `data` + `page`/field tambahan bila ada), bukan hanya isi
`data`. Alasan: aturan handoff §6.5 #4 mewajibkan contoh `page`, dan #8 meminta
validasi langsung terhadap skema respons. Konsekuensi: model quicktype dibangkitkan
dari bentuk ini (termasuk `data`/`page`) — pemilik dapat membangkitkan tipe per
lapisan bila perlu.

## A-005: Format peristiwa WS di contoh
Peristiwa s2c ditulis dengan **amplop event lengkap** (`eid/id/type/v/ts/.../data`),
sesuai `EventEnvelope`. Perintah c2s (`ack`, `auth.refresh`, `app.state`,
`unit.location`) ditulis sebagai **isi `data`** (yang dikirim klien).

## A-006: Nama berkas audiens WS
Token audiens = jenis room (`dispatcher`, `supervisor`, `org`, `unit`, `user`,
`region`, `incident`, `connection`; `*` → `all`). Placeholder id (`{id}`, dst.)
tidak dipakai di nama berkas. Event berkelas `DYNAMIC` diberi sufiks `.critical`
dan `.standard`.

## A-007: Kelas pengiriman event yang tidak disebut dokumen WS §7
Event `connection.*`, `system.notice`, `report.timeline_updated`, dan
`unit.location_updated` tidak disebut di tabel kelas §7. Diasumsikan: `connection.*`
= per-koneksi (tidak via FCM), `system.notice` = INFO, `report.timeline_updated` =
STANDARD, `unit.location_updated` = INFO. Menunggu konfirmasi pada titik tinjau C0.

## A-008: Kontak AsyncAPI
`info.contact` tanpa email (aturan lint `asyncapi-info-contact-properties`
dimatikan) karena belum ada email resmi proyek. Diperbarui saat info kontak tersedia.

## A-009: Field respons tak-tertiping
Untuk endpoint yang di kontrak bertipe `object` longgar (alerts, notifications,
events, incident-types, roles, settings, shifts, condition-reports, auth sessions),
contoh memakai field minimal yang disebut dokumen REST. Usulan pengetatan dicatat
di `CONTRACT_CHANGES.md` (CC-006).
