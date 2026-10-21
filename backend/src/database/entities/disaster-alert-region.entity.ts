import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { DisasterAlert } from './disaster-alert.entity';
import { Region } from './region.entity';

@Entity('disaster_alert_regions')
export class DisasterAlertRegion {
  @PrimaryColumn({ name: 'alert_id', type: 'uuid' })
  alertId!: string;

  @PrimaryColumn({ name: 'region_id', type: 'uuid' })
  regionId!: string;

  @ManyToOne(() => DisasterAlert, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alert_id' })
  alert!: DisasterAlert;

  @ManyToOne(() => Region, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'region_id' })
  region!: Region;
}
