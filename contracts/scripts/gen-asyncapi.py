#!/usr/bin/env python3
"""Generate contracts/asyncapi.yaml (AsyncAPI 3) dari katalog event WebSocket.

Sumber: docs/specs/websocket-aplikasi-darurat.md §5 (server->client) dan §6 (client->server).
Sengaja digenerate agar katalog dan kontrak tetap sinkron; jalankan ulang bila dokumen berubah.
"""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "contracts" / "asyncapi.yaml"

# ---------------------------------------------------------------------------
# Katalog event server -> client: (type, rooms/audiens, class, ackRequired, data schema ref/inline)
# ---------------------------------------------------------------------------
S2C = [
    # 5.1 sistem & sesi
    ("connection.ready", ["connection"], "INFO", False, "ConnectionReadyData"),
    ("auth.expiring", ["connection"], "INFO", False, "AuthExpiringData"),
    ("auth.expired", ["connection"], "INFO", False, None),
    ("session.revoked", ["connection"], "INFO", False, "SessionRevokedData"),
    ("system.notice", ["*"], "INFO", False, "SystemNoticeData"),
    # 5.2 incident
    ("incident.created", ["role:dispatcher"], "STANDARD", False, "IncidentCreatedData"),
    ("incident.report_added", ["role:dispatcher"], "STANDARD", False, "IncidentReportAddedData"),
    ("incident.updated", ["role:dispatcher", "incident:{id}"], "STANDARD", False, "IncidentUpdatedData"),
    ("incident.location_updated", ["incident:{id}"], "STANDARD", False, "IncidentLocationUpdatedData"),
    ("incident.status_changed", ["role:dispatcher", "incident:{id}"], "STANDARD", False, "IncidentStatusChangedData"),
    ("incident.locked", ["role:dispatcher"], "STANDARD", False, "IncidentLockedData"),
    ("incident.unlocked", ["role:dispatcher"], "STANDARD", False, "IncidentLockedData"),
    ("incident.lock_overridden", ["role:dispatcher"], "STANDARD", False, "IncidentLockOverriddenData"),
    ("incident.merged", ["role:dispatcher"], "STANDARD", False, "IncidentMergedData"),
    ("incident.lead_changed", ["role:dispatcher", "incident:{id}", "org:{newLead}", "org:{oldLead}"], "STANDARD", False, "IncidentLeadChangedData"),
    ("incident.casualties_updated", ["role:dispatcher", "incident:{id}"], "STANDARD", False, "IncidentCasualtiesUpdatedData"),
    ("incident.milestone_recorded", ["role:dispatcher", "incident:{id}"], "STANDARD", False, "IncidentMilestoneRecordedData"),
    ("incident.note_added", ["role:dispatcher"], "INFO", False, "IncidentNoteAddedData"),
    # 5.3 dispatch
    ("dispatch.offered", ["unit:{id}", "org:{id}", "user:{id}"], "CRITICAL", True, "DispatchOfferedData"),
    ("dispatch.notified", ["org:{id}"], "CRITICAL", True, "DispatchNotifiedData"),
    ("dispatch.created", ["role:dispatcher"], "STANDARD", False, "DispatchCreatedData"),
    ("dispatch.accepted", ["role:dispatcher", "org:{id}"], "STANDARD", False, "DispatchAcceptedData"),
    ("dispatch.rejected", ["role:dispatcher", "role:supervisor"], "CRITICAL", False, "DispatchRejectedData"),
    ("dispatch.expired", ["role:dispatcher", "role:supervisor", "org:{id}"], "CRITICAL", False, "DispatchExpiredData"),
    ("dispatch.cancelled", ["unit:{id}", "org:{id}", "role:dispatcher", "incident:{id}"], "STANDARD", False, "DispatchCancelledData"),
    ("dispatch.self_initiated", ["role:dispatcher"], "CRITICAL", False, "DispatchSelfInitiatedData"),
    ("dispatch.status_changed", ["role:dispatcher", "incident:{id}"], "STANDARD", False, "DispatchStatusChangedData"),
    ("dispatch.offer_unseen", ["role:dispatcher", "role:supervisor"], "CRITICAL", False, "DispatchOfferUnseenData"),
    # 5.4 resource request
    ("resource_request.created", ["role:dispatcher"], "CRITICAL", True, "ResourceRequestCreatedData"),
    ("resource_request.decided", ["user:{requester}", "org:{leadOrg}"], "STANDARD", False, "ResourceRequestDecidedData"),
    # 5.5 warga
    ("report.status_changed", ["user:{reporterId}"], "STANDARD", False, "ReportStatusChangedData"),
    ("report.timeline_updated", ["user:{reporterId}"], "INFO", False, "ReportTimelineUpdatedData"),
    # 5.6 alert & notifikasi
    ("alert.published", ["region:{districtId}", "user:{id}"], "DYNAMIC", False, "AlertPublishedData"),
    ("alert.updated", ["region:{districtId}", "user:{id}"], "STANDARD", False, "AlertUpdatedData"),
    ("alert.closed", ["region:{districtId}", "user:{id}"], "INFO", False, "AlertClosedData"),
    ("notification.created", ["user:{id}"], "INFO", False, "NotificationCreatedData"),
    # 5.7 unit
    ("unit.status_changed", ["role:dispatcher", "org:{id}"], "INFO", False, "UnitStatusChangedData"),
    ("unit.location_updated", ["role:dispatcher"], "INFO", False, "UnitLocationUpdatedData"),
]

