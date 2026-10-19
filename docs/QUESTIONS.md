# QUESTIONS.md

Pertanyaan agent yang dikelompokkan per fase. Format: `Q-001`, fase, pertanyaan, opsi, rekomendasi agent, dampak bila tidak dijawab, status (open/answered).

## Fase 0
- Q-001 (0a): Manajer paket Node.js? Default: `pnpm` (disebut "pnpm 🔶" di handoff §15). Perlu konfirmasi atau pakai pnpm?
- Q-002 (0a): Lokasi docker-compose? Struktur menyebut `infra/docker-compose.yml`. Handoff deployment-dev menyebut `docker-compose.dev.yml`. Pakai `infra/docker-compose.dev.yml`?
- Q-003 (0a): Nama target make bisa disesuaikan? AGENTS.md bilang "Nama dapat disesuaikan di Fase 0, dan harus diperbarui di berkas ini". Saat ini AGENTS.md mencantumkan target: up/down/migrate/seed/reset-live/verify/test/lint/contract/demo-bots. Pertahankan?
- Q-004 (0a): ORM TypeORM sudah diputuskan (D-001). Konfirmasi penggunaan TypeORM + raw SQL PostGIS (tanpa pustaka geospasial tambahan).
- Q-005 (0a): CI provider belum diputuskan (D-008). Tetap CI-agnostik (hanya target make), jangan buat workflow GitHub Actions dulu?
