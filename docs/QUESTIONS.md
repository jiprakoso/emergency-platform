# QUESTIONS.md

Pertanyaan agent yang dikelompokkan per fase. Format: `Q-001`, fase, pertanyaan, opsi, rekomendasi agent, dampak bila tidak dijawab, status (open/answered).

## Fase 0 — semua DIJAWAB 2026-10-28 (rekaman di `DECISIONS.md` bagian 0-1)

- Q-001 (0a): Manajer paket Node.js? → **Dijawab:** `pnpm` dipakai (sesuai handoff §15).
- Q-002 (0a): Lokasi docker-compose? → **Dijawab:** `infra/docker-compose.dev.yml` dipakai.
- Q-003 (0a): Nama target `make` bisa disesuaikan? → **Dijawab (D-007):** target sesuai AGENTS.md dipertahankan tanpa perubahan.
- Q-004 (0a): Konfirmasi TypeORM + raw SQL PostGIS? → **Dijawab (D-001):** dikonfirmasi.
- Q-005 (0a): CI provider belum diputuskan → **Dijawab (D-008):** GitHub Actions (Linux, dukungan Docker, citra di GHCR); semua pemeriksaan tetap ada di target `make`.

Pertanyaan lain yang terjawab 2026-10-28: judul kontrak **C0** disetujui, `CC-003`..`CC-006` disetujui penerapannya, `A-018` (penamaan env) diputuskan — lihat `DECISIONS.md` bagian 0 dan `CONTRACT_CHANGES.md`.
