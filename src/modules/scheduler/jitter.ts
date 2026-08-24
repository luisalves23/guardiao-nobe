export function getCommentJitterMs(): number {
  // Entre 20 e 25 minutos
  const minMs = 20 * 60 * 1000;
  const maxMs = 25 * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function getRotationJitterMs(): number {
  // Entre 230 e 238 minutos (3h50 a 3h58)
  const minMs = 230 * 60 * 1000;
  const maxMs = 238 * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function formatTodayDate(d = new Date()): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