# Padanan FCM per event (dokumen fcm-aplikasi-darurat.md §4.1, kolom "Sumber event").
# Event tanpa entri TIDAK dikirim FCM langsung; event STANDARD staf tanpa koneksi memakai
# fallback generik SYNC_HINT (disebut sebagai kelas, bukan per-event).
FCM_MAP = {
    "dispatch.offered": "DISPATCH_OFFER",
    "dispatch.notified": "DISPATCH_NOTIFIED",
    "dispatch.cancelled": "DISPATCH_UPDATE",
    "dispatch.expired": "DISPATCH_UPDATE",
    "alert.published": "ALERT",
    "alert.updated": "ALERT_UPDATE",
    "report.status_changed": "REPORT_UPDATE",
    "session.revoked": "SESSION_REVOKED",
}

# Kelas pengiriman menurut §7 kecuali berikut:
CLASS_NOTES = {
    "alert.published": (
        "Kelas dinamis: system_settings.alert_levels.fcm_class per level alert "
        "(level dengan fcm_class=CRITICAL -> kelas CRITICAL; selain itu STANDARD)."
    ),
}

# Event klien -> server: (type, sender, payload schema ref, ack description)
C2S = [
    ("ack", "semua", "AckData", "{ ok: true }"),
    ("auth.refresh", "semua", "AuthRefreshData", "{ ok: true } atau { ok: false, code }"),
    ("app.state", "semua", "AppStateChangedData", "-"),
    ("unit.location", "responder", "UnitLocationData", "{ ok: true }"),
]

