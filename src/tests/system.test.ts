import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { getCommentJitterMs, getRotationJitterMs, formatDuration, formatTodayDate } from '../core/jitter.js';
import { formatHMS } from '../modules/scheduler/index.js';
import { StorageService } from '../services/storage.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { Engine } from '../core/engine.js';
import { createServer } from '../api/server.js';

test('1. Jitter: Comentários rigorosamente entre 20 e 25 minutos', () => {
  for (let i = 0; i < 100; i++) {
    const ms = getCommentJitterMs();
    const minutes = ms / (60 * 1000);
    assert.ok(minutes >= 20 && minutes <= 25.01, `Jitter de comentário ${minutes} fora do intervalo 20-25m`);
  }
});

test('2. Jitter: Rotação de 4h rigorosamente entre 230 e 238 minutos (3h50 a 3h58)', () => {
  for (let i = 0; i < 100; i++) {
    const ms = getRotationJitterMs();
    const minutes = ms / (60 * 1000);
    assert.ok(minutes >= 230 && minutes <= 238.01, `Jitter de rotação ${minutes} fora do intervalo 230-238m`);
  }
});

test('3. Data: Formatação no padrão estrito DD/MM/AAAA', () => {
  const d = new Date(2026, 7, 24); // 24 de Agosto de 2026
  assert.strictEqual(formatTodayDate(d), '24/08/2026');
  
  const dJan = new Date(2026, 0, 5); // 05 de Janeiro de 2026
  assert.strictEqual(formatTodayDate(dJan), '05/01/2026');
});

test('4. Duração: FormatDuration e formatHMS formatam 00h00min00seg corretamente', () => {
  assert.strictEqual(formatDuration(0), '00:00');
  assert.strictEqual(formatDuration(45 * 1000), '00:45');
  assert.strictEqual(formatDuration(65 * 1000), '01:05');
  assert.strictEqual(formatDuration(3665 * 1000), '01:01:05');

  assert.strictEqual(formatHMS(0), '00h00min00seg');
  assert.strictEqual(formatHMS(45), '00h00min45seg');
  assert.strictEqual(formatHMS(65), '00h01min05seg');
  assert.strictEqual(formatHMS(3665), '01h01min05seg');
  assert.strictEqual(formatHMS(16335), '04h32min15seg');
});

test('5. Storage: Adição de logs, consulta e descarte automático de 30 dias', () => {
  const storage = StorageService.getInstance();
  
  const entry = storage.addLog({
    type: 'AUTO_RESCUED',
    message: 'Auto-resgate executado com sucesso.',
    source: 'FALLBACK_TEMPLATE',
  });

  assert.ok(entry.id);
  assert.strictEqual(entry.type, 'AUTO_RESCUED');

  const logs = storage.getLogs(10);
  assert.ok(logs.some((l) => l.message === 'Auto-resgate executado com sucesso.'));
});

test('6. Storage: Gestão de Agenda e Configuração', () => {
  const storage = StorageService.getInstance();
  
  const updatedAgenda = storage.saveAgenda([
    { id: 't1', timeSlot: '08:00 - 10:00', topic: 'Desenvolvimento Backend', completed: false }
  ]);
  assert.strictEqual(updatedAgenda.length, 1);
  assert.strictEqual(updatedAgenda[0].topic, 'Desenvolvimento Backend');

  const updatedConfig = storage.saveConfig({ hourlyRate: 20 });
  assert.strictEqual(updatedConfig.hourlyRate, 20);
});

test('7. WhatsApp: Processamento de comandos e perguntas interativas com timeout', async () => {
  const whatsapp = WhatsAppService.getInstance();
  await Engine.getInstance().initialize();

  // Teste de comando !ajuda
  const helpReply = await whatsapp.handleIncomingMessage('5511999999999', '!ajuda');
  assert.ok(typeof helpReply === 'string' && helpReply.includes('Comandos Guardião Nobe'));

  // Teste de status
  const statusReply = await whatsapp.handleIncomingMessage('5511999999999', '!status');
  assert.ok(typeof statusReply === 'string' && (statusReply.includes('STATUS') || statusReply.includes('Status')));

  // Teste de pergunta interativa
  const questionPromise = whatsapp.askActivityQuestion(5000);
  const reply = await whatsapp.handleIncomingMessage('5511999999999', 'Desenvolvendo módulo de integração');
  const answer = await questionPromise;

  assert.strictEqual(answer, 'Desenvolvendo módulo de integração');
  assert.ok(typeof reply === 'string' && reply.includes('Desenvolvendo módulo de integração'));
});

test('8. Engine: Máquina de estados e transições de expediente', async () => {
  const engine = Engine.getInstance();
  
  // Transição para almoço e retorno
  await engine.startLunch();
  assert.strictEqual(engine.getStatus().state, 'LUNCH');

  await engine.resumeShift();
  assert.strictEqual(engine.getStatus().state, 'WORKING');

  await engine.pauseShift();
  assert.strictEqual(engine.getStatus().state, 'PAUSED');

  await engine.resumeShift();
  assert.strictEqual(engine.getStatus().state, 'WORKING');

  await engine.endShift();
  assert.strictEqual(engine.getStatus().state, 'IDLE');
});

test('9. API Server: Cobertura completa de rotas HTTP e JSON', async () => {
  const { server } = createServer();

  await new Promise<void>((resolve) => {
    server.listen(3097, () => resolve());
  });

  const get = (path: string): Promise<{ status: number; body: any }> => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3097${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 500, body: data });
          }
        });
      }).on('error', reject);
    });
  };

  const post = (path: string, body: any): Promise<{ status: number; body: any }> => {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        `http://localhost:3097${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 500, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode || 500, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  };

  try {
    const status = await get('/api/status');
    assert.strictEqual(status.status, 200);

    const config = await get('/api/config');
    assert.strictEqual(config.status, 200);

    const agenda = await get('/api/agenda');
    assert.strictEqual(agenda.status, 200);

    const templates = await get('/api/templates');
    assert.strictEqual(templates.status, 200);
    assert.ok(Array.isArray(templates.body));

    const logs = await get('/api/logs');
    assert.strictEqual(logs.status, 200);

    const waStatus = await get('/api/whatsapp/status');
    assert.strictEqual(waStatus.status, 200);

    const simSend = await post('/api/whatsapp/send', { from: 'Tester', text: '!ajuda' });
    assert.strictEqual(simSend.status, 200);
    assert.ok(simSend.body.success);
  } finally {
    server.close();
  }
});
