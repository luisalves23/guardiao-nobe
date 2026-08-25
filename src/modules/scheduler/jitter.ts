import { StorageService } from '../../services/storage.service.js';

export function getCommentJitterMs(): number {
  const config = StorageService.getInstance().getConfig();
  const cfg = config.commentInterval;
  const minMinutes = cfg?.minMinutes && cfg.minMinutes > 0 ? cfg.minMinutes : 20;
  const maxMinutes = cfg?.maxMinutes && cfg.maxMinutes >= minMinutes ? cfg.maxMinutes : 25;

  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function getRotationJitterMs(): number {
  const config = StorageService.getInstance().getConfig();
  const configuredMinutes = config.rotationLimitMinutes || 230;

  // Se o usuário configurou um valor de teste pequeno (ex: 2 min a 15 min), jitter proporcional de 0-30s
  if (configuredMinutes <= 15) {
    const baseMs = configuredMinutes * 60 * 1000;
    const jitterMs = Math.floor(Math.random() * 30 * 1000);
    return baseMs + jitterMs;
  }

  // Padrão de produção: Entre 230 e 238 minutos (3h50 a 3h58)
  const minMs = configuredMinutes * 60 * 1000;
  const maxMs = (configuredMinutes + 8) * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function formatTodayDate(d = new Date()): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return formatter.format(d);
}

export function getBrasiliaHoursMinutes(d = new Date()): { hours: number; minutes: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  // 0 = Dom, 1 = Seg, ..., 6 = Sab
  const dayOfWeek = d.getDay();
  return { hours: hour, minutes: minute, dayOfWeek };
}

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}h${pad(minutes)}min${pad(seconds)}seg`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