# ---------------------------------------------------------------------------
# Skema data per event (ringkas, sesuai §5)
# ---------------------------------------------------------------------------
DATA_SCHEMAS = {
    "ConnectionReadyData": {
        "type": "object",
        "required": ["serverTime", "userId", "rooms", "minAppVersion", "resyncRecommended"],
        "properties": {
            "serverTime": {"type": "string", "format": "date-time"},
            "userId": {"type": "string", "format": "uuid"},
            "rooms": {"type": "array", "items": {"type": "string"}},
            "minAppVersion": {"type": "string"},
            "resyncRecommended": {"type": "boolean", "const": True},
        },
    },
    "AuthExpiringData": {
        "type": "object",
        "required": ["expiresInSeconds"],
        "properties": {"expiresInSeconds": {"type": "integer"}},
    },
    "SessionRevokedData": {
        "type": "object",
        "required": ["reason"],
        "properties": {
            "reason": {
                "type": "string",
                "enum": ["LOGOUT", "ACCOUNT_DEACTIVATED", "REFRESH_REUSE", "ADMIN_REVOKED"],
            }
        },
    },
    "SystemNoticeData": {
        "type": "object",
        "required": ["level", "message"],
        "properties": {"level": {"type": "string"}, "message": {"type": "string"}},
    },
    "IncidentSummaryData": {
        "type": "object",
        "description": "IncidentSummary ringkas (mengikuti REST §4)",
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "code": {"type": "string"},
            "status": {"type": "string", "enum": ["SUBMITTED", "VERIFIED", "IN_PROGRESS", "RESOLVED", "CLOSED", "INVALID", "DUPLICATE"]},
            "type": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
            "district": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "village": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "location": {"$ref": "#/components/schemas/Coordinates"},
            "reportCount": {"type": "integer"},
            "version": {"type": "integer"},
        },
    },
    "IncidentCreatedData": {
        "type": "object",
        "required": ["incident"],
        "properties": {
            "incident": {"$ref": "#/components/schemas/IncidentSummaryData"},
            "suggestedIncidentId": {"type": ["string", "null"], "format": "uuid"},
            "flags": {"type": "array", "items": {"type": "string"}},
        },
    },
    "IncidentReportAddedData": {
        "type": "object",
        "required": ["reportId", "incident"],
        "properties": {
            "reportId": {"type": "string", "format": "uuid"},
            "kind": {"type": "string"},
            "incident": {"$ref": "#/components/schemas/IncidentSummaryData"},
        },
    },
    "IncidentUpdatedData": {
        "type": "object",
        "required": ["changes"],
        "properties": {"changes": {"type": "object"}},
    },
    "IncidentLocationUpdatedData": {
        "type": "object",
        "required": ["location"],
        "properties": {
            "location": {"$ref": "#/components/schemas/Coordinates"},
            "addressText": {"type": ["string", "null"]},
        },
    },
    "IncidentStatusChangedData": {
        "type": "object",
        "required": ["from", "to"],
        "properties": {
            "from": {"type": "string"},
            "to": {"type": "string"},
            "incident": {"$ref": "#/components/schemas/IncidentSummaryData"},
        },
    },
    "IncidentLockedData": {
        "type": "object",
        "required": ["lockedBy"],
        "properties": {
            "lockedBy": {"type": "object", "properties": {"id": {"type": "string", "format": "uuid"}, "name": {"type": "string"}}},
            "lockExpiresAt": {"type": "string", "format": "date-time"},
        },
    },
    "IncidentLockOverriddenData": {
        "type": "object",
        "required": ["previousHolder", "newHolder"],
        "properties": {
            "previousHolder": {"type": "object"},
            "newHolder": {"type": "object"},
            "reason": {"type": "string"},
        },
    },
    "IncidentMergedData": {
        "type": "object",
        "required": ["sourceId", "targetId"],
        "properties": {
            "sourceId": {"type": "string", "format": "uuid"},
            "targetId": {"type": "string", "format": "uuid"},
        },
    },
    "IncidentLeadChangedData": {
        "type": "object",
        "required": ["leadOrganization"],
        "properties": {"leadOrganization": {"type": "object", "properties": {"id": {"type": "string", "format": "uuid"}, "name": {"type": "string"}}}},
    },
    "IncidentCasualtiesUpdatedData": {
        "type": "object",
        "required": ["injured", "deceased"],
        "properties": {
            "injured": {"type": "integer"},
            "deceased": {"type": "integer"},
            "critical": {"type": ["integer", "null"]},
            "missing": {"type": ["integer", "null"]},
            "reportedAt": {"type": "string", "format": "date-time"},
        },
    },
    "IncidentMilestoneRecordedData": {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "enum": ["SCENE_RELEASED", "ROAD_REOPENED", "VICTIM_DECEASED_HANDLED", "EXTERNAL_UNIT_ARRIVED", "EXTERNAL_COORDINATION"]},
            "note": {"type": ["string", "null"]},
            "payload": {"type": ["object", "null"]},
            "occurredAt": {"type": "string", "format": "date-time"},
        },
    },
    "IncidentNoteAddedData": {
        "type": "object",
        "required": ["noteId"],
        "properties": {
            "noteId": {"type": "string"},
            "visibility": {"type": "string", "enum": ["INTERNAL", "LEAD", "UNITS"]},
        },
    },
    "OfferIncidentData": {
        "type": "object",
        "description": "Incident pada OfferView — TANPA lokasi presisi/deskripsi (REST §4.1)",
        "properties": {
            "code": {"type": "string"},
            "type": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
            "district": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "village": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}}},
            "distanceM": {"type": ["integer", "null"]},
        },
    },
    "OfferViewData": {
        "type": "object",
        "required": ["dispatchId", "incident", "type", "origin", "status"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "incident": {"$ref": "#/components/schemas/OfferIncidentData"},
            "type": {"type": "string", "enum": ["RESPOND", "NOTIFY"]},
            "origin": {"type": "string", "enum": ["DISPATCHER", "SELF_INITIATED", "REQUESTED"]},
            "status": {"type": "string", "enum": ["OFFERED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "DONE", "REJECTED", "EXPIRED", "CANCELLED", "NOTIFIED", "READY", "FULL", "PATIENT_ARRIVED"]},
            "offerExpiresAt": {"type": ["string", "null"], "format": "date-time"},
            "note": {"type": ["string", "null"]},
        },
    },
    "DispatchOfferedData": {
        "type": "object",
        "required": ["offer", "offerExpiresAt"],
        "properties": {
            "offer": {"$ref": "#/components/schemas/OfferViewData"},
            "offerExpiresAt": {"type": "string", "format": "date-time"},
        },
    },
    "DispatchNotifiedData": {
        "type": "object",
        "required": ["incidentType"],
        "properties": {
            "incidentType": {"type": "string"},
            "casualties": {"type": "object"},
            "etaMinutes": {"type": ["integer", "null"]},
            "sourceDispatchId": {"type": "string", "format": "uuid"},
        },
    },
    "DispatchSummaryData": {
        "type": "object",
        "description": "DispatchSummary ringkas (mengikuti REST §4)",
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "incidentId": {"type": "string", "format": "uuid"},
            "organization": {"type": "object"},
            "unit": {"type": ["object", "null"]},
            "type": {"type": "string", "enum": ["RESPOND", "NOTIFY"]},
            "status": {"type": "string"},
        },
    },
    "DispatchCreatedData": {
        "type": "object",
        "required": ["dispatch"],
        "properties": {"dispatch": {"$ref": "#/components/schemas/DispatchSummaryData"}},
    },
    "DispatchAcceptedData": {
        "type": "object",
        "required": ["dispatchId"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "acceptedBy": {"type": "object", "properties": {"id": {"type": "string", "format": "uuid"}, "name": {"type": "string"}}},
            "unit": {"type": ["object", "null"]},
            "etaMinutes": {"type": ["integer", "null"]},
        },
    },
    "DispatchRejectedData": {
        "type": "object",
        "required": ["dispatchId", "reason"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "organization": {"type": "object"},
            "reason": {"type": "string"},
        },
    },
    "DispatchExpiredData": {
        "type": "object",
        "required": ["dispatchId"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "organization": {"type": "object"},
        },
    },
    "DispatchCancelledData": {
        "type": "object",
        "required": ["dispatchId"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "reason": {"type": ["string", "null"]},
        },
    },
    "DispatchSelfInitiatedData": {
        "type": "object",
        "required": ["dispatch"],
        "properties": {
            "dispatch": {"$ref": "#/components/schemas/DispatchSummaryData"},
            "channel": {"type": "string"},
        },
    },
    "DispatchStatusChangedData": {
        "type": "object",
        "required": ["dispatchId", "from", "to"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "from": {"type": "string"},
            "to": {"type": "string"},
            "occurredAt": {"type": "string", "format": "date-time"},
            "recordedBy": {"type": ["object", "null"]},
            "channel": {"type": ["string", "null"]},
            "organization": {"type": "object"},
        },
    },
    "DispatchOfferUnseenData": {
        "type": "object",
        "required": ["dispatchId", "secondsSinceOffer"],
        "properties": {
            "dispatchId": {"type": "string", "format": "uuid"},
            "organization": {"type": "object"},
            "secondsSinceOffer": {"type": "integer"},
        },
    },
    "ResourceRequestCreatedData": {
        "type": "object",
        "required": ["requestId", "resourceType", "quantity"],
        "properties": {
            "requestId": {"type": "string", "format": "uuid"},
            "incident": {"$ref": "#/components/schemas/IncidentSummaryData"},
            "resourceType": {"type": "string"},
            "quantity": {"type": "integer"},
            "urgency": {"type": "string", "enum": ["NORMAL", "URGENT"]},
            "reason": {"type": "string"},
        },
    },
    "ResourceRequestDecidedData": {
        "type": "object",
        "required": ["requestId", "status"],
        "properties": {
            "requestId": {"type": "string", "format": "uuid"},
            "status": {"type": "string", "enum": ["APPROVED", "REJECTED"]},
            "note": {"type": ["string", "null"]},
        },
    },
    "ReportStatusChangedData": {
        "type": "object",
        "required": ["reportId", "publicStatus"],
        "properties": {
            "reportId": {"type": "string", "format": "uuid"},
            "publicStatus": {"type": "string", "enum": ["RECEIVED", "VERIFIED", "UNIT_DISPATCHED", "UNIT_EN_ROUTE", "UNIT_ON_SCENE", "RESOLVED", "NOT_VALID", "OUT_OF_AREA"]},
            "message": {"type": "string"},
        },
    },
    "ReportTimelineUpdatedData": {
        "type": "object",
        "required": ["reportId", "entry"],
        "properties": {
            "reportId": {"type": "string", "format": "uuid"},
            "entry": {"type": "object", "properties": {"ts": {"type": "string", "format": "date-time"}, "text": {"type": "string"}}},
        },
    },
    "AlertData": {
        "type": "object",
        "required": ["id", "title"],
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "category": {"type": "string"},
            "level": {"type": "string", "enum": ["INFO", "WARNING", "ALERT", "EMERGENCY"]},
            "title": {"type": "string"},
            "body": {"type": "string"},
            "instruction": {"type": ["string", "null"]},
        },
    },
    "AlertPublishedData": {"type": "object", "required": ["alert"], "properties": {"alert": {"$ref": "#/components/schemas/AlertData"}}},
    "AlertUpdatedData": {
        "type": "object",
        "required": ["alertId"],
        "properties": {"alertId": {"type": "string", "format": "uuid"}, "changes": {"type": "object"}},
    },
    "AlertClosedData": {"type": "object", "required": ["alertId"], "properties": {"alertId": {"type": "string", "format": "uuid"}}},
    "NotificationCreatedData": {
        "type": "object",
        "required": ["notificationId", "kind", "title"],
        "properties": {
            "notificationId": {"type": "string", "format": "uuid"},
            "kind": {"type": "string"},
            "title": {"type": "string"},
            "unreadCount": {"type": "integer"},
        },
    },
    "UnitStatusChangedData": {
        "type": "object",
        "required": ["unitId", "status"],
        "properties": {
            "unitId": {"type": "string", "format": "uuid"},
            "status": {"type": "string", "enum": ["AVAILABLE", "BUSY", "OFFLINE", "OUT_OF_SERVICE"]},
        },
    },
    "UnitLocationUpdatedData": {
        "type": "object",
        "required": ["unitId", "location"],
        "properties": {
            "unitId": {"type": "string", "format": "uuid"},
            "location": {"$ref": "#/components/schemas/Coordinates"},
            "recordedAt": {"type": "string", "format": "date-time"},
        },
    },
    # klien -> server
    "AckData": {
        "type": "object",
        "required": ["eid", "state"],
        "properties": {
            "eid": {"type": "string", "format": "uuid"},
            "state": {"type": "string", "enum": ["DELIVERED", "SEEN"]},
            "at": {"type": "string", "format": "date-time"},
        },
    },
    "AuthRefreshData": {
        "type": "object",
        "required": ["accessToken"],
        "properties": {"accessToken": {"type": "string"}},
    },
    "AppStateChangedData": {
        "type": "object",
        "required": ["state"],
        "properties": {"state": {"type": "string", "enum": ["FOREGROUND", "BACKGROUND"]}},
    },
    "UnitLocationData": {
        "type": "object",
        "required": ["lat", "lng"],
        "properties": {
            "lat": {"type": "number"},
            "lng": {"type": "number"},
            "accuracyM": {"type": "number"},
            "recordedAt": {"type": "string", "format": "date-time"},
            "heading": {"type": ["number", "null"]},
            "speedMps": {"type": ["number", "null"]},
        },
    },
}

