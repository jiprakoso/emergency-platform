# contracts/examples/

Contoh JSON yang dihasilkan otomatis oleh `scripts/gen-examples.py` dan divalidasi
oleh `scripts/check-examples.mjs` (dijalankan lewat `make contract`).

**Tujuan:** bahan untuk **quicktype** — pemilik proyek membuat model Dart dari
contoh di sini (lihat `DECISIONS.md` D-002). Agent tidak membuat model Dart.

## Struktur

- `rest/<operationId>[.<variasi>].json` — **bentuk lengkap respons sukses**
  (amplop `data` + `page`/field tambahan bila ada), bukan hanya isi `data`.
- `rest/errors/<ErrorCode>.json` — contoh galat (amplop `{ error: { ... } }`).
- `ws/<event>.<audiens>[.<class>].json` — payload event WebSocket:
  - peristiwa s2c memakai **amplop event lengkap** (`eid/id/type/v/ts/.../data`);
  - perintah c2s (`ack`, `auth.refresh`, `app.state`, `unit.location`) memakai
    **isi `data`** (yang dikirim klien).
  - `<audiens>` = jenis room (`dispatcher`, `supervisor`, `org`, `unit`, `user`,
    `region`, `incident`, `connection`, `all`). Placeholder id tidak dipakai.
  - `.critical`/`.standard` hanya muncul untuk event berkelas `DYNAMIC`
    (`alert.published`).

## Aturan

- Data memakai seed fiktif (`docs/specs/seed-demo-aplikasi-darurat.md`); **tanpa PII nyata**.
- `OfferView` sengaja tanpa lokasi presisi/kontak pelapor (privasi).
- Jangan mengarang field. Bila perlu field baru, ubah kontrak + dokumen dulu
  (`docs/CONTRACT_CHANGES.md`).

## Regenerasi

```
python3 contracts/scripts/gen-examples.py   # tulis ulang contracts/examples/
cd contracts/scripts && node check-examples.mjs
```
