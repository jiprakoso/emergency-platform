import { MigrationInterface, QueryRunner } from 'typeorm';

export class CoreTables1700000001000 implements MigrationInterface {
  name = 'CoreTables1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // regions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS regions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES regions(id),
        level varchar(16) NOT NULL,
        code varchar(32) UNIQUE,
        name varchar(150) NOT NULL,
        boundary geography(MultiPolygon,4326),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_regions_boundary ON regions USING GIST (boundary);`);

    // organizations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(32) UNIQUE,
        name varchar(150) NOT NULL,
        org_type varchar(32) NOT NULL,
        phone varchar(20),
        email varchar(150),
        address text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // units
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        code varchar(32) UNIQUE,
        name varchar(150) NOT NULL,
        unit_type varchar(32) NOT NULL,
        status varchar(16) NOT NULL,
        phone varchar(20),
        vehicle_plate varchar(16),
        capability_level varchar(16),
        last_location geography(Point,4326),
        last_location_at timestamptz,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_units_status CHECK (status IN ('AVAILABLE','DISPATCHED','EN_ROUTE','ON_SCENE','RETURNING','OFF_DUTY','MAINTENANCE'))
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_units_org ON units(organization_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_units_loc ON units USING GIST (last_location);`);

    // users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_type varchar(16) NOT NULL,
        full_name varchar(150) NOT NULL,
        phone varchar(20) UNIQUE NOT NULL,
        phone_verified_at timestamptz,
        email varchar(150),
        password_hash varchar(255),
        status varchar(16) NOT NULL DEFAULT 'ACTIVE',
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_users_type CHECK (user_type IN ('CITIZEN','STAFF'))
      )
    `);

    // auth_sessions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash varchar(255) NOT NULL,
        user_agent text,
        ip_address varchar(45),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // incidents (minimal)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_number varchar(32) UNIQUE,
        incident_type_id uuid,
        status varchar(24) NOT NULL,
        priority varchar(16) NOT NULL,
        lead_organization_id uuid REFERENCES organizations(id),
        verifier_user_id uuid REFERENCES users(id),
        location geography(Point,4326) NOT NULL,
        location_accuracy_m numeric(6,2),
        location_source varchar(16),
        description text,
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        verified_at timestamptz,
        resolved_at timestamptz,
        closed_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_incidents_status CHECK (status IN ('SUBMITTED','VERIFIED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','INVALID','DUPLICATE','CANCELLED'))
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_incidents_loc ON incidents USING GIST (location);`);

    // outbox_events
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id bigserial PRIMARY KEY,
        eid uuid NOT NULL,
        event_type varchar(40) NOT NULL,
        incident_id uuid,
        payload jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        attempts smallint NOT NULL DEFAULT 0,
        last_error text
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_events(id) WHERE processed_at IS NULL;`);

    // audit_logs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id bigserial PRIMARY KEY,
        actor_user_id uuid REFERENCES users(id),
        action varchar(64) NOT NULL,
        entity_type varchar(32) NOT NULL,
        entity_id uuid,
        before jsonb,
        after jsonb,
        ip_address varchar(45),
        user_agent text,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        request_id varchar(64)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incidents;`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_sessions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS users;`);
    await queryRunner.query(`DROP TABLE IF EXISTS units;`);
    await queryRunner.query(`DROP TABLE IF EXISTS organizations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS regions;`);
  }
}
