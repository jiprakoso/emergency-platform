# Struktur Direktori Repositori

> Status: draft v1. Tanggal: 5 Oktober 2026.
> Gabungan struktur dari seluruh dokumen spesifikasi, **tanpa detail Flutter** (lihat `flutter-aplikasi-darurat.md` §3 untuk `mobile/`).
> Tanda `(usulan)` = penataan yang belum tertulis eksplisit di dokumen sumber dan boleh diubah di Fase 0 (keputusan D-007 di `DECISIONS.md`).
> Dokumen sumber: `handoff-agent-code-aplikasi-darurat.md` §4 dan §9.1, `dashboard-aplikasi-darurat.md` §3, `seed-demo-aplikasi-darurat.md` §2, `deployment-aplikasi-darurat.md` §4 dan §9.

---

## 1. Akar repositori

```
emergency-platform/
├── AGENTS.md                    # konteks ringkas untuk agent (wajib dibaca)
├── CLAUDE.md                    # menunjuk AGENTS.md
├── Makefile                     # target standar: up, down, migrate, seed, reset-live,
│                                # verify, test, lint, contract, demo-bots
├── docs/
├── contracts/
├── backend/
├── dashboard/
├── mobile/                      # Flutter: flavor citizen dan staff (struktur di dokumen Flutter)
├── infra/
└── .github/ (atau CI setara)    # dibuat setelah keputusan D-008 (repositori dan CI)
```

---

## 2. `docs/`

```
docs/
├── spec/                                   # salinan dokumen spesifikasi (nama tetap)
│   ├── konsep-aplikasi-darurat.md
│   ├── erd-aplikasi-darurat.md
│   ├── rest-api-aplikasi-darurat.md
│   ├── websocket-aplikasi-darurat.md
│   ├── fcm-aplikasi-darurat.md
│   ├── flutter-aplikasi-darurat.md
│   ├── dashboard-aplikasi-darurat.md
│   ├── seed-demo-aplikasi-darurat.md
│   ├── handoff-agent-code-aplikasi-darurat.md
│   ├── deployment-aplikasi-darurat.md
│   └── struktur-direktori.md               # dokumen ini
├── DECISIONS.md                 # keputusan pemilik proyek (dijaga manusia, agent hanya membaca)
├── CONTRACT_CHANGES.md          # usulan perubahan kontrak dari agent, menunggu keputusan
├── ASSUMPTIONS.md              # asumsi agent (A-001, ...)
├── QUESTIONS.md                 # pertanyaan agent yang dikelompokkan per fase
└── PROGRESS.md                  # laporan per fase
```

Catatan: `DECISIONS.md` berada di `docs/` (bukan di akar), sesuai dokumen serah terima.

---

## 3. `contracts/`

```
contracts/
├── openapi.yaml                 # REST, OpenAPI 3.1 (dibuat di Fase 0)
├── asyncapi.yaml                # WebSocket, AsyncAPI 3 (dibuat di Fase 0)
├── .spectral.yaml               # aturan lint kontrak
├── README.md
└── examples/                    # bahan quicktype untuk model Dart (keputusan D-002)
    ├── README.md                # petunjuk pemakaian quicktype
    ├── rest/
    │   ├── <operationId>.<variasi>.json     # mis. getDispatch.offerView.json
    │   └── errors/<code>.json               # contoh galat per kode
    └── ws/
        └── <event.type>.<audiens>.json      # mis. dispatch.offered.unit.json
```

---

## 4. `backend/` (NestJS)

