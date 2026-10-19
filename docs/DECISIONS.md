# DECISIONS.md: Keputusan Pemilik Proyek

> Diisi dan dijaga oleh pemilik proyek. Agent **membaca** berkas ini sebelum bekerja dan **tidak mengubah keputusan** di dalamnya. Usulan perubahan masuk ke `docs/CONTRACT_CHANGES.md`.
> Pemilik keputusan: **pemilik proyek (satu orang)**.
> Terakhir diperbarui: 5 Oktober 2026

## 1. Keputusan yang sudah ditetapkan

| ID | Keputusan | Dampak bagi agent |
|---|---|---|
| D-001 | **ORM: TypeORM**, dengan **SQL mentah untuk seluruh logika geospasial (PostGIS)**. Alasan: dukungan pustaka geospasial terbatas, SQL manual lebih terkendali | Query PostGIS (jarak, radius, `ST_Covers`, rekomendasi unit, geofence) ditulis sebagai SQL mentah di repository, diberi komentar dan diuji. Jangan mencari pustaka geospasial tambahan |
| D-002 | **Model Dart dibuat oleh pemilik proyek** memakai **quicktype** dari contoh JSON keluaran API | Agent **tidak membuat** model Dart. Agent wajib menyediakan **contoh JSON lengkap** di `contracts/examples/` (lihat handoff §6.4) sebagai bahan quicktype |
| D-003 | **Penanggung jawab keputusan: pemilik proyek sendiri** | Pertanyaan agent dikumpulkan (bukan menyela terus-menerus), lihat handoff §13.3 |
| D-004 | State management Flutter: **GetX**. Struktur: **models / views / controllers / services** | Sudah tertuang di dokumen Flutter |
| D-005 | Dashboard web: **Vite + React** | Sudah tertuang di dokumen dashboard |
| D-006 | Cakupan: **aplikasi sampel** untuk didemokan. Poin yang butuh keputusan client memakai default dan ditanyakan setelah sampel | Gunakan bagian "Asumsi Default" tiap dokumen |

## 2. Keputusan yang belum diketahui pemilik (default berlaku sementara)

| ID | Hal | Default sementara | Mengapa aman | Kapan ditetapkan |
|---|---|---|---|---|
| D-007 | Nama target `make` dan struktur repositori | Seperti handoff §4-5 (monorepo `backend/ dashboard/ mobile/ contracts/ infra/ docs/`, target `make up/test/lint/contract/...`) | Murah diubah (penamaan dan folder). Seluruh pekerjaan memanggil target `make`, sehingga mengganti nama cukup di satu tempat | Sebelum Fase 0 selesai (C0) |
| D-008 | Tempat repositori dan alat CI | Agent menulis **CI-agnostik**: seluruh pemeriksaan ada di target `make` (`lint`, `test`, `contract`). Berkas CI khusus penyedia dibuat **setelah** keputusan | Tidak ada pekerjaan yang terkunci pada GitHub/GitLab tertentu | Setelah pertanyaan di bagian 3 terjawab |

## 3. Pertanyaan yang akan Anda ajukan (menunggu jawaban)

| ID | Pertanyaan | Mengapa penting |
|---|---|---|
| Q-001 | Di mana kode akan disimpan (GitHub, GitLab, Bitbucket, atau server sendiri)? | Menentukan berkas CI dan cara kerja pull request |
| Q-002 | Apakah runner CI mendukung Docker (diperlukan untuk PostgreSQL+PostGIS, Redis, MinIO saat tes integrasi)? | Tes integrasi memakai layanan sungguhan, bukan tiruan |
| Q-003 | Sistem operasi mesin pengembang (Linux/macOS/Windows)? | `Makefile` nyaman di Linux/macOS. Di Windows tanpa WSL perlu alternatif (`just`/skrip npm) |
| Q-004 | Tempat menyimpan citra Docker (container registry) bila diperlukan | Untuk menyimpan build backend/dashboard |
| Q-005 | Kebijakan cabang dan peninjauan (siapa menyetujui perubahan) | Karena pemilik keputusan satu orang, perlu ditetapkan apakah agent boleh menggabung sendiri setelah gerbang lulus |

### Pertanyaan deployment (untuk instansi/stakeholder, sebelum Fase 7)

| ID | Pertanyaan | Mengapa penting |
|---|---|---|
| Q-101 | Di mana sistem dihosting (pusat data pemda, penyedia domestik, lainnya) dan apakah ada situs kedua untuk DR? | Menentukan topologi, biaya, dan kepatuhan penempatan data |
| Q-102 | Siapa penyelenggara/pemilik sistem elektronik ini secara hukum, dan siapa mengurus pendaftaran serta penilaian dampak pelindungan data? | Menentukan kewajiban hukum dan lokasi data |
| Q-103 | Siapa on-call 24 jam dan siapa penanggung jawab keputusan darurat (pengalihan DR, rollback)? | Layanan darurat butuh jalur tanggung jawab yang jelas |
| Q-104 | Standar keamanan/sertifikasi yang wajib dipenuhi instansi? | Dapat menambah persyaratan teknis |
| Q-105 | Penyedia SMS yang sudah dipakai atau diizinkan pemda? | Dibutuhkan untuk OTP produksi |
| Q-106 | Kebijakan retensi data laporan dan lokasi? | Menentukan penyimpanan, anonimisasi, dan cadangan |
| Q-107 | Ponsel stakeholder dikelola (MDM) atau pribadi, dan bagaimana distribusi aplikasi staf (Play Store atau internal)? | Menentukan alarm, pengecualian baterai, dan rilis |
| Q-108 | Anggaran dan jangka waktu pilot? | Menentukan skala awal dan tahapan peluncuran |
| Q-109 | Sumber tile peta produksi (server sendiri, penyedia domestik, berlisensi)? | Tile publik OSM tidak untuk beban produksi |

## 4. Cara mengisi

Ketika sebuah pertanyaan terjawab, pindahkan barisnya ke bagian 1 dengan ID baru dan perbarui dokumen terkait di commit yang sama.
