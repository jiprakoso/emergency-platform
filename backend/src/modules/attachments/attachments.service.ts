import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Attachment } from '../../database/entities/attachment.entity';
import { CreateUploadDto } from './dto/attachments.dto';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { AuthPrincipal } from '../auth/auth.types';
import { PermissionService } from '../permissions/permission.service';

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly clock: ClockService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Lampiran yang boleh diakses pemanggil; selain itu 404 (keberadaan tidak bocor).
   * `forRead`: pemegang `incident.read_all` juga boleh membaca. Akses responder
   * pasca-accept (`UnitView`, REST §4.1) dibuka bersama serializer view.
   */
  private async findAccessible(id: string, principal: AuthPrincipal | undefined, forRead: boolean): Promise<Attachment> {
    const att = await this.attachments.findOne({ where: { id } });
    const userId = principal?.userId;
    if (!att || !userId) throw AppError.notFound('Lampiran tidak ditemukan.');
    if (att.uploadedBy === userId) return att;
    if (forRead && (await this.permissions.hasPermission(userId, 'incident.read_all'))) return att;
    throw AppError.notFound('Lampiran tidak ditemukan.');
  }

  async createUpload(principal: AuthPrincipal | undefined, body: CreateUploadDto) {
    // Tanpa object storage nyata di lingkungan ini; buat attachment PENDING dengan presigned URL contoh
    // agar alur sesuai kontrak (PUT lalu confirm). URL bisa berupa contoh.
    const id = randomUUID();
    const storageKey = `uploads/${id}/${body.fileName}`;
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const attachment = this.attachments.create({
      id,
      incidentId: null,
      reportId: null,
      dispatchId: null,
      uploadedBy: principal?.userId ?? null,
      kind: body.kind,
      status: 'PENDING',
      storageKey,
      mimeType: body.mimeType,
      sizeBytes: String(body.sizeBytes),
      createdAt: now,
    });
    await this.attachments.save(attachment);

    return {
      attachmentId: id,
      uploadUrl: `https://minio.contoh.test/uploads/sampel?X-Amz-Expires=900`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirm(id: string, principal: AuthPrincipal | undefined) {
    const att = await this.findAccessible(id, principal, false);
    if (att.status === 'CONFIRMED') {
      return {
        id: att.id,
        kind: att.kind,
        status: att.status,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes ? Number(att.sizeBytes) : null,
        incidentId: att.incidentId,
        reportId: att.reportId,
        confirmedAt: att.confirmedAt?.toISOString() ?? this.clock.nowIso(),
      };
    }
    att.status = 'CONFIRMED';
    att.confirmedAt = this.clock.now();
    await this.attachments.save(att);
    return {
      id: att.id,
      kind: att.kind,
      status: att.status,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes ? Number(att.sizeBytes) : null,
      incidentId: att.incidentId,
      reportId: att.reportId,
      confirmedAt: att.confirmedAt.toISOString(),
    };
  }

  async getUrl(id: string, principal: AuthPrincipal | undefined) {
    const att = await this.findAccessible(id, principal, true);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    return {
      url: `https://minio.contoh.test/read/${att.storageKey}?X-Amz-Expires=300`,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
