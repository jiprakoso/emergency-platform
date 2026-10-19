# ASUMPTIONS.md

Daftar asumsi yang diambil agent ketika dokumen tidak eksplisit. Format: `A-001`, `A-002`, ...

## A-001: Lokasi berkas meta
- `DECISIONS.md` berada di `docs/DECISIONS.md` (sesuai struktur-direktori.md). 
- Berkas meta lain (`ASSUMPTIONS.md`, `CONTRACT_CHANGES.md`, `QUESTIONS.md`, `PROGRESS.md`) juga di `docs/`.

## A-002: Struktur direktori
Mengacu pada `docs/specs/struktur-direktori.md` v1. Folder kosong diberi `.gitkeep`.

## A-003: Environment development
Menggunakan `docker-compose.dev.yml` di `infra/` untuk Postgres+PostGIS, Redis, MinIO (sesuai deployment-dev). Backend/dashboard juga bisa dijalankan via compose.