```
backend/
├── package.json  tsconfig.json  nest-cli.json  Dockerfile  .env.example
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── common/
│   │   ├── config/              # variabel lingkungan divalidasi, gagal start bila tidak valid
│   │   ├── logger/              # pino + redaksi PII
│   │   ├── request-id/
│   │   ├── filters/             # filter galat → amplop error
│   │   ├── envelope/            # amplop respons {data} / {data, page}
│   │   ├── validation/
│   │   ├── idempotency/         # Idempotency-Key (Redis)
│   │   ├── pagination/          # kursor opaque
│   │   ├── rate-limit/
│   │   ├── clock/               # ClockService (dapat disuntikkan untuk tes)
│   │   ├── errors/              # katalog kode galat (konstanta)
│   │   └── geo/                 # util geo
│   │
│   ├── database/
│   │   ├── migrations/          # tanpa synchronize; SQL mentah untuk PostGIS (D-001)
│   │   ├── entities/
│   │   └── base.repository.ts
│   │
│   ├── modules/
│   │   ├── auth/                # + providers/ (otp.provider: mock / nyata)
│   │   ├── users/
│   │   ├── staff/
│   │   ├── roles-permissions/
│   │   ├── organizations/
│   │   ├── units/
│   │   ├── regions/
│   │   ├── incident-types/
│   │   ├── settings/
│   │   ├── config-public/
│   │   ├── reports/
│   │   ├── attachments/
│   │   ├── incidents/
│   │   ├── dispatches/
│   │   ├── resource-requests/
│   │   ├── alerts/
│   │   ├── notifications/       # + providers/ (fcm.provider, mock.provider), delivery-policy
│   │   ├── devices/             # token FCM + langganan topic
│   │   ├── realtime/            # gateway, rooms, projectors/, presence, ack
│   │   ├── sync/                # /sync/events, /sync/snapshot
│   │   ├── outbox/              # (usulan) penulis outbox + pengirim (pekerja)
│   │   ├── shifts/
│   │   ├── dashboard/
│   │   ├── audit/
│   │   └── health/
│   │
│   ├── jobs/                    # prosesor BullMQ lintas modul
│   │   ├── offer-timeout  offer-resend  offer-unseen  offer-sweeper
│   │   ├── incident-escalation  incident-autoclose  lock-release
│   │   ├── attachment-cleanup  topic-reconcile  fcm-send
│   │   └── outbox-dispatcher  retention
│   │
│   ├── seed/
│   │   ├── cli.ts               # penjaga: menolak berjalan bila ENV=prod
│   │   ├── data/                # regions, organizations, units, roles-permissions,
│   │   │                        # accounts, incident-types, settings
│   │   ├── profiles/            # base, history, reset-live
│   │   └── verify/              # pemeriksaan V1-V14
│   │
│   └── sim/
│       ├── cli.ts
│       ├── bot/                 # sim:bot (accept / reject / silent / flaky)
│       ├── flood/               # sim:flood
│       └── citizen/             # sim:citizen
│
└── test/
    ├── integration/             # PostgreSQL+PostGIS, Redis, MinIO sungguhan
    ├── scenarios/               # S1-S8, W1-W13, F1-F15
    ├── contract/                # respons vs skema OpenAPI; contoh vs respons nyata
    └── fixtures/
```

### 4.1 Pola satu modul

Contoh `incidents/` (modul lain mengikuti pola yang sama):

```
modules/incidents/
├── incidents.module.ts
├── controllers/                 # tipis: DTO, guard izin, panggil service, serializer view
├── services/                    # logika bisnis dan batas transaksi
├── repositories/                # query + SQL PostGIS mentah; konversi {lat,lng} ↔ (lng,lat)
├── dto/
├── views/                       # DispatcherView, UnitView, ... (satu-satunya aturan visibilitas)
├── policies/                    # lead / related / own
├── domain/                      # (usulan) incident.state-machine.ts, tabel transisi
├── events/
└── jobs/
```

Aturan lapisan (dari dokumen serah terima §9.2): controller tipis → service (satu use case = satu transaksi berisi perubahan data + `incident_events` + `outbox_events` + `audit_logs`) → repository. Mesin status dan kebijakan terpisah dan diuji penuh. Serializer view dipakai bersama oleh REST, proyeksi WebSocket, dan payload FCM.

---

## 5. `dashboard/` (Vite + React + TypeScript)

