import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Skema lengkap sesuai docs/specs/erd-aplikasi-darurat.md (v1.3).
 * 31 tabel fase 1 + disaster_events (fase 2, FK nullable disiapkan).
 * Status/tipe memakai varchar + CHECK, bukan enum PostgreSQL (ERD §1).
 */
export class CoreSchema1700000001000 implements MigrationInterface {
  name = 'CoreSchema1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------- Wilayah ----------
    await queryRunner.query(`
      CREATE TABLE regions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES regions(id),
        level varchar(16) NOT NULL CHECK (level IN ('CITY','DISTRICT','VILLAGE')),
        code varchar(20) UNIQUE NOT NULL,
        name varchar(150) NOT NULL,
        boundary geography(MultiPolygon,4326),
        centroid geography(Point,4326),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_regions_boundary ON regions USING GIST (boundary);`);
    await queryRunner.query(`CREATE INDEX idx_regions_parent ON regions(parent_id);`);
    await queryRunner.query(`CREATE INDEX idx_regions_level ON regions(level);`);

    // ---------- Organisasi & unit ----------
    await queryRunner.query(`
      CREATE TABLE organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(24) NOT NULL CHECK (type IN ('COMMAND_CENTER','POLICE','FIRE','HOSPITAL','BPBD','AMBULANCE_SERVICE','PRIVATE_FIRE','DISHUB','OTHER')),
        name varchar(150) NOT NULL,
        code varchar(30) UNIQUE,
        phone varchar(20),
        address text,
        location geography(Point,4326),
        service_polygon geography(MultiPolygon,4326),
        is_active boolean NOT NULL DEFAULT true,
        meta jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_organizations_location ON organizations USING GIST (location);`);

    await queryRunner.query(`
      CREATE TABLE organization_service_areas (
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        PRIMARY KEY (organization_id, region_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        code varchar(30) NOT NULL,
        name varchar(100) NOT NULL,
        unit_type varchar(24) NOT NULL CHECK (unit_type IN ('AMBULANCE','FIRE_ENGINE','RESCUE_TEAM','ER','PATROL','OTHER')),
        plate_number varchar(15),
        status varchar(16) NOT NULL CHECK (status IN ('AVAILABLE','BUSY','OFFLINE','OUT_OF_SERVICE')),
        last_location geography(Point,4326),
        last_location_at timestamptz,
        is_active boolean NOT NULL DEFAULT true,
        meta jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, code)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_units_org_status ON units(organization_id, status);`);
    await queryRunner.query(`CREATE INDEX idx_units_location ON units USING GIST (last_location);`);

    // ---------- Identitas & akses ----------
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_type varchar(16) NOT NULL CHECK (user_type IN ('CITIZEN','STAFF')),
        full_name varchar(150) NOT NULL,
        phone varchar(20) UNIQUE NOT NULL,
        phone_verified_at timestamptz,
        email varchar(150),
        password_hash varchar(255),
        two_factor_enabled boolean NOT NULL DEFAULT false,
        two_factor_secret varchar(255),
        must_change_password boolean NOT NULL DEFAULT false,
        home_location geography(Point,4326),
        home_address text,
        home_region_id uuid REFERENCES regions(id),
        status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
        reputation_score smallint NOT NULL DEFAULT 0,
        last_login_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_users_home_location ON users USING GIST (home_location);`);
    await queryRunner.query(`CREATE INDEX idx_users_home_region ON users(home_region_id);`);
    await queryRunner.query(`CREATE INDEX idx_users_email ON users(email);`);

    await queryRunner.query(`
      CREATE TABLE staff_profiles (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES organizations(id),
        unit_id uuid REFERENCES units(id),
        employee_no varchar(50),
        position varchar(100),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_staff_profiles_org ON staff_profiles(organization_id);`);
    await queryRunner.query(`CREATE INDEX idx_staff_profiles_unit ON staff_profiles(unit_id);`);

    await queryRunner.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(32) UNIQUE NOT NULL,
        name varchar(100) NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(64) UNIQUE NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token_id uuid,
        refresh_token_hash varchar(255) NOT NULL,
        previous_token_hash varchar(255),
        ip_address varchar(45),
        user_agent text,
        platform varchar(10),
        app_flavor varchar(20),
        app_version varchar(20),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);`);
    await queryRunner.query(`CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);`);

    await queryRunner.query(`
      CREATE TABLE otp_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone varchar(20) NOT NULL,
        code_hash varchar(255) NOT NULL,
        purpose varchar(16) NOT NULL CHECK (purpose IN ('REGISTER','LOGIN','RESET')),
        attempts smallint NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        verified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_otp_requests_phone ON otp_requests(phone, created_at DESC);`);

