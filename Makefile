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
	@echo "lint: backend/dashboard belum diinisialisasi (Fase 0a). Akan diperbarui setelah inisialisasi."

contract:
	@echo "contract: openapi/asyncapi belum dibuat (Fase 0b-0c). Akan diperbarui."

demo-bots:
	@echo "demo-bots: belum diimplementasikan (Fase 6)."
