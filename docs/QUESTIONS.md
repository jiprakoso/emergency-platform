# QUESTIONS.md

Pertanyaan agent yang dikelompokkan per fase. Format: `Q-001`, fase, pertanyaan, opsi, rekomendasi agent, dampak bila tidak dijawab, status (open/answered).

## Fase 0 — semua DIJAWAB 2026-10-28 (rekaman di `DECISIONS.md` bagian 0-1)

- Q-001 (0a): Manajer paket Node.js? → **Dijawab:** `pnpm` dipakai (sesuai handoff §15).
- Q-002 (0a): Lokasi docker-compose? → **Dijawab:** `infra/docker-compose.dev.yml` dipakai.
- Q-003 (0a): Nama target `make` bisa disesuaikan? → **Dijawab (D-007):** target sesuai AGENTS.md dipertahankan tanpa perubahan.
- Q-004 (0a): Konfirmasi TypeORM + raw SQL PostGIS? → **Dijawab (D-001):** dikonfirmasi.
- Q-005 (0a): CI provider belum diputuskan → **Dijawab (D-008):** GitHub Actions (Linux, dukungan Docker, citra di GHCR); semua pemeriksaan tetap ada di target `make`.

Pertanyaan lain yang terjawab 2026-10-28: judul kontrak **C0** disetujui, `CC-003`..`CC-006` disetujui penerapannya, `A-018` (penamaan env) diputuskan — lihat `DECISIONS.md` bagian 0 dan `CONTRACT_CHANGES.md`.

## Fase 2 — terbuka

- Q-006 (2a, 2026-10-30): **Persetujuan C1**. Review kode + verifikasi ulang menemukan bahwa koreksi klaim 2a tanggal 2026-10-29 tidak akurat (bentuk respons belum sesuai kontrak: `dispatchSummary`/`attentionReasons` tidak pernah dikirim, `reporter`/`attachments` hardcode, `GET /incidents` tanpa filter; `reveal-contact` tanpa `@RequirePermission`/audit; filter pemilik laporan tidak berfungsi; rekomendasi memakai ID karangan). Status di PROGRESS.md ditarik ke "DALAM GERBANG". Opsi: (a) setujui daftar "Sisa 2a" di PROGRESS.md sebagai pekerjaan penutup gerbang Fase 2, lalu review ulang; (b) prioritaskan sebagian item saja (mis. hanya isu PII/keamanan — visibilitas/reveal-contact) dan sisanya ke Fase berikutnya. Rekomendasi agent: (a). Dampak bila tidak dijawab: Fase 3 tidak boleh dimulai (aturan AGENTS.md #13).
- Q-007 (2a, 2026-10-30): Nasib berkas WIP `backend/src/sim/` (untracked). Sudah dihapus 2026-10-30 karena melanggar aturan #4 (tulis dispatch langsung ke DB, bukan via REST) dan status tidak sesuai kontrak. Rekomendasi agent: bangun sim:bot di Fase 3 melalui API (sesuai `seed-demo-aplikasi-darurat.md`). Konfirmasi bila berbeda pendapat.
- Q-008 (2b, 2026-10-30): Nilai `attachments.kind` + relasi lampiran + migrasi yang diedit di tempat (CC-012/CC-014). → **Dijawab 2026-10-30 (D-014):** `IMAGE|VIDEO|DOCUMENT` sesuai kontrak; syarat relasi lampiran dihapus (PENDING maupun CONFIRMED boleh belum terkait — jalur `attachmentIds` di `POST /reports` butuh lampiran terkonfirmasi sebelum laporan ada); berkas `1700000001000` dikembalikan, perubahan lewat migrasi `1700000002000`. Status: answered.