    await queryRunner.query(`
      CREATE TABLE device_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fcm_token varchar(255) UNIQUE NOT NULL,
        platform varchar(10) NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
        app_flavor varchar(20) NOT NULL CHECK (app_flavor IN ('CITIZEN','STAFF')),
        app_version varchar(20),
        last_seen_at timestamptz,
        push_enabled boolean NOT NULL DEFAULT true,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_device_tokens_user ON device_tokens(user_id) WHERE revoked_at IS NULL;`);

    // ---------- Referensi ----------
    await queryRunner.query(`
      CREATE TABLE incident_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(40) UNIQUE NOT NULL,
        name varchar(100) NOT NULL,
        category varchar(24) NOT NULL CHECK (category IN ('TRAFFIC','FIRE','MEDICAL','NATURAL_DISASTER','OTHER')),
        default_lead_org_type varchar(24) CHECK (default_lead_org_type IS NULL OR default_lead_org_type IN ('POLICE','FIRE','BPBD','AMBULANCE_SERVICE','HOSPITAL','OTHER')),
        suggested_resources jsonb,
        allows_condition_report boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE system_settings (
        key varchar(100) PRIMARY KEY,
        value jsonb NOT NULL,
        description text,
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---------- Kejadian ----------
    // disaster_events (Fase 2, ERD §5.10) - dibuat lebih dulu karena incidents FK ke sini
    await queryRunner.query(`
      CREATE TABLE disaster_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(30) UNIQUE,
        category varchar(24),
        name varchar(200) NOT NULL,
        status varchar(16) CHECK (status IS NULL OR status IN ('WARNING','RESPONSE','RECOVERY','CLOSED')),
        level varchar(16),
        area geography(MultiPolygon,4326),
        lead_organization_id uuid REFERENCES organizations(id),
        started_at timestamptz,
        ended_at timestamptz,
        created_by uuid REFERENCES users(id),
        summary jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(24) UNIQUE NOT NULL,
        type_id uuid NOT NULL REFERENCES incident_types(id),
        status varchar(16) NOT NULL CHECK (status IN ('SUBMITTED','VERIFIED','IN_PROGRESS','RESOLVED','CLOSED','INVALID','DUPLICATE')),
        severity varchar(12) CHECK (severity IS NULL OR severity IN ('LOW','MEDIUM','HIGH','MASS')),
        escalation_level smallint,
        source varchar(20) NOT NULL CHECK (source IN ('MOBILE_APP','ADMIN_MANUAL','CALL_CENTER_112')),
        external_ref_id varchar(100),
        summary varchar(255),
        location geography(Point,4326) NOT NULL,
        location_accuracy_m real,
        address_text text,
        district_id uuid REFERENCES regions(id),
        village_id uuid REFERENCES regions(id),
        lead_organization_id uuid REFERENCES organizations(id),
        lead_set_at timestamptz,
        locked_by uuid REFERENCES users(id),
        locked_at timestamptz,
        lock_expires_at timestamptz,
        verified_by uuid REFERENCES users(id),
        verified_at timestamptz,
        invalid_reason text,
        duplicate_of_id uuid REFERENCES incidents(id),
        disaster_event_id uuid REFERENCES disaster_events(id),
        report_count int NOT NULL DEFAULT 0,
        flags jsonb,
        first_reported_at timestamptz NOT NULL DEFAULT now(),
        life_safety_done_at timestamptz,
        resolved_at timestamptz,
        closed_at timestamptz,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_incidents_location ON incidents USING GIST (location);`);
    await queryRunner.query(`CREATE INDEX idx_incidents_status_created ON incidents(status, created_at DESC);`);
    await queryRunner.query(`CREATE INDEX idx_incidents_active ON incidents(created_at) WHERE status IN ('SUBMITTED','VERIFIED','IN_PROGRESS');`);
    await queryRunner.query(`CREATE INDEX idx_incidents_district_status ON incidents(district_id, status);`);
    await queryRunner.query(`CREATE INDEX idx_incidents_type ON incidents(type_id);`);
    await queryRunner.query(`CREATE INDEX idx_incidents_lead ON incidents(lead_organization_id);`);
    await queryRunner.query(`CREATE INDEX idx_incidents_duplicate ON incidents(duplicate_of_id);`);

    await queryRunner.query(`
      CREATE TABLE incident_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id uuid REFERENCES incidents(id),
        suggested_incident_id uuid REFERENCES incidents(id),
        report_kind varchar(20) NOT NULL CHECK (report_kind IN ('HELP_REQUEST','CONDITION_REPORT')),
        type_id uuid NOT NULL REFERENCES incident_types(id),
        reporter_id uuid REFERENCES users(id),
        reporter_name varchar(150),
        reporter_phone varchar(20),
        entered_by uuid REFERENCES users(id),
        channel varchar(16) NOT NULL CHECK (channel IN ('APP','PHONE','WHATSAPP','SMS')),
        client_report_id uuid UNIQUE,
        location geography(Point,4326) NOT NULL,
        location_accuracy_m real,
        address_text text,
        description text,
        victim_hint varchar(10) CHECK (victim_hint IS NULL OR victim_hint IN ('UNKNOWN','ONE','TWO','MANY')),
        status varchar(12) NOT NULL CHECK (status IN ('NEW','LINKED','REJECTED','WITHDRAWN')),
        flags jsonb,
        device_info jsonb,
        occurred_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_incident_reports_incident ON incident_reports(incident_id);`);
    await queryRunner.query(`CREATE INDEX idx_incident_reports_reporter ON incident_reports(reporter_id, created_at DESC);`);
    await queryRunner.query(`CREATE INDEX idx_incident_reports_location ON incident_reports USING GIST (location);`);
    await queryRunner.query(`CREATE INDEX idx_incident_reports_condition ON incident_reports(created_at) WHERE incident_id IS NULL AND report_kind = 'CONDITION_REPORT';`);

    await queryRunner.query(`
      CREATE TABLE attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id uuid REFERENCES incidents(id),
        report_id uuid REFERENCES incident_reports(id),
        dispatch_id uuid,
        uploaded_by uuid REFERENCES users(id),
        kind varchar(10) NOT NULL CHECK (kind IN ('PHOTO','VIDEO','IMAGE','DOCUMENT')),
        status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED')),
        confirmed_at timestamptz,
        storage_key varchar(255) NOT NULL,
        mime_type varchar(100) NOT NULL,
        size_bytes bigint,
        width int,
        height int,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_attachments_relation CHECK (incident_id IS NOT NULL OR report_id IS NOT NULL OR dispatch_id IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_attachments_incident ON attachments(incident_id);`);
    await queryRunner.query(`CREATE INDEX idx_attachments_report ON attachments(report_id);`);

    await queryRunner.query(`
      CREATE TABLE incident_casualties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id uuid NOT NULL REFERENCES incidents(id),
        injured_count int NOT NULL DEFAULT 0,
        deceased_count int NOT NULL DEFAULT 0,
        critical_count int,
        missing_count int,
        note text,
        reported_by uuid REFERENCES users(id),
        reported_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_incident_casualties_incident ON incident_casualties(incident_id, reported_at DESC);`);

    // ---------- Penugasan ----------
    await queryRunner.query(`
      CREATE TABLE resource_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id uuid NOT NULL REFERENCES incidents(id),
        requested_by uuid NOT NULL REFERENCES users(id),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        resource_type varchar(24) NOT NULL,
        quantity smallint NOT NULL DEFAULT 1,
        urgency varchar(10) NOT NULL CHECK (urgency IN ('NORMAL','URGENT')),
        reason text,
        status varchar(12) NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
        decided_by uuid REFERENCES users(id),
        decided_at timestamptz,
        decision_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_resource_requests_incident ON resource_requests(incident_id);`);
    await queryRunner.query(`CREATE INDEX idx_resource_requests_pending ON resource_requests(status) WHERE status = 'PENDING';`);

    await queryRunner.query(`
      CREATE TABLE dispatches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id uuid NOT NULL REFERENCES incidents(id),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        unit_id uuid REFERENCES units(id),
        type varchar(10) NOT NULL CHECK (type IN ('RESPOND','NOTIFY')),
        origin varchar(16) NOT NULL CHECK (origin IN ('DISPATCHER','SELF_INITIATED','REQUESTED')),
        status varchar(20) NOT NULL CHECK (status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE','DONE','REJECTED','EXPIRED','CANCELLED','NOTIFIED','READY','FULL','PATIENT_ARRIVED')),
        channel varchar(16) CHECK (channel IS NULL OR channel IN ('APP','PHONE','WHATSAPP','RADIO')),
        created_by uuid REFERENCES users(id),
        recorded_by uuid NOT NULL REFERENCES users(id),
        accepted_by uuid REFERENCES users(id),
        resource_request_id uuid REFERENCES resource_requests(id),
        related_dispatch_id uuid REFERENCES dispatches(id),
        destination_organization_id uuid REFERENCES organizations(id),
        offered_at timestamptz,
        offer_expires_at timestamptz,
        offer_seen_at timestamptz,
        accepted_at timestamptz,
        en_route_at timestamptz,
        on_scene_at timestamptz,
        done_at timestamptz,
        reject_reason text,
        cancel_reason text,
        eta_minutes int,
        distance_m_at_offer int,
        outcome_code varchar(24) CHECK (outcome_code IS NULL OR outcome_code IN ('COMPLETED','NOT_FOUND','HANDED_OVER','PATIENT_TRANSPORTED','FALSE_ALARM')),
        outcome_note text,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_dispatches_incident ON dispatches(incident_id);`);
    await queryRunner.query(`CREATE INDEX idx_dispatches_org_status ON dispatches(organization_id, status);`);
    await queryRunner.query(`CREATE INDEX idx_dispatches_active_unit ON dispatches(unit_id) WHERE status IN ('ACCEPTED','EN_ROUTE','ON_SCENE');`);
    await queryRunner.query(`CREATE INDEX idx_dispatches_offer_expires ON dispatches(offer_expires_at) WHERE status = 'OFFERED';`);

    // FK attachments.dispatch_id setelah dispatches ada
    await queryRunner.query(`
      ALTER TABLE attachments
        ADD CONSTRAINT fk_attachments_dispatch FOREIGN KEY (dispatch_id) REFERENCES dispatches(id)
    `);

    await queryRunner.query(`
      CREATE TABLE dispatch_status_history (
        id bigserial PRIMARY KEY,
        dispatch_id uuid NOT NULL REFERENCES dispatches(id),
        from_status varchar(20),
        to_status varchar(20) NOT NULL,
        occurred_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        recorded_by uuid REFERENCES users(id),
        channel varchar(16),
        note text
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_dispatch_status_history_dispatch ON dispatch_status_history(dispatch_id, id);`);

    // ---------- Log ----------
    await queryRunner.query(`
      CREATE TABLE incident_events (
        id bigserial PRIMARY KEY,
        incident_id uuid NOT NULL REFERENCES incidents(id),
        dispatch_id uuid REFERENCES dispatches(id),
        event_type varchar(40) NOT NULL,
        actor_user_id uuid REFERENCES users(id),
        actor_organization_id uuid REFERENCES organizations(id),
        channel varchar(16),
        visibility varchar(10) NOT NULL CHECK (visibility IN ('INTERNAL','LEAD','UNITS','PUBLIC')),
        occurred_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        payload jsonb
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_incident_events_incident ON incident_events(incident_id, id);`);
    await queryRunner.query(`CREATE INDEX idx_incident_events_type ON incident_events(event_type);`);
    await queryRunner.query(`CREATE INDEX idx_incident_events_recorded ON incident_events(recorded_at);`);

    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id bigserial PRIMARY KEY,
        actor_user_id uuid REFERENCES users(id),
        action varchar(60) NOT NULL,
        entity_type varchar(40),
        entity_id varchar(64),
        before_data jsonb,
        after_data jsonb,
        ip_address varchar(45),
        user_agent text,
        request_id varchar(64),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);`);

    await queryRunner.query(`
      CREATE TABLE outbox_events (
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
    await queryRunner.query(`CREATE INDEX idx_outbox_events_unprocessed ON outbox_events(id) WHERE processed_at IS NULL;`);

    // ---------- Operasional ----------
    await queryRunner.query(`
      CREATE TABLE dispatcher_shifts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        handover_note text,
        handed_over_to uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_dispatcher_shifts_user ON dispatcher_shifts(user_id, started_at DESC);`);
    await queryRunner.query(`CREATE INDEX idx_dispatcher_shifts_open ON dispatcher_shifts(user_id) WHERE ended_at IS NULL;`);

    // ---------- Notifikasi ----------
    await queryRunner.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind varchar(24) NOT NULL CHECK (kind IN ('DISPATCH_OFFER','INCIDENT_UPDATE','ALERT','RESOURCE_REQUEST','SYSTEM','REPORT_UPDATE')),
        title varchar(200) NOT NULL,
        body text NOT NULL,
        priority varchar(8) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL')),
        incident_id uuid REFERENCES incidents(id),
        dispatch_id uuid REFERENCES dispatches(id),
        alert_id uuid,
        data jsonb,
        seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);`);
    await queryRunner.query(`CREATE INDEX idx_notifications_unseen ON notifications(user_id) WHERE seen_at IS NULL;`);

    await queryRunner.query(`
      CREATE TABLE notification_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        device_token_id uuid REFERENCES device_tokens(id),
        channel varchar(10) NOT NULL CHECK (channel IN ('FCM','WEBSOCKET','SMS')),
        status varchar(12) NOT NULL CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED')),
        attempts smallint NOT NULL DEFAULT 0,
        provider_message_id varchar(255),
        sent_at timestamptz,
        delivered_at timestamptz,
        failure_reason text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries(notification_id);`);
    await queryRunner.query(`CREATE INDEX idx_notification_deliveries_pending ON notification_deliveries(status) WHERE status IN ('QUEUED','FAILED');`);

    await queryRunner.query(`
      CREATE TABLE device_topic_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_token_id uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
        topic varchar(100) NOT NULL,
        status varchar(12) NOT NULL CHECK (status IN ('ACTIVE','REMOVED')),
        subscribed_at timestamptz NOT NULL DEFAULT now(),
        removed_at timestamptz,
        UNIQUE (device_token_id, topic)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_device_topic_subscriptions_topic ON device_topic_subscriptions(topic) WHERE status = 'ACTIVE';`);

    // ---------- Alert bencana ----------
    await queryRunner.query(`
      CREATE TABLE disaster_alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(30) UNIQUE,
        source varchar(16) NOT NULL CHECK (source IN ('MANUAL','BMKG','BNPB')),
        external_id varchar(100),
        category varchar(24) NOT NULL CHECK (category IN ('FLOOD','EARTHQUAKE','WEATHER','LANDSLIDE','OTHER')),
        level varchar(16) NOT NULL,
        title varchar(200) NOT NULL,
        body text NOT NULL,
        instruction text,
        area geography(MultiPolygon,4326),
        delivery_mode varchar(12) NOT NULL CHECK (delivery_mode IN ('REGION_TOPIC','GEOFENCE')),
        status varchar(12) NOT NULL CHECK (status IN ('DRAFT','ACTIVE','CLOSED')),
        starts_at timestamptz,
        expires_at timestamptz,
        created_by uuid REFERENCES users(id),
        published_at timestamptz,
        closed_at timestamptz,
        disaster_event_id uuid REFERENCES disaster_events(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_disaster_alerts_area ON disaster_alerts USING GIST (area);`);
    await queryRunner.query(`CREATE INDEX idx_disaster_alerts_status ON disaster_alerts(status, expires_at);`);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_disaster_alerts_external ON disaster_alerts(source, external_id) WHERE external_id IS NOT NULL;`);

    await queryRunner.query(`
      CREATE TABLE disaster_alert_regions (
        alert_id uuid NOT NULL REFERENCES disaster_alerts(id) ON DELETE CASCADE,
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        PRIMARY KEY (alert_id, region_id)
      )
    `);

    // FK users.home_region_id sudah ada; auth_sessions.device_token_id & notifications.alert_id ditambahkan menyusul
    await queryRunner.query(`
      ALTER TABLE auth_sessions
        ADD CONSTRAINT fk_auth_sessions_device FOREIGN KEY (device_token_id) REFERENCES device_tokens(id)
    `);
    await queryRunner.query(`
      ALTER TABLE notifications
        ADD CONSTRAINT fk_notifications_alert FOREIGN KEY (alert_id) REFERENCES disaster_alerts(id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_alert;`);
    await queryRunner.query(`ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS fk_auth_sessions_device;`);
    await queryRunner.query(`DROP TABLE IF EXISTS disaster_alert_regions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS disaster_alerts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_topic_subscriptions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_deliveries;`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications;`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatcher_shifts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incident_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatch_status_history;`);
    await queryRunner.query(`ALTER TABLE attachments DROP CONSTRAINT IF EXISTS fk_attachments_dispatch;`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatches;`);
    await queryRunner.query(`DROP TABLE IF EXISTS resource_requests;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incident_casualties;`);
    await queryRunner.query(`DROP TABLE IF EXISTS attachments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incident_reports;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incidents;`);
    await queryRunner.query(`DROP TABLE IF EXISTS disaster_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS system_settings;`);
    await queryRunner.query(`DROP TABLE IF EXISTS incident_types;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_tokens;`);
    await queryRunner.query(`DROP TABLE IF EXISTS otp_requests;`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_sessions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS staff_profiles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS users;`);
    await queryRunner.query(`DROP TABLE IF EXISTS units;`);
    await queryRunner.query(`DROP TABLE IF EXISTS organization_service_areas;`);
    await queryRunner.query(`DROP TABLE IF EXISTS organizations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS regions;`);
  }
}