ENVELOPE = {
    "type": "object",
    "required": ["eid", "id", "type", "v", "ts", "class", "ackRequired", "data"],
    "properties": {
        "eid": {"type": "string", "format": "uuid", "description": "Id pengiriman logis (untuk dedup WS/FCM)"},
        "id": {"type": ["string", "null"], "description": "Id incident_events (kursor sync); null untuk event sementara"},
        "type": {"type": "string", "description": "Nama event (juga nama event Socket.IO)"},
        "v": {"type": "integer", "description": "Versi skema payload"},
        "ts": {"type": "string", "format": "date-time"},
        "incidentId": {"type": ["string", "null"], "format": "uuid"},
        "dispatchId": {"type": ["string", "null"], "format": "uuid"},
        "resourceVersion": {"type": ["integer", "null"]},
        "class": {"type": "string", "enum": ["CRITICAL", "STANDARD", "INFO"]},
        "ackRequired": {"type": "boolean"},
        "data": {"type": "object"},
    },
}


def pascal(name: str) -> str:
    return "".join(p.capitalize() for p in name.replace("/", "_").replace(".", "_").split("_"))


def build() -> dict:
    components_messages = {}
    channel_messages = {}

    for typ, rooms, cls, ack, data_ref in S2C:
        key = pascal(typ)
        class_schema = (
            {"const": cls}
            if cls != "DYNAMIC"
            else {"enum": ["CRITICAL", "STANDARD"], "description": CLASS_NOTES.get(typ)}
        )
        payload = {
            "allOf": [
                {"$ref": "#/components/schemas/EventEnvelope"},
                {
                    "type": "object",
                    "properties": {
                        "type": {"const": typ},
                        "class": class_schema,
                        "ackRequired": {"const": ack},
                        "data": (
                            {"$ref": f"#/components/schemas/{data_ref}"}
                            if data_ref
                            else {"type": "object", "additionalProperties": False}
                        ),
                    },
                },
            ]
        }
        msg = {
            "name": typ,
            "title": typ,
            "description": f"Server -> klien. Audiens: {', '.join(rooms)}. Kelas: {cls}.",
            "payload": payload,
            "x-rooms": rooms,
            "x-class": cls,
            "x-ack-required": ack,
            "x-direction": "s2c",
        }
        if typ in CLASS_NOTES:
            msg["x-class-note"] = CLASS_NOTES[typ]
        if typ in FCM_MAP:
            msg["x-fcm"] = FCM_MAP[typ]
        components_messages[key] = msg
        channel_messages[key] = {"$ref": f"#/components/messages/{key}"}

    for typ, sender, data_ref, _ack in C2S:
        key = pascal(typ) + "Command"
        components_messages[key] = {
            "name": typ,
            "title": typ,
            "description": f"Klien -> server. Pengirim: {sender}. Tidak pernah mengubah data domain (REST satu-satunya jalur tulis).",
            "payload": {"$ref": f"#/components/schemas/{data_ref}"},
            "x-sender": sender,
            "x-direction": "c2s",
        }
        channel_messages[key] = {"$ref": f"#/components/messages/{key}"}

    schemas = {
        "Coordinates": {
            "type": "object",
            "required": ["lat", "lng"],
            "properties": {
                "lat": {"type": "number", "format": "double"},
                "lng": {"type": "number", "format": "double"},
                "accuracyM": {"type": "number"},
            },
        },
        "EventEnvelope": ENVELOPE,
    }
    schemas.update(DATA_SCHEMAS)

    doc = {
        "asyncapi": "3.1.0",
        "info": {
            "title": "Emergency Platform Realtime",
            "version": "1.0.0",
            "description": (
                "Kontrak WebSocket (Socket.IO namespace /realtime) untuk aplikasi sampel.\n"
                "Acuan: docs/specs/websocket-aplikasi-darurat.md §5-6.\n"
                "REST adalah satu-satunya jalur tulis; WebSocket hanya mengantar event.\n"
                "At-least-once: klien membuang duplikat dengan `eid`."
            ),
            "contact": {"name": "Emergency Platform", "url": "https://github.com/jiprakoso/emergency-platform"},
            "license": {"name": "UNLICENSED"},
            "tags": [
                {"name": "incident", "description": "Event kejadian (kepada dispatcher dan pihak terkait)"},
                {"name": "dispatch", "description": "Event penugasan responder"},
                {"name": "resource", "description": "Event resource request"},
                {"name": "report", "description": "Event status laporan warga"},
                {"name": "alert", "description": "Event peringatan bencana"},
                {"name": "unit", "description": "Event unit dan lokasi"},
                {"name": "system", "description": "Event sistem dan sesi"},
                {"name": "client", "description": "Perintah klien -> server (bukan jalur tulis data domain)"},
            ],
        },
        "defaultContentType": "application/json",
        "servers": {
            "development": {
                "host": "localhost:3000",
                "pathname": "/realtime",
                "protocol": "socketio",
                "protocolVersion": "4",
                "description": "Dev (ws, fallback polling)",
            }
        },
        "channels": {
            "realtime": {
                "address": "/realtime",
                "title": "Realtime",
                "description": "Satu namespace Socket.IO. Server mengatur room; klien tidak join sembarang.",
                "messages": channel_messages,
            }
        },
        "operations": {
            "receiveServerEvents": {
                "action": "receive",
                "channel": {"$ref": "#/channels/realtime"},
                "summary": "Menerima event server -> klien",
                "description": (
                    "Server mengirim event satu arah dengan amplop standar (eid, id, type, v, ts, "
                    "class, ackRequired, data). At-least-once; klien membuang duplikat dengan eid "
                    "dan membalas ack bila ackRequired."
                ),
                "messages": [
                    {"$ref": f"#/channels/realtime/messages/{pascal(t)}"}
                    for t, *_ in S2C
                ],
            },
            "sendClientCommands": {
                "action": "send",
                "channel": {"$ref": "#/channels/realtime"},
                "summary": "Mengirim perintah klien -> server",
                "description": (
                    "Empat perintah satu-satunya yang dikirim klien ke server: ack, auth.refresh, "
                    "app.state, unit.location. Semua divalidasi DTO, dibatasi laju, dan tidak pernah "
                    "mengubah data domain (REST tetap satu-satunya jalur tulis)."
                ),
                "messages": [
                    {"$ref": f"#/channels/realtime/messages/{pascal(t)}Command"}
                    for t, *_ in C2S
                ],
            },
        },
        "components": {"messages": components_messages, "schemas": schemas},
    }
    return doc


def main() -> None:
    doc = build()
    OUT.write_text(
        yaml.dump(doc, sort_keys=False, allow_unicode=True, width=120),
        encoding="utf-8",
    )
    print(f"wrote {OUT}")
    print(f"s2c events: {len(S2C)}, c2s events: {len(C2S)}")


if __name__ == "__main__":
    main()
