#!/usr/bin/env python3
"""Generate contracts/examples/ (contoh JSON untuk quicktype, handoff §6.5).

Dijalankan: python3 contracts/scripts/gen-examples.py
Divalidasi oleh: contracts/scripts/check-examples.mjs (jalankan via `make contract`).

Keputusan implementasi (tercatat di docs/ASSUMPTIONS.md):
- Berkas berisi BENTUK LENGKAP respons sukses (amplop `data` + `page` bila ada),
  bukan hanya isi `data`, supaya aturan §6.5 #4 (contoh `page`) terpenuhi dan
  validasi skema bisa langsung terhadap respons.
- Data memakai seed fiktif dari docs/specs/seed-demo-aplikasi-darurat.md, tanpa PII nyata.
- Operasi yang hanya punya respons 204/tanpa isi tidak butuh contoh sukses.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
OPENAPI = ROOT / "contracts" / "openapi.yaml"
ASYNCAPI = ROOT / "contracts" / "asyncapi.yaml"
OUT = ROOT / "contracts" / "examples"

# ---------------------------------------------------------------------------
# Seed fiktif (Kota Contoh — seed-demo-aplikasi-darurat.md §3, §4, §6, §7, §8)
# ---------------------------------------------------------------------------
T0 = "2026-10-05T03:15:00Z"
T1 = "2026-10-05T03:20:00Z"
T2 = "2026-10-05T03:35:00Z"

IDS = {
    "incident": "11111111-1111-4111-8111-111111111101",
    "incident2": "11111111-1111-4111-8111-111111111102",
    "report": "33333333-3333-4333-8333-333333333301",
    "report2": "33333333-3333-4333-8333-333333333302",
    "dispatch": "22222222-2222-4222-8222-222222222201",
    "dispatch2": "22222222-2222-4222-8222-222222222202",
    "unit_amb02": "44444444-4444-4444-8444-444444444401",
    "unit_patrol01": "44444444-4444-4444-8444-444444444402",
    "unit_dmk01": "44444444-4444-4444-8444-444444444403",
    "unit_rescue01": "44444444-4444-4444-8444-444444444404",
    "org_cc": "55555555-5555-4555-8555-555555555501",
    "org_polres": "55555555-5555-4555-8555-555555555502",
    "org_damkar": "55555555-5555-4555-8555-555555555503",
    "org_rsud": "55555555-5555-4555-8555-555555555504",
    "org_rspm": "55555555-5555-4555-8555-555555555505",
    "org_ambulans": "55555555-5555-4555-8555-555555555506",
    "org_bpbd": "55555555-5555-4555-8555-555555555507",
    "user_budi": "66666666-6666-4666-8666-666666666601",
    "user_rina": "66666666-6666-4666-8666-666666666602",
    "user_joko": "66666666-6666-4666-8666-666666666603",
    "session": "77777777-7777-4777-8777-777777777701",
    "attachment": "88888888-8888-4888-8888-888888888801",
    "alert": "99999999-9999-4999-8999-999999999901",
    "alert2": "99999999-9999-4999-8999-999999999902",
    "notification": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
    "resource_request": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb01",
    "eid1": "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
    "eid2": "cccccccc-cccc-4ccc-8ccc-cccccccccc02",
}

SINAR = {"code": "99.99.01", "name": "Kec. Sinar"}
BUKIT = {"code": "99.99.02", "name": "Kec. Bukit"}
MUARA = {"code": "99.99.03", "name": "Kec. Muara"}
MAWAR = {"code": "99.99.01.1001", "name": "Kel. Mawar"}
ANGGREK = {"code": "99.99.02.1001", "name": "Kel. Anggrek"}
PESISIR = {"code": "99.99.03.1001", "name": "Kel. Pesisir"}

TYPES = {
    "TRAFFIC_ACCIDENT": "Kecelakaan Lalu Lintas",
    "FIRE": "Kebakaran",
    "FLOOD": "Banjir",
    "MEDICAL": "Darurat Medis",
    "OTHER": "Lainnya",
}
TYPE_CATEGORIES = {
    "TRAFFIC_ACCIDENT": "TRAFFIC",
    "FIRE": "FIRE",
    "FLOOD": "NATURAL_DISASTER",
    "MEDICAL": "MEDICAL",
    "OTHER": "OTHER",
}


def typ(code: str) -> dict:
    return {"code": code, "name": TYPES[code]}


def typ_full(code: str) -> dict:
    return {"code": code, "name": TYPES[code], "category": TYPE_CATEGORIES[code]}


def org(oid: str, name: str, otype: str) -> dict:
    return {"id": oid, "name": name, "type": otype}


ORGS = {
    "cc": org(IDS["org_cc"], "Pusat Komando Kota Contoh", "OTHER"),
    "polres": org(IDS["org_polres"], "Polres Kota Contoh", "POLICE"),
    "damkar": org(IDS["org_damkar"], "Dinas Pemadam Kebakaran Kota Contoh", "FIRE"),
    "rsud": org(IDS["org_rsud"], "RSUD Kota Contoh", "HOSPITAL"),
    "rspm": org(IDS["org_rspm"], "RS Pratama Muara", "HOSPITAL"),
    "ambulans": org(IDS["org_ambulans"], "Layanan Ambulans Kota Contoh", "AMBULANCE"),
    "bpbd": org(IDS["org_bpbd"], "BPBD Kota Contoh", "BPBD"),
}


def unit(uid_: str, name: str, status: str) -> dict:
    return {"id": uid_, "name": name, "status": status}


def coords(lat: float, lng: float) -> dict:
    return {"lat": lat, "lng": lng}


def page(next_cursor: str | None = None, has_more: bool = False) -> dict:
    return {"nextCursor": next_cursor, "hasMore": has_more}


def token_pair() -> dict:
    return {
        "accessToken": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2NjY2NjY2Ni02NjYtNDY2Ni04NjY2LTY2NjY2NjY2NjY2Iiwic2lkIjoiNzc3Nzc3NzctNzc3Ny00Nzc3LTg3NzctNzc3Nzc3Nzc3NzcxIn0.sampel-signature-bukan-token-nyata",
        "accessTokenExpiresIn": 900,
        "refreshToken": "sampel-refresh-token-2026-opaque",
        "refreshTokenExpiresIn": 43200,
        "user": {
            "id": IDS["user_rina"],
            "userType": "STAFF",
            "fullName": "Dispatcher Rina",
            "roles": ["DISPATCHER"],
        },
    }


def me_citizen() -> dict:
    return {
        "id": IDS["user_budi"],
        "userType": "CITIZEN",
        "fullName": "Budi",
        "phone": "0812-0000-0001",
        "homeRegion": MAWAR,
        "homePoint": coords(-7.225, 112.690),
        "reputation": 0,
        "status": "ACTIVE",
    }


def me_staff() -> dict:
    return {
        "id": IDS["user_rina"],
        "userType": "STAFF",
        "fullName": "Dispatcher Rina",
        "phone": "0800-0000-1003",
        "email": "dispatcher1@contoh.test",
        "organization": ORGS["cc"],
        "roles": ["DISPATCHER"],
        "status": "ACTIVE",
    }


def offer_incident(distance: int = 1100, severity: str = "HIGH") -> dict:
    return {
        "code": "INC-20261005-000123",
        "type": typ("TRAFFIC_ACCIDENT"),
        "severity": severity,
        "district": BUKIT,
        "village": ANGGREK,
        "distanceM": distance,
    }


def unit_incident(distance: int | None = 1100, severity: str = "HIGH") -> dict:
    return {
        "id": IDS["incident"],
        "code": "INC-20261005-000123",
        "type": typ("TRAFFIC_ACCIDENT"),
        "status": "IN_PROGRESS",
        "publicStatus": "UNIT_EN_ROUTE",
        "severity": severity,
        "escalationLevel": None,
        "district": BUKIT,
        "village": ANGGREK,
        "distanceM": distance,
        "location": coords(-7.275, 112.730),
        "addressText": "Jl. Contoh Raya No. 12, Kel. Anggrek",
        "description": "Kecelakaan dua kendaraan di persimpangan contoh.",
        "attachments": [
            {
                "id": IDS["attachment"],
                "fileName": "lokasi-kejadian.jpg",
                "mimeType": "image/jpeg",
                "kind": "IMAGE",
            }
        ],
        "casualties": {"injured": 2, "deceased": 0, "critical": 1, "missing": 0},
        "otherDispatches": [],
    }


def offer_view(status: str = "OFFERED", origin: str = "DISPATCHER", dtype: str = "RESPOND") -> dict:
    return {
        "dispatchId": IDS["dispatch"],
        "incident": offer_incident(),
        "type": dtype,
        "origin": origin,
        "status": status,
        "offerExpiresAt": "2026-10-05T03:17:00Z",
        "note": "Korban terjebak, bawa peralatan cutters.",
    }


def unit_view(status: str = "ACCEPTED", origin: str = "DISPATCHER", dtype: str = "RESPOND") -> dict:
    return {
        "dispatchId": IDS["dispatch"],
        "incident": unit_incident(),
        "type": dtype,
        "origin": origin,
        "status": status,
        "offerExpiresAt": "2026-10-05T03:17:00Z",
        "note": "Korban terjebak, bawa peralatan cutters.",
        "etaMinutes": 12,
        "destinationOrganization": ORGS["rsud"],
    }


def citizen_report(
    public_status: str = "UNIT_DISPATCHED",
    status: str = "LINKED",
    kind: str = "HELP_REQUEST",
    incident: dict | None = None,
) -> dict:
    return {
        "id": IDS["report"],
        "reportKind": kind,
        "status": status,
        "incident": incident or {"id": IDS["incident"], "code": "INC-20261005-000123"},
        "publicStatus": public_status,
        "location": coords(-7.275, 112.730),
        "addressText": "Jl. Contoh Raya No. 12, Kel. Anggrek",
        "description": "Dua kendaraan tabrakan, ada yang terjepit.",
        "flags": [],
        "operatingNow": True,
        "createdAt": T0,
        "attachments": [],
        "emergencyContacts": [{"name": "Darurat Terpadu (contoh)", "phone": "000-112"}],
    }


def incident_summary(
    code: str,
    status: str,
    severity: str,
    district: dict,
    village: dict,
    lead: dict,
    itype: str = "TRAFFIC_ACCIDENT",
    attention: list | None = None,
    created: str = T0,
) -> dict:
    return {
        "id": IDS["incident"] if code.endswith("123") else IDS["incident2"],
        "code": code,
        "type": typ(itype),
        "status": status,
        "severity": severity,
        "district": district,
        "village": village,
        "leadOrganization": lead,
        "createdAt": created,
        "dispatchSummary": {
            "active": 1,
            "offered": 0,
            "rejected": 0,
            "expired": 0,
            "byOrganization": [{"organization": ORGS["ambulans"], "active": 1}],
        },
        "attentionReasons": attention or [],
    }


def dispatcher_incident(status: str = "IN_PROGRESS", severity: str = "HIGH") -> dict:
    return {
        "id": IDS["incident"],
        "code": "INC-20261005-000123",
        "type": typ("TRAFFIC_ACCIDENT"),
        "status": status,
        "publicStatus": "UNIT_EN_ROUTE",
        "severity": severity,
        "escalationLevel": None,
        "district": BUKIT,
        "village": ANGGREK,
        "location": coords(-7.275, 112.730),
        "addressText": "Jl. Contoh Raya No. 12, Kel. Anggrek",
        "description": "Kecelakaan dua kendaraan di persimpangan contoh.",
        "summary": "Dua korban luka, satu terjepit.",
        "leadOrganization": ORGS["polres"],
        "reporter": {"name": "Budi", "phoneMasked": "0812****0001"},
        "attachments": [],
        "casualties": {"injured": 2, "deceased": 0, "critical": 1, "missing": None},
        "dispatches": [
            {
                "organization": ORGS["ambulans"],
                "unit": unit(IDS["unit_amb02"], "Ambulans 02 (Tengah)", "AVAILABLE"),
                "status": "EN_ROUTE",
                "type": "RESPOND",
            }
        ],
        "lockedBy": None,
        "lockedAt": None,
        "version": 4,
        "createdAt": T0,
        "updatedAt": T2,
    }


def alert_item(
    aid: str,
    level: str,
    status: str,
    title: str,
    body: str,
    category: str = "BANJIR",
    delivery: str = "REGION_TOPIC",
) -> dict:
    return {
        "id": aid,
        "category": category,
        "level": level,
        "status": status,
        "title": title,
        "body": body,
        "instruction": "Hindari genangan dan ikuti arahan petugas.",
        "deliveryMode": delivery,
        "regionIds": ["99.99.03"],
        "startsAt": "2026-10-05T01:00:00Z",
        "expiresAt": "2026-10-05T07:00:00Z",
        "createdAt": "2026-10-05T01:00:00Z",
    }


# ---------------------------------------------------------------------------
# Contoh per operasi sukses (payload = isi `data` bila respons beramplop)
# ---------------------------------------------------------------------------
OPS: dict[str, object] = {
    # 5.1 autentikasi
    "POSTAuthOtpRequest": {"expiresInSeconds": 180, "resendAfterSeconds": 60},
    "POSTAuthCitizenRegister": token_pair(),
    "POSTAuthCitizenLogin": token_pair(),
    "POSTAuthStaffLogin2fa": token_pair(),
    "POSTAuthRefresh": token_pair(),
    "POSTAuth2faSetup": {
        "secret": "JBSWY3DPEHPK3PXP",
        "otpauthUri": "otpauth://totp/Emergency%20Platform?secret=JBSWY3DPEHPK3PXP&issuer=EmergencyPlatform",
    },
    "GETAuthSessions": [
        {
            "id": IDS["session"],
            "platform": "ANDROID",
            "appFlavor": "STAFF",
            "appVersion": "1.0.0",
            "createdAt": T0,
            "lastUsedAt": T2,
            "current": True,
        },
        {
            "id": "77777777-7777-4777-8777-777777777702",
            "platform": "WEB",
            "appFlavor": "STAFF",
            "appVersion": "1.0.0",
            "createdAt": "2026-10-04T02:00:00Z",
            "lastUsedAt": "2026-10-04T08:00:00Z",
            "current": False,
        },
    ],
    # 5.2 akun & konfigurasi
    "GETMe": me_citizen(),
    "PATCHMe": me_citizen(),
    "POSTMeDevices": {
        "id": "77777777-7777-4777-8777-777777777799",
        "platform": "ANDROID",
        "appFlavor": "CITIZEN",
        "appVersion": "1.0.0",
        "fcmToken": "sampel-fcm-token-bukan-token-nyata",
        "pushEnabled": True,
        "createdAt": T0,
    },
    "GETMeAlertTopics": {"topics": ["dev_city", "dev_kec_999901"]},
    "GETConfigPublic": {
        "serverTime": T0,
        "minAppVersion": "1.0.0",
        "operatingHours": {"timezone": "Asia/Jakarta", "mode": "24x7"},
        "operatingNow": True,
        "emergencyContacts": [
            {"name": "Darurat Terpadu (contoh)", "phone": "000-112"},
            {"name": "Polisi (contoh)", "phone": "000-110"},
        ],
        "limits": {"photo_max_mb": 10, "video_max_mb": 50, "max_attachments": 5},
        "disclaimer": "Aplikasi ini bukan pengganti nomor darurat resmi. Untuk kondisi mengancam nyawa, hubungi nomor darurat langsung.",
    },
    "GETIncidentTypes": [typ_full(c) for c in TYPES],
    "GETRegions": [
        {**SINAR, "level": "DISTRICT", "centroid": coords(-7.225, 112.725)},
        {**BUKIT, "level": "DISTRICT", "centroid": coords(-7.275, 112.725)},
        {**MUARA, "level": "DISTRICT", "centroid": coords(-7.325, 112.725)},
        {**MAWAR, "level": "VILLAGE", "centroid": coords(-7.225, 112.6875)},
        {**ANGGREK, "level": "VILLAGE", "centroid": coords(-7.275, 112.6875)},
        {**PESISIR, "level": "VILLAGE", "centroid": coords(-7.325, 112.6875)},
    ],
    "GETRegionsResolve": {
        "inServiceArea": True,
        "district": SINAR,
        "village": MAWAR,
    },
    # 5.3 lampiran
    "POSTAttachmentsUploads": {
        "attachmentId": IDS["attachment"],
        "uploadUrl": "https://minio.contoh.test/uploads/sampel?X-Amz-Expires=900",
        "expiresAt": "2026-10-05T03:30:00Z",
    },
    "GETAttachmentsIdUrl": {
        "url": "https://minio.contoh.test/attachments/sampel?X-Amz-Expires=900",
        "expiresAt": "2026-10-05T03:30:00Z",
    },
    # 5.4 laporan warga
    "POSTReports": citizen_report(),
    "GETReportsMine": [
        citizen_report("UNIT_DISPATCHED", "LINKED", "HELP_REQUEST"),
        citizen_report("RECEIVED", "NEW", "CONDITION_REPORT"),
        citizen_report("VERIFIED", "REVIEWED", "HELP_REQUEST"),
        citizen_report("UNIT_EN_ROUTE", "LINKED", "HELP_REQUEST"),
        citizen_report("UNIT_ON_SCENE", "LINKED", "HELP_REQUEST"),
        citizen_report("RESOLVED", "LINKED", "HELP_REQUEST"),
        citizen_report("NOT_VALID", "REVIEWED", "CONDITION_REPORT"),
        citizen_report("OUT_OF_AREA", "REVIEWED", "HELP_REQUEST", incident=None)
        | {"incident": None, "flags": ["OUT_OF_AREA"], "id": IDS["report2"]},
    ],
    "GETReportsId": citizen_report(),
    "GETReportsIdTimeline": [
        {
            "id": IDS["report"],
            "at": T0,
            "text": "Laporan diterima.",
            "visibility": "PUBLIC",
        },
        {
            "id": IDS["report2"],
            "at": T1,
            "text": "Unit menuju lokasi.",
            "visibility": "PUBLIC",
        },
    ],
    "POSTReportsIdFollowUps": citizen_report(public_status="RECEIVED", status="NEW"),
    "POSTReportsIdRevealContact": {"name": "Budi", "phone": "0812-0000-0001"},
    # 5.5 incident
    "GETIncidents": [
        incident_summary("INC-20261005-000123", "IN_PROGRESS", "HIGH", BUKIT, ANGGREK, ORGS["polres"]),
        incident_summary("INC-20261005-000124", "SUBMITTED", "MEDIUM", SINAR, MAWAR, ORGS["polres"], itype="MEDICAL"),
        incident_summary("INC-20261005-000125", "VERIFIED", "CRITICAL", MUARA, PESISIR, ORGS["bpbd"], itype="FLOOD", attention=["SUGGESTED_DUPLICATE"]),
        incident_summary("INC-20261005-000126", "RESOLVED", "LOW", SINAR, MAWAR, ORGS["damkar"], itype="FIRE"),
        incident_summary("INC-20261005-000127", "CLOSED", "MEDIUM", BUKIT, ANGGREK, ORGS["polres"], created="2026-10-04T01:00:00Z"),
        incident_summary("INC-20261005-000128", "INVALID", "LOW", MUARA, PESISIR, ORGS["polres"], itype="OTHER"),
        incident_summary("INC-20261005-000129", "DUPLICATE", "MEDIUM", BUKIT, ANGGREK, ORGS["polres"], attention=["SUGGESTED_DUPLICATE"]),
    ],
    "POSTIncidents": dispatcher_incident(status="SUBMITTED"),
    "GETIncidentsIdNearby": [
        incident_summary("INC-20261005-000130", "IN_PROGRESS", "MEDIUM", BUKIT, ANGGREK, ORGS["polres"])
    ],
    "GETIncidentsIdReports": [citizen_report(), citizen_report(public_status="VERIFIED", status="REVIEWED")],
    "GETIncidentsIdEvents": [
        {"id": "1001", "type": "incident.verified", "occurredAt": T0, "actorName": "Dispatcher Rina"},
        {"id": "1002", "type": "dispatch.created", "occurredAt": T1, "channel": "PHONE", "actorName": "Dispatcher Rina"},
        {"id": "1003", "type": "incident.milestone_recorded", "occurredAt": T2, "code": "SCENE_RELEASED", "note": "Berbaikan"},
        {"id": "1004", "type": "incident.milestone_recorded", "occurredAt": T2, "code": "ROAD_REOPENED"},
        {"id": "1005", "type": "incident.milestone_recorded", "occurredAt": T2, "code": "VICTIM_DECEASED_HANDLED"},
        {"id": "1006", "type": "incident.milestone_recorded", "occurredAt": T2, "code": "EXTERNAL_UNIT_ARRIVED"},
        {"id": "1007", "type": "incident.milestone_recorded", "occurredAt": T2, "code": "EXTERNAL_COORDINATION"},
        {"id": "1008", "type": "incident.note_added", "occurredAt": T2, "noteId": "note-1", "visibility": "LEAD"},
    ],
    "GETIncidentsIdDispatchRecommendations": [
        {"organization": ORGS["ambulans"], "dispatchType": "RESPOND", "required": True, "alreadyDispatched": False},
        {"organization": ORGS["polres"], "dispatchType": "RESPOND", "required": True, "alreadyDispatched": True},
        {"organization": ORGS["damkar"], "dispatchType": "RESPOND", "required": False, "alreadyDispatched": False},
    ],
    "POSTIncidentsIdDispatches": offer_view(),
    "POSTIncidentsIdDispatchesBatch": [offer_view(), offer_view(origin="DISPATCHER")],    # 5.6 dispatch
    "GETDispatchesMine": [
        offer_view("OFFERED"),
        offer_view("NOTIFIED", dtype="NOTIFY"),
        unit_view("ACCEPTED"),
        unit_view("EN_ROUTE"),
        unit_view("ON_SCENE"),
        unit_view("DONE"),
        offer_view("REJECTED"),
        offer_view("EXPIRED"),
        offer_view("CANCELLED"),
        offer_view("READY", dtype="NOTIFY"),
        offer_view("FULL", dtype="NOTIFY"),
        offer_view("PATIENT_ARRIVED", dtype="NOTIFY"),
    ],
    "GETDispatchesId": offer_view(),
    "POSTDispatchesIdAccept": unit_view(),
    # 5.7 resource request
    "GETResourceRequests": [
        {
            "id": IDS["resource_request"],
            "incident": {"id": IDS["incident"], "code": "INC-20261005-000123"},
            "resourceType": "AMBULANCE",
            "quantity": 1,
            "urgency": "URGENT",
            "reason": "Korban terjepit butuh evakuasi cepat.",
            "status": "PENDING",
            "requestedBy": {"id": IDS["user_rina"], "fullName": "Dispatcher Rina"},
            "createdAt": T1,
        },
        {
            "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb02",
            "incident": {"id": IDS["incident2"], "code": "INC-20261005-000124"},
            "resourceType": "RESCUE_TEAM",
            "quantity": 1,
            "urgency": "NORMAL",
            "reason": "Pemindahan pohon tumbang.",
            "status": "APPROVED",
            "requestedBy": {"id": IDS["user_rina"], "fullName": "Dispatcher Rina"},
            "createdAt": "2026-10-05T02:00:00Z",
        },
    ],
    # 5.8 unit
    "GETUnits": [
        unit(IDS["unit_amb02"], "Ambulans 02 (Tengah)", "AVAILABLE"),
        unit(IDS["unit_patrol01"], "Patroli 01", "BUSY"),
        unit(IDS["unit_dmk01"], "Mobil Pemadam Pos Utara", "OFFLINE"),
        unit(IDS["unit_rescue01"], "Tim Reaksi Cepat 01", "OUT_OF_SERVICE"),
    ],
    # 5.9 alert
    "GETAlerts": [
        alert_item(IDS["alert"], "INFO", "ACTIVE", "Cuaca buruk di Kec. Sinar", "Hujan lebat diperkirakan sampai sore."),
        alert_item(IDS["alert2"], "WARNING", "ACTIVE", "Genangan air di Kel. Mawar", "Jalur utama terendam 20 cm."),
    ],
    "GETAlertsId": alert_item(IDS["alert"], "ALERT", "ACTIVE", "Banjir di Kec. Muara", "Air masuk permukiman."),
    "GETAdminAlerts": [
        alert_item(IDS["alert"], "INFO", "DRAFT", "Uji siaga banjir", "Ini adalah draft alert uji."),
        alert_item(IDS["alert2"], "WARNING", "ACTIVE", "Genangan air di Kel. Mawar", "Jalur utama terendam 20 cm."),
        alert_item("99999999-9999-4999-8999-999999999903", "EMERGENCY", "CLOSED", "Banjir surut", "Air telah surut."),
    ],
    "GETConditionReports": [
        {
            "reportId": IDS["report2"],
            "typeCode": "FLOOD",
            "district": PESISIR,
            "location": coords(-7.330, 112.700),
            "createdAt": T1,
        }
    ],
    # 5.10 notifikasi
    "GETNotifications": [
        {
            "id": IDS["notification"],
            "kind": "DISPATCH_OFFER",
            "title": "Penugasan baru: Kecelakaan Lalu Lintas",
            "body": "Kec. Bukit, ±1,1 km.",
            "readAt": None,
            "createdAt": T1,
        },
        {
            "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
            "kind": "REPORT_UPDATE",
            "title": "Laporan Anda diperbarui",
            "body": "Unit menuju lokasi.",
            "readAt": T2,
            "createdAt": T2,
        },
    ],
    "GETNotificationsUnreadCount": {"count": 3},
    # 5.11 shift & dashboard
    "GETShiftsCurrent": {
        "id": "77777777-7777-4777-8777-777777777750",
        "startedAt": T0,
        "startedBy": {"id": IDS["user_rina"], "fullName": "Dispatcher Rina"},
        "openIncidents": 4,
        "handoverNote": "Antrean normal, satu offer menunggu.",
    },
    "GETShiftsHandover": [
        {
            "shiftId": "77777777-7777-4777-8777-777777777751",
            "endedAt": "2026-10-04T08:00:00Z",
            "endedBy": {"id": IDS["user_rina"], "fullName": "Dispatcher Rina"},
            "note": "Serah terima malam, tanpa insiden terbuka.",
        }
    ],
    "GETDashboardSummary": {
        "incidentsByStatus": {"SUBMITTED": 2, "VERIFIED": 1, "IN_PROGRESS": 4, "RESOLVED": 3, "CLOSED": 8},
        "activeDispatches": 6,
        "pendingOffers": 1,
        "availableUnits": 7,
        "avgResponseTimeSeconds": 645.5,
    },
    # 5.13 sinkronisasi
    "GETSyncSnapshot": {"lastEventId": "1008"},
    "GETSyncEvents": [
        {"id": "1007", "type": "dispatch.status_changed", "incidentId": IDS["incident"], "occurredAt": T2},
        {"id": "1008", "type": "incident.milestone_recorded", "incidentId": IDS["incident"], "occurredAt": T2},
    ],
    # 5.12 administrasi
    "GETOrganizations": [
        ORGS["polres"],
        ORGS["damkar"],
        ORGS["rsud"],
        ORGS["rspm"],
        ORGS["ambulans"],
        ORGS["bpbd"],
    ],
    "GETOrganizationsIdUnits": [
        unit(IDS["unit_patrol01"], "Patroli 01", "AVAILABLE"),
        unit("44444444-4444-4444-8444-444444444405", "Patroli 02", "AVAILABLE"),
    ],
    "GETOrganizationsIdStaff": [
        {"id": IDS["user_joko"], "fullName": "Paramedis Joko", "roles": ["RESPONDER"], "status": "ACTIVE"},
        {"id": "66666666-6666-4666-8666-666666666604", "fullName": "Paramedis Indra", "roles": ["RESPONDER"], "status": "ACTIVE"},
    ],
    "GETUsers": [
        {"id": IDS["user_rina"], "fullName": "Dispatcher Rina", "userType": "STAFF", "roles": ["DISPATCHER"], "status": "ACTIVE"},
        {"id": "66666666-6666-4666-8666-666666666605", "fullName": "Contoh Ditangguhkan", "userType": "STAFF", "roles": ["RESPONDER"], "status": "SUSPENDED"},
        {"id": "66666666-6666-4666-8666-666666666606", "fullName": "Contoh Dinonaktifkan", "userType": "STAFF", "roles": ["RESPONDER"], "status": "DEACTIVATED"},
    ],
    "GETRoles": [
        {"code": "CITIZEN", "name": "Warga"},
        {"code": "RESPONDER", "name": "Responder"},
        {"code": "DISPATCHER", "name": "Dispatcher"},
        {"code": "SUPERVISOR", "name": "Supervisor"},
        {"code": "ORG_ADMIN", "name": "Admin Organisasi"},
        {"code": "ALERT_MANAGER", "name": "Pengelola Alert"},
        {"code": "SUPER_ADMIN", "name": "Super Admin"},
    ],
    "GETPermissions": [
        "report.create",
        "report.read_own",
        "incident.read_all",
        "incident.verify",
        "dispatch.create",
        "dispatch.respond",
        "unit.update_own",
        "alert.create",
        "settings.manage",
        "audit.read_all",
    ],
    "GETAuditLogs": [
        {
            "id": "9001",
            "action": "incident.verify",
            "actor": {"id": IDS["user_rina"], "fullName": "Dispatcher Rina"},
            "targetType": "incident",
            "targetId": IDS["incident"],
            "createdAt": T0,
        }
    ],
    "GETSettings": {
        "offer_timeout_seconds": 120,
        "offer_unseen_seconds": 60,
        "incident_lock_seconds": 300,
        "auto_close_hours": 24,
        "min_app_version": "1.0.0",
        "sample_mode": True,
    },
}

# Varian per bentuk (handoff §6.5 #1, #2)
OP_VARIANTS: dict[str, dict[str, object]] = {
    "POSTAuthStaffLogin": {
        "tokenPair": token_pair(),
        "twoFactor": {"twoFactorRequired": True, "challengeToken": "sampel-challenge-token-2fa"},
    },
    "GETIncidentsId": {
        "dispatcherView": dispatcher_incident(),
        "offerView": offer_view(),
        "unitView": unit_view(),
    },
    "GETDispatchesId": {
        "offerView": offer_view(),
        "unitView": unit_view(),
        "offerViewOptionalNull": offer_view() | {"offerExpiresAt": None, "note": None},
        "offerViewOptionalAbsent": {k: v for k, v in offer_view().items() if k not in ("offerExpiresAt", "note")},
    },
}

# Field tingkat-atas di luar `data` (mis. /sync/events)
OP_EXTRAS: dict[str, dict] = {
    "GETSyncEvents": {"lastId": "1008", "hasMore": False, "resetRequired": False},
}

# ---------------------------------------------------------------------------
# Contoh galat per kode (REST §7) — amplop penuh
# ---------------------------------------------------------------------------
ERRORS: dict[str, dict] = {
    "VALIDATION_FAILED": {
        "message": "Data tidak valid.",
        "details": [{"field": "typeCode", "issue": "required"}],
    },
    "UNAUTHENTICATED": {"message": "Sesi tidak valid atau sudah kedaluwarsa."},
    "REFRESH_TOKEN_REUSED": {"message": "Refresh token sudah dipakai sebelumnya, seluruh sesi dicabut."},
    "OTP_INVALID": {"message": "Kode OTP salah."},
    "OTP_EXPIRED": {"message": "Kode OTP sudah kedaluwarsa."},
    "TWO_FACTOR_REQUIRED": {"message": "Login memerlukan kode 2FA."},
    "FORBIDDEN": {"message": "Anda tidak memiliki izin untuk aksi ini."},
    "NOT_LEAD_ORGANIZATION": {"message": "Hanya lead organisation yang boleh melakukan aksi ini."},
    "ACCOUNT_DEACTIVATED": {"message": "Akun dinonaktifkan."},
    "NOT_FOUND": {"message": "Data tidak ditemukan."},
    "VERSION_CONFLICT": {"message": "Data telah diubah pihak lain.", "currentVersion": 5},
    "INCIDENT_LOCKED": {"message": "Incident sedang dikunci oleh pengguna lain."},
    "LOCK_REQUIRED": {"message": "Aksi ini memerlukan kunci incident."},
    "INVALID_STATUS_TRANSITION": {
        "message": "Dispatch tidak dapat berpindah dari DONE ke EN_ROUTE.",
        "details": [{"field": "toStatus", "issue": "not_allowed_from_current"}],
    },
    "INCIDENT_NOT_DISPATCHABLE": {"message": "Status incident tidak dapat didispatch."},
    "ACTIVE_DISPATCHES_EXIST": {"message": "Masih ada dispatch aktif untuk organisasi ini."},
    "UNIT_NOT_AVAILABLE": {"message": "Unit tidak tersedia."},
    "OFFER_NO_LONGER_AVAILABLE": {"message": "Offer sudah tidak berlaku."},
    "DISPATCH_ALREADY_ACCEPTED": {"message": "Dispatch sudah diterima responder lain."},
    "RESOURCE_REQUEST_ALREADY_DECIDED": {"message": "Permintaan bantuan sudah diputuskan."},
    "ATTACHMENT_EXPIRED": {"message": "Tautan lampiran sudah kedaluwarsa."},
    "REPORT_KIND_NOT_ALLOWED": {"message": "Jenis laporan tidak diizinkan untuk insiden ini."},
    "IDEMPOTENCY_CONFLICT": {"message": "Permintaan duplikat dengan isi berbeda."},
    "ATTACHMENT_INVALID": {"message": "Lampiran tidak valid."},
    "OCCURRED_AT_OUT_OF_RANGE": {"message": "Waktu kejadian di luar rentang yang diizinkan."},
    "RATE_LIMITED": {"message": "Terlalu banyak permintaan, coba lagi nanti."},
    "OTP_TOO_MANY_ATTEMPTS": {"message": "Terlalu banyak percobaan kode OTP."},
    "SERVICE_UNAVAILABLE": {"message": "Layanan sedang tidak tersedia."},
    "INTERNAL_ERROR": {"message": "Terjadi kesalahan pada server."},
}

# ---------------------------------------------------------------------------
# Data per event WebSocket (amplop ditambahkan saat render)
# ---------------------------------------------------------------------------
WS_DATA: dict[str, object] = {
    "connection.ready": {
        "serverTime": T0,
        "userId": IDS["user_rina"],
        "rooms": ["role:dispatcher", "org:55555555-5555-4555-8555-555555555501"],
        "minAppVersion": "1.0.0",
        "resyncRecommended": True,
    },
    "auth.expiring": {"expiresInSeconds": 90},
    "auth.expired": {},
    "session.revoked": {"reason": "REFRESH_REUSE"},
    "system.notice": {"level": "INFO", "message": "Pemeliharaan terjadwal pukul 02.00 WIB."},
    "incident.created": {
        "incident": incident_summary("INC-20261005-000123", "SUBMITTED", "HIGH", BUKIT, ANGGREK, ORGS["polres"]),
        "suggestedIncidentId": None,
        "flags": [],
    },
    "incident.report_added": {
        "reportId": IDS["report"],
        "kind": "FOLLOW_UP",
        "incident": incident_summary("INC-20261005-000123", "IN_PROGRESS", "HIGH", BUKIT, ANGGREK, ORGS["polres"]),
    },
    "incident.updated": {"changes": {"severity": "CRITICAL", "escalationLevel": 1}},
    "incident.location_updated": {"location": coords(-7.275, 112.730), "addressText": "Jl. Contoh Raya No. 12"},
    "incident.status_changed": {
        "from": "VERIFIED",
        "to": "IN_PROGRESS",
        "incident": incident_summary("INC-20261005-000123", "IN_PROGRESS", "HIGH", BUKIT, ANGGREK, ORGS["polres"]),
    },
    "incident.locked": {"lockedBy": {"id": IDS["user_rina"], "name": "Dispatcher Rina"}, "lockExpiresAt": T1},
    "incident.unlocked": {"lockedBy": {"id": IDS["user_rina"], "name": "Dispatcher Rina"}},
    "incident.lock_overridden": {
        "previousHolder": {"id": IDS["user_rina"], "name": "Dispatcher Rina"},
        "newHolder": {"id": "66666666-6666-4666-8666-666666666607", "name": "Supervisor Hendra"},
        "reason": "Perlu koreksi mendesak.",
    },
    "incident.merged": {"sourceId": IDS["incident2"], "targetId": IDS["incident"]},
    "incident.lead_changed": {"leadOrganization": ORGS["bpbd"]},
    "incident.casualties_updated": {"injured": 2, "deceased": 0, "critical": 1, "missing": None, "reportedAt": T1},
    "incident.milestone_recorded": {"code": "SCENE_RELEASED", "note": "Lokasi aman", "payload": None, "occurredAt": T2},
    "incident.note_added": {"noteId": "note-1", "visibility": "LEAD"},
    "dispatch.offered": {
        "offer": offer_view(),
        "offerExpiresAt": "2026-10-05T03:17:00Z",
    },
    "dispatch.notified": {
        "incidentType": "Kecelakaan Lalu Lintas",
        "casualties": {"injured": 2, "deceased": 0},
        "etaMinutes": 12,
        "sourceDispatchId": IDS["dispatch"],
    },
    "dispatch.created": {"dispatch": offer_view()},
    "dispatch.accepted": {
        "dispatchId": IDS["dispatch"],
        "acceptedBy": {"id": IDS["user_joko"], "name": "Paramedis Joko"},
        "unit": unit(IDS["unit_amb02"], "Ambulans 02 (Tengah)", "AVAILABLE"),
        "etaMinutes": 12,
    },
    "dispatch.rejected": {"dispatchId": IDS["dispatch"], "organization": ORGS["ambulans"], "reason": "Unit semua bertugas."},
    "dispatch.expired": {"dispatchId": IDS["dispatch"], "organization": ORGS["ambulans"]},
    "dispatch.cancelled": {"dispatchId": IDS["dispatch"], "reason": "Kesalahan penugasan."},
    "dispatch.self_initiated": {"dispatch": offer_view(origin="SELF_INITIATED"), "channel": "PHONE"},
    "dispatch.status_changed": {
        "dispatchId": IDS["dispatch"],
        "from": "ACCEPTED",
        "to": "EN_ROUTE",
        "occurredAt": T1,
        "recordedBy": {"id": IDS["user_joko"], "name": "Paramedis Joko"},
        "channel": None,
        "organization": ORGS["ambulans"],
    },
    "dispatch.offer_unseen": {"dispatchId": IDS["dispatch"], "organization": ORGS["ambulans"], "secondsSinceOffer": 60},
    "resource_request.created": {
        "requestId": IDS["resource_request"],
        "incident": incident_summary("INC-20261005-000123", "IN_PROGRESS", "HIGH", BUKIT, ANGGREK, ORGS["polres"]),
        "resourceType": "AMBULANCE",
        "quantity": 1,
        "urgency": "URGENT",
        "reason": "Korban terjepit butuh evakuasi cepat.",
    },
    "resource_request.decided": {"requestId": IDS["resource_request"], "status": "APPROVED", "note": "Unit cadangan dikirim."},
    "report.status_changed": {
        "reportId": IDS["report"],
        "publicStatus": "UNIT_DISPATCHED",
        "message": "Petugas menuju lokasi.",
    },
    "report.timeline_updated": {"reportId": IDS["report"], "entry": {"ts": T1, "text": "Unit menuju lokasi."}},
    "alert.published": {
        "alert": alert_item(IDS["alert"], "INFO", "ACTIVE", "Cuaca buruk di Kec. Sinar", "Hujan lebat diperkirakan sampai sore.")
    },
    "alert.updated": {"alertId": IDS["alert2"], "changes": {"body": "Genangan bertambah di Jl. Contoh."}},
    "alert.closed": {"alertId": IDS["alert"]},
    "notification.created": {"notificationId": IDS["notification"], "kind": "DISPATCH_OFFER", "title": "Penugasan baru", "unreadCount": 3},
    "unit.status_changed": {"unitId": IDS["unit_amb02"], "status": "BUSY"},
    "unit.location_updated": {"unitId": IDS["unit_amb02"], "location": coords(-7.275, 112.720), "recordedAt": T1},
    # klien -> server
    "ack": {"eid": IDS["eid1"], "state": "SEEN", "at": T1},
    "auth.refresh": {"accessToken": "eyJhbGciOiJIUzI1NiJ9.sampel-token-baru"},
    "app.state": {"state": "BACKGROUND"},
    "unit.location": {"lat": -7.275, "lng": 112.720, "accuracyM": 8.5, "recordedAt": T1, "heading": 90.0, "speedMps": 12.3},
}

S2C_CLASS_ACK: dict[str, tuple[str, bool]] = {}


def resolve_schema(doc: dict, ref: str) -> dict:
    node = doc
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


def unwrap_props(doc: dict, schema: dict) -> dict:
    """Gabungkan properties tingkat-atas (lewati allOf / $ref satu tingkat)."""
    props: dict = {}
    if "$ref" in schema:
        schema = resolve_schema(doc, schema["$ref"])
    for sub in schema.get("allOf", []):
        if "$ref" in sub:
            sub = resolve_schema(doc, sub["$ref"])
        props.update(sub.get("properties", {}))
    props.update(schema.get("properties", {}))
    return props


def main() -> None:
    openapi = yaml.safe_load(OPENAPI.read_text(encoding="utf-8"))
    asyncapi = yaml.safe_load(ASYNCAPI.read_text(encoding="utf-8"))

    (OUT / "rest" / "errors").mkdir(parents=True, exist_ok=True)
    (OUT / "ws").mkdir(parents=True, exist_ok=True)

    # --- rest ---
    written: list[Path] = []
    seen_ops: set[str] = set()
    for path, item in openapi["paths"].items():
        for method, op in item.items():
            if method not in ("get", "post", "patch", "put", "delete"):
                continue
            op_id = op["operationId"]
            success = [
                (c, r)
                for c, r in sorted(op["responses"].items())
                if c.startswith("2") and c != "204" and r.get("content")
            ]
            if not success:
                continue
            seen_ops.add(op_id)
            code, resp = success[0]
            schema = next(iter(resp["content"].values()))["schema"]
            props = unwrap_props(openapi, schema)

            variants = OP_VARIANTS.get(op_id)
            if variants is None:
                payloads = {"": OPS[op_id]}
            else:
                payloads = variants

            for variasi, payload in payloads.items():
                if "data" in props:
                    body = {"data": payload}
                    if "page" in props:
                        body["page"] = page()
                    body.update(OP_EXTRAS.get(op_id, {}))
                    # pertahankan urutan sesuai required/properties bila memungkinkan
                    ordered = {k: body[k] for k in props if k in body}
                    ordered.update({k: v for k, v in body.items() if k not in ordered})
                    body = ordered
                else:
                    body = payload
                name = f"{op_id}{('.' + variasi) if variasi else ''}.json"
                fp = OUT / "rest" / name
                fp.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                written.append(fp)

    missing = sorted(seen_ops - set(OPS) - set(OP_VARIANTS))
    if missing:
        raise SystemExit(f"OPS belum lengkap untuk: {missing}")

    # --- errors ---
    for code, err in ERRORS.items():
        body = {"error": {"code": code, "message": err["message"], "requestId": "a1b2c3", **{k: v for k, v in err.items() if k != "message"}}}
        fp = OUT / "rest" / "errors" / f"{code}.json"
        fp.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(fp)

    # --- ws ---
    msgs = asyncapi["components"]["messages"]
    for msg in msgs.values():
        typ_ = msg["name"]
        if typ_ not in WS_DATA:
            raise SystemExit(f"WS_DATA belum ada untuk event: {typ_}")
        if msg.get("x-direction") == "s2c":
            rooms = msg.get("x-rooms") or []
            audiences: list[str] = []
            for r in rooms:
                if r == "*":
                    a = "all"
                elif ":" in r:
                    kind, target = r.split(":", 1)
                    # nama berkas = jenis room; placeholder id tidak dipakai
                    a = target if kind == "role" else kind
                else:
                    a = r
                if a and a not in audiences:
                    audiences.append(a)
            cls = msg.get("x-class")
            if cls == "DYNAMIC":
                classes = ["CRITICAL", "STANDARD"]
            else:
                classes = [cls]
        else:
            audiences = ["all"]
            classes = [None]

        for aud in audiences:
            for cls in classes:
                data = WS_DATA[typ_]
                envelope = {
                    "eid": IDS["eid1"],
                    "id": "1008" if typ_ not in ("connection.ready", "system.notice") else None,
                    "type": typ_,
                    "v": 1,
                    "ts": T1,
                    "incidentId": IDS["incident"] if typ_.startswith(("incident.", "dispatch.")) else None,
                    "dispatchId": IDS["dispatch"] if typ_.startswith("dispatch.") else None,
                    "resourceVersion": 4 if typ_.startswith("incident.") else None,
                    "class": cls or "INFO",
                    "ackRequired": bool(msg.get("x-ack-required")),
                    "data": data,
                }
                name = f"{typ_}.{aud}{('.' + cls.lower()) if cls and len(classes) > 1 else ''}.json"
                fp = OUT / "ws" / name
                payload = envelope if msg.get("x-direction") == "s2c" else data
                fp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                written.append(fp)

    print(f"wrote {len(written)} files under {OUT}")


if __name__ == "__main__":
    main()
