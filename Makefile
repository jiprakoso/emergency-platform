.PHONY: up down migrate migrate-revert seed reset-live verify test lint contract demo-bots

up:
	@echo "Starting dev services..."
	docker compose -f infra/docker-compose.dev.yml up -d postgres redis
	@docker compose -f infra/docker-compose.dev.yml up -d minio minio-init \
		|| echo "PERINGATAN: MinIO tidak dapat ditarik/dijalankan di lingkungan ini (keterbatasan registry); lanjut tanpa object storage."
	@echo "==> menunggu postgres siap"
	@i=0; until docker exec ep-postgres-dev pg_isready -U postgres >/dev/null 2>&1; do \
		i=$$((i+1)); if [ $$i -ge 30 ]; then echo "postgres tidak siap"; exit 1; fi; sleep 2; done
	@echo "==> menjalankan migrasi"
	$(MAKE) migrate
	@echo "==> menjalankan seed:base"
	$(MAKE) seed
	@echo "Services started (postgres+postgis, redis, minio)."

down:
	@echo "Stopping dev services..."
	docker compose -f infra/docker-compose.dev.yml down
	@echo "Services stopped."

migrate:
	@echo "==> menjalankan migrasi"
	cd backend && corepack pnpm migration:run

migrate-revert:
	@echo "==> membatalkan migrasi terakhir"
	cd backend && corepack pnpm migration:revert

seed:
	@echo "==> menjalankan seed:base"
	cd backend && corepack pnpm seed:base

reset-live:
	@echo "==> menjalankan seed:reset-live"
	cd backend && corepack pnpm seed:reset-live

verify:
	@echo "==> menjalankan seed:verify (V1-V11)"
	cd backend && corepack pnpm seed:verify

test:
	@echo "test: framework tes backend belum dipasang (lihat PROGRESS.md Fase 1)."

lint:
	@echo "==> lint backend"
	cd backend && corepack pnpm lint
	@echo "==> lint dashboard"
	cd dashboard && corepack pnpm lint
	@echo "lint selesai."

contract:
	@echo "==> spectral lint (openapi.yaml + asyncapi.yaml)"
	cd contracts/scripts && ./node_modules/.bin/spectral lint ../openapi.yaml -r ../.spectral.yaml --fail-severity warn
	cd contracts/scripts && ./node_modules/.bin/spectral lint ../asyncapi.yaml -r .spectral-asyncapi.js --fail-severity warn
	@echo "==> cakupan endpoint (dokumen <-> openapi)"
	python3 contracts/scripts/check-coverage.py
	@echo "==> cakupan event (dokumen <-> asyncapi)"
	python3 contracts/scripts/check-asyncapi-coverage.py
	@echo "==> validasi contoh JSON (contracts/examples)"
	cd contracts/scripts && node check-examples.mjs
	@echo "contract OK."

demo-bots:
	@echo "demo-bots: belum diimplementasikan (Fase 6)."
