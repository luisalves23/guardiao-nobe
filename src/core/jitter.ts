/**
 * Utilitários para geração de Jitter (intervalos pseudo-aleatórios realistas)
 * para evitar padrões fixos e detecção por robôs ou análise estatística.
 */

/**
 * Retorna um intervalo em milissegundos entre minMinutes e maxMinutes (com segundos aleatórios).
 */
export function getRandomIntervalMs(minMinutes: number, maxMinutes: number): number {
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Intervalo para comentários em blocos: entre 20 e 25 minutos.
 * Com o timeout de resposta de 2 minutos, o comentário é SEMPRE postado
 * entre 20 e 27 minutos (muito antes do limite fatal de 30 minutos).
 */
export function getCommentJitterMs(): number {
  return getRandomIntervalMs(20, 25);
}

/**
 * Intervalo para rotação do card de 4h: entre 230 e 238 minutos (3h50 a 3h58).
 * Garante que a rotação ocorra antes do teto de 4h00 da empresa.
 */
export function getRotationJitterMs(): number {
  return getRandomIntervalMs(230, 238);
}

/**
 * Formata a data atual no formato brasileiro estrito DD/MM/AAAA no fuso horário de Brasília.
 */
export function formatTodayDate(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return formatter.format(date);
}

/**
 * Formata milissegundos em formato legível mm:ss ou hh:mm:ss.
 */
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
