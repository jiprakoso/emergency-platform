.PHONY: up down migrate seed reset-live verify test lint contract demo-bots

up:
	@echo "Starting dev services..."
	docker compose -f infra/docker-compose.dev.yml up -d
	@echo "Services started (postgres+postgis, redis, minio)."

down:
	@echo "Stopping dev services..."
	docker compose -f infra/docker-compose.dev.yml down
	@echo "Services stopped."

migrate:
	@echo "migrate: belum diimplementasikan (Fase 1)."

seed:
	@echo "seed: belum diimplementasikan (Fase 1)."

reset-live:
	@echo "reset-live: belum diimplementasikan (Fase 6)."

verify:
	@echo "verify: belum diimplementasikan (Fase 1)."

test:
	@echo "test: belum diimplementasikan (Fase 1)."

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
