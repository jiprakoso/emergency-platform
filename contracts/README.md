# contracts/

Kontrak mesin-baca untuk aplikasi sampel:

- `openapi.yaml` - REST API (OpenAPI 3.1) - dibuat Fase 0b
- `asyncapi.yaml` - WebSocket events (AsyncAPI 3.1.0) - dibuat Fase 0c
- `.spectral.yaml` - aturan lint OpenAPI
- `scripts/.spectral-asyncapi.js` - aturan lint AsyncAPI
- `examples/` - contoh JSON untuk quicktype (model Dart dibuat pemilik proyek); lihat `examples/README.md`
- `scripts/` - generator + pemeriksaan cakupan (`make contract`)  - `gen-asyncapi.py`, `gen-examples.py` - generator
  - `check-coverage.py`, `check-asyncapi-coverage.py`, `check-examples.mjs` - pemeriksa
