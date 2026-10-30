import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q-008 / CC-012 / CC-014 (diputuskan pemilik 2026-10-30):
 * - `attachments.kind` mengikuti kontrak C0: `IMAGE|VIDEO|DOCUMENT` (dulu `PHOTO|VIDEO`).
 * - Syarat relasi `chk_attachments_relation` dihapus: lampiran boleh belum terkait
 *   report/incident/dispatch, baik `PENDING` maupun `CONFIRMED` (REST §5.3: unggah dulu,
 *   lalu `ownerId` atau `attachmentIds` di `POST /reports`). Lampiran yatim dibersihkan
 *   job; kepemilikan dijaga lewat `uploaded_by`.
 * - CC-008: `notifications.kind` ditambah `REPORT_UPDATE` (sebelumnya diedit langsung
 *   di migrasi 1700000001000 setelah diterapkan; dipindah ke sini).
 */
export class AttachmentsKindRelation1700000002000 implements MigrationInterface {
  name = 'AttachmentsKindRelation1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE attachments DROP CONSTRAINT attachments_kind_check`);
    await queryRunner.query(`UPDATE attachments SET kind = 'IMAGE' WHERE kind = 'PHOTO'`);
    await queryRunner.query(
      `ALTER TABLE attachments ADD CONSTRAINT attachments_kind_check CHECK (kind IN ('IMAGE','VIDEO','DOCUMENT'))`,
    );

    await queryRunner.query(`ALTER TABLE attachments DROP CONSTRAINT chk_attachments_relation`);

    await queryRunner.query(`ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check`);
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('DISPATCH_OFFER','INCIDENT_UPDATE','ALERT','RESOURCE_REQUEST','SYSTEM','REPORT_UPDATE'))
    `);
  }

  /**
   * Turun bersifat lossy: `IMAGE`/`DOCUMENT` → `PHOTO`, `REPORT_UPDATE` → `INCIDENT_UPDATE`,
   * dan lampiran tanpa relasi dihapus (unggahan yatim, toh dibersihkan job).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check`);
    await queryRunner.query(`UPDATE notifications SET kind = 'INCIDENT_UPDATE' WHERE kind = 'REPORT_UPDATE'`);
    await queryRunner.query(`
      ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('DISPATCH_OFFER','INCIDENT_UPDATE','ALERT','RESOURCE_REQUEST','SYSTEM'))
    `);

    await queryRunner.query(
      `DELETE FROM attachments WHERE incident_id IS NULL AND report_id IS NULL AND dispatch_id IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE attachments ADD CONSTRAINT chk_attachments_relation
        CHECK (incident_id IS NOT NULL OR report_id IS NOT NULL OR dispatch_id IS NOT NULL)
    `);

    await queryRunner.query(`ALTER TABLE attachments DROP CONSTRAINT attachments_kind_check`);
    await queryRunner.query(`UPDATE attachments SET kind = 'PHOTO' WHERE kind IN ('IMAGE','DOCUMENT')`);
    await queryRunner.query(`ALTER TABLE attachments ADD CONSTRAINT attachments_kind_check CHECK (kind IN ('PHOTO','VIDEO'))`);
  }
}
