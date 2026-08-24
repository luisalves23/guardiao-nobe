import { StorageService } from '../../services/storage.service.js';

export function getCommentJitterMs(): number {
  // Entre 20 e 25 minutos
  const minMs = 20 * 60 * 1000;
  const maxMs = 25 * 60 * 1000;
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
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}h${pad(minutes)}min${pad(seconds)}seg`;
}