```
dashboard/
├── index.html  vite.config.ts  tsconfig.json  package.json  .env.example
├── public/
│   └── sounds/                  # chime_new.mp3, alarm_critical.mp3, ack.mp3
├── e2e/                         # Playwright (D1-D20)
└── src/
    ├── main.tsx
    ├── app/
    │   ├── App.tsx  router.tsx
    │   ├── providers/           # Query, Auth, Realtime, Theme, Toast
    │   ├── layouts/             # AuthLayout, ConsoleLayout, AdminLayout
    │   └── guards/              # RequireAuth, RequirePermission
    ├── config/                  # env.ts, permissions.ts, statuses.ts, constants.ts
    ├── api/
    │   ├── client.ts            # Axios + interceptor (auth, refresh single-flight, request-id)
    │   ├── errors.ts  errorMessages.ts  queryKeys.ts
    │   ├── types/               # kelak dihasilkan dari OpenAPI
    │   └── endpoints/           # auth, incidents, dispatches, reports, resourceRequests,
    │                            # alerts, organizations, units, staff, shifts, dashboard,
    │                            # sync, settings, audit, reference
    ├── realtime/
    │   ├── socket.ts  envelope.ts  eventRouter.ts  sync.ts  dedupe.ts  batcher.ts
    │   └── handlers/            # incident, dispatch, resourceRequest, alert, session, system
    ├── stores/                  # Zustand: auth, connection, attention, shift, ui, clock
    ├── features/                # fitur tidak saling mengimpor
    │   ├── auth/
    │   ├── console/             # ConsolePage, QueuePanel, WorkspacePanel, AttentionPanel, ContextPanel
    │   ├── incidents/           # components/, tabs/, dialogs/, hooks/
    │   ├── manualReport/
    │   ├── dispatch/            # DispatchComposer, RecommendationList, OnBehalfDialog, ...
    │   ├── resourceRequests/
    │   ├── alerts/
    │   ├── shift/
    │   ├── dashboard/
    │   └── admin/               # organizations, units, staff, roles, settings, audit
    ├── services/                # alarm, desktopNotify, titleBadge, clock, shortcuts, maskPii
    ├── components/              # ui/ (shadcn), map/, common/
    ├── hooks/  lib/  i18n/  styles/
    └── test/                    # setup, mock MSW, tiruan WebSocket
```

Aturan: event WebSocket hanya boleh mengubah cache dan store di `realtime/handlers/`. `api/endpoints/*` hanya berisi fungsi pemanggil bertipe.

---

## 6. `infra/`

```
infra/
├── docker-compose.yml           # dev (Fase 0): postgres+postgis, redis, minio, backend, dashboard
├── env/                         # contoh .env per komponen
├── nginx/                       # reverse proxy (dev/staging)
├── scripts/                     # skrip bantu (mis. inisialisasi bucket MinIO)
│
│   # Fase 7, setelah sampel disetujui (penataan usulan):
├── prod/
│   ├── compose/                 # Compose produksi per peran (edge, api, worker, data)
│   ├── ansible/                 # provisioning dan konfigurasi (bagian 9.2 dokumen deployment)
│   ├── terraform/               # bila penyedia mendukung
│   └── backup/                  # pgBackRest, uji pemulihan
├── monitoring/                  # Prometheus, Alertmanager, Grafana, Loki
└── runbooks/                    # failover DB/Redis, backlog outbox, alert keliru, DR, dll.
```

---

## 7. Aturan Umum

- Setiap aplikasi (`backend`, `dashboard`, `mobile`) **mandiri**, dengan manajer paketnya sendiri. Tidak ada kode bersama lintas aplikasi selain **kontrak** (dan tipe yang dihasilkan darinya).
- Perubahan yang menyentuh kontrak ikut memperbarui `contracts/*` dan dokumen di `docs/spec/` dalam commit yang sama.
- Fase 0-6 hanya memakai Compose dev. Isi `infra/prod/`, `infra/monitoring/`, dan `infra/runbooks/` dikerjakan pada Fase 7.
- Model Dart (`mobile/lib/models/**`) dibuat pemilik proyek dengan quicktype dari `contracts/examples/`, bukan oleh agent.
- Nama folder dan target `make` dapat diubah di Fase 0 (D-007). Seluruh pemeriksaan CI dipanggil lewat target `make`, sehingga perubahan nama cukup di satu tempat.
