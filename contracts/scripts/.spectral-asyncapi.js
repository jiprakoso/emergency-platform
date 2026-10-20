// Ruleset lint untuk contracts/asyncapi.yaml (AsyncAPI 3.1).
// Dipakai: pnpm --dir contracts/scripts lint:asyncapi
const { asyncapi } = require('@stoplight/spectral-rulesets');

module.exports = {
  extends: [asyncapi],
  rules: {
    // Kontak hanya memakai nama + URL repo. Alamat email resmi proyek belum ditetapkan
    // pemilik (tercatat di docs/ASSUMPTIONS.md), sengaja tidak dikarang.
    'asyncapi-info-contact-properties': 'off',
  },
};
