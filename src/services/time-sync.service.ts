import axios from 'axios';

export class TimeSyncService {
  private static instance: TimeSyncService;
  private timeOffsetMs: number = 0;
  private lastSyncTimestamp: number = 0;

  private constructor() {}

  public static getInstance(): TimeSyncService {
    if (!TimeSyncService.instance) {
      TimeSyncService.instance = new TimeSyncService();
    }
    return TimeSyncService.instance;
  }

  public async syncTime(): Promise<{ offsetMs: number; isAccurate: boolean }> {
    try {
      const start = Date.now();
      const res = await axios.get('https://worldtimeapi.org/api/timezone/America/Sao_Paulo', {
        timeout: 4000,
      });
      const end = Date.now();
      const latency = (end - start) / 2;

      if (res.data && res.data.unixtime) {
        const networkTimeMs = (res.data.unixtime * 1000) + latency;
        this.timeOffsetMs = networkTimeMs - Date.now();
        this.lastSyncTimestamp = Date.now();
        const isAccurate = Math.abs(this.timeOffsetMs) < 5000;
        if (!isAccurate) {
          console.warn(`[TimeSyncService] ⚠️ Desvio de relógio detectado: ${this.timeOffsetMs}ms.`);
        }
        return { offsetMs: this.timeOffsetMs, isAccurate };
      }
    } catch {
      // Se a rede falhar, assume offset 0 e relógio local
    }
    return { offsetMs: this.timeOffsetMs, isAccurate: true };
  }

  public getNow(): Date {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  public getOffsetMs(): number {
    return this.timeOffsetMs;
  }
}
