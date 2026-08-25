import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { Engine } from '../core/engine.js';
import { StorageService } from '../services/storage.service.js';
import { DatabaseService } from '../services/database.service.js';
import { TrelloService } from '../services/trello.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { TelegramService } from '../services/telegram.service.js';
import { MessageDispatcher } from '../modules/messaging/index.js';
import { TrelloListsManager } from '../modules/trello/index.js';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Set<WebSocket>();

  server.on('close', () => {
    wss.close();
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    // Envia status inicial imediatamente
    ws.send(JSON.stringify({ type: 'STATUS', data: Engine.getInstance().getStatus() }));

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // Configura o broadcast no Engine
  Engine.getInstance().setBroadcastCallback((status) => {
    const payload = JSON.stringify({ type: 'STATUS', data: status });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // 0. Healthcheck & Keep-Alive (UptimeRobot & Render 24/7)
  const healthHandler = (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  };
  app.get('/health', healthHandler);
  app.get('/healthz', healthHandler);

  // 1. Status Geral
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json(Engine.getInstance().getStatus());
  });

  // 2. Configurações
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(StorageService.getInstance().getConfig());
  });

  app.post('/api/config', async (req: Request, res: Response) => {
    const updated = StorageService.getInstance().saveConfig(req.body);
    if (req.body.telegram?.botToken) {
      await TelegramService.getInstance().initialize();
    }
    res.json({ success: true, config: updated });
  });

  // 3. Trello Endpoints
  app.get('/api/trello/test', async (_req: Request, res: Response) => {
    const result = await TrelloService.getInstance().testConnection();
    res.json(result);
  });

  app.get('/api/trello/boards', async (_req: Request, res: Response) => {
    try {
      const boards = await TrelloService.getInstance().getBoards();
      res.json(boards);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trello/lists/:boardId', async (req: Request, res: Response) => {
    try {
      const lists = await TrelloService.getInstance().getLists(req.params.boardId);
      res.json(lists);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/trello/members/:boardId', async (req: Request, res: Response) => {
    try {
      const members = await TrelloService.getInstance().getBoardMembers(req.params.boardId);
      res.json(members);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Agenda
  app.get('/api/agenda', (_req: Request, res: Response) => {
    res.json(StorageService.getInstance().getAgenda());
  });

  app.post('/api/agenda', (req: Request, res: Response) => {
    const updated = StorageService.getInstance().saveAgenda(req.body);
    res.json({ success: true, agenda: updated });
  });

  // 5. Templates de Comentários
  app.get('/api/templates', (_req: Request, res: Response) => {
    const config = StorageService.getInstance().getConfig();
    res.json(config.fallbackTemplates || []);
  });

  app.post('/api/templates', (req: Request, res: Response) => {
    const templates = req.body;
    if (Array.isArray(templates)) {
      StorageService.getInstance().saveConfig({ fallbackTemplates: templates });
      res.json({ success: true, templates });
    } else {
      res.status(400).json({ error: 'Formato inválido. Envie um array de strings.' });
    }
  });

  // 6. Logs de Auditoria (30 dias)
  app.get('/api/logs', (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 100;
    res.json(StorageService.getInstance().getLogs(limit));
  });

  app.get('/api/logs/export', (_req: Request, res: Response) => {
    const logs = StorageService.getInstance().getAllLogs();
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="guardiao_nobe_logs_${dateStr}.json"`);
    res.send(JSON.stringify(logs, null, 2));
  });

  app.post('/api/logs/clear', (_req: Request, res: Response) => {
    try {
      StorageService.getInstance().clearLogs();
      DatabaseService.getInstance().clearErrors();
      DatabaseService.getInstance().clearActivities();
      res.json({ success: true, message: 'Todos os logs e atividades foram limpos com sucesso.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 7. Controles de Expediente
  app.post('/api/control/start', async (_req: Request, res: Response) => {
    try {
      const msg = await Engine.getInstance().startShift();
      res.json({ success: true, message: msg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/pause', async (_req: Request, res: Response) => {
    try {
      const msg = await Engine.getInstance().pauseShift();
      res.json({ success: true, message: msg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/resume', async (_req: Request, res: Response) => {
    try {
      const msg = await Engine.getInstance().resumeShift();
      res.json({ success: true, message: msg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/lunch', async (_req: Request, res: Response) => {
    try {
      const msg = await Engine.getInstance().startLunch();
      res.json({ success: true, message: msg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/rotate', async (_req: Request, res: Response) => {
    try {
      await Engine.getInstance().rotateCard();
      res.json({ success: true, message: 'Rotação de card executada com sucesso.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/end', async (_req: Request, res: Response) => {
    try {
      const msg = await Engine.getInstance().endShift();
      res.json({ success: true, message: msg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/rotate', async (_req: Request, res: Response) => {
    try {
      await Engine.getInstance().rotateCard();
      res.json({ success: true, message: 'Rotação forçada executada com sucesso.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/control/comment', async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      const status = Engine.getInstance().getStatus();
      if (!status.activeCardId) {
        return res.status(400).json({ error: 'Nenhum card ativo no momento.' });
      }
      await TrelloService.getInstance().addComment(status.activeCardId, text || 'Comentário manual via painel.');
      StorageService.getInstance().addLog({
        type: 'COMMENT_SENT',
        message: `Comentário manual enviado via Painel Web: "${text}"`,
        source: 'MANUAL',
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Resposta à Pergunta de Atividade (via Painel Web)
  app.post('/api/activity/reply', async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      const clean = (text || '').trim();
      if (!clean) {
        return res.status(400).json({ success: false, error: 'Texto do comentário é obrigatório.' });
      }

      const dispatcher = MessageDispatcher.getInstance();
      const resolved = await dispatcher.submitActivityAnswer(clean, 'WEB');

      if (!resolved) {
        const status = Engine.getInstance().getStatus();
        if (status.activeCardId) {
          await TrelloService.getInstance().addComment(status.activeCardId, clean);
          StorageService.getInstance().addLog({
            type: 'COMMENT_SENT',
            message: `Comentário direto enviado via Painel Web: "${clean}"`,
            source: 'USER_WEB',
          });
        }
      }

      res.json({ success: true, message: 'Comentário registrado com sucesso!' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 8. WhatsApp e Webhook
  app.get('/api/whatsapp/status', (_req: Request, res: Response) => {
    res.json(WhatsAppService.getInstance().getStatus());
  });

  app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
    const { from, text } = req.body;
    const reply = await WhatsAppService.getInstance().handleIncomingMessage(
      from || 'WebSimulator',
      text || ''
    );
    res.json({ success: true, reply });
  });

  app.post('/api/whatsapp/webhook', async (req: Request, res: Response) => {
    const { from, body, text, message } = req.body;
    const msgText = text || body || message || '';
    const sender = from || 'WebhookSender';
    const reply = await WhatsAppService.getInstance().handleIncomingMessage(sender, msgText);
    res.json({ success: true, reply });
  });

  // 9. Endpoints de Testes e Ajustes Rápidos
  app.post('/api/test/comment-interval', (req: Request, res: Response) => {
    try {
      const { minMinutes, maxMinutes, testMode } = req.body;
      const storage = StorageService.getInstance();
      const cfg = storage.getConfig();
      cfg.commentInterval = {
        minMinutes: Number(minMinutes) || 20,
        maxMinutes: Number(maxMinutes) || 25,
        testMode: Boolean(testMode),
      };
      storage.saveConfig(cfg);
      res.json({ success: true, commentInterval: cfg.commentInterval });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/test/ping-telegram', async (_req: Request, res: Response) => {
    try {
      const dispatcher = MessageDispatcher.getInstance();
      await dispatcher.broadcastAlert('🔔 *[Teste de Comunicação]* - Conexão com o Guardião Nobe ativa e operacional!');
      res.json({ success: true, sent: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/test/ping-trello', async (_req: Request, res: Response) => {
    try {
      const config = StorageService.getInstance().getConfig();
      const listsManager = TrelloListsManager.getInstance();
      const lists = config.trello.boardId ? await listsManager.getBoardLists(config.trello.boardId) : [];
      res.json({ success: true, listsCount: lists.length, lists });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/test/trigger-question', async (_req: Request, res: Response) => {
    try {
      Engine.getInstance().sendPeriodicComment().catch(err => console.error('[Test API] Erro ao disparar comentário:', err.message));
      res.json({ success: true, message: 'Pergunta de atividade disparada com timeout de 2min.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/schedule/weekly', (req: Request, res: Response) => {
    try {
      const { weeklySchedule } = req.body;
      const storage = StorageService.getInstance();
      const cfg = storage.getConfig();
      cfg.weeklySchedule = weeklySchedule;
      storage.saveConfig(cfg);
      res.json({ success: true, weeklySchedule: cfg.weeklySchedule });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ----------------------------------------------------
  // ENDPOINTS DE BANCO DE DADOS (SQLite Relacional)
  // ----------------------------------------------------
  app.get('/api/db/activities', (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const category = req.query.category as string | undefined;
      const errorsOnly = req.query.errorsOnly === 'true';
      const db = DatabaseService.getInstance();
      const activities = db.getRecentActivities(limit, category, errorsOnly);
      res.json({ success: true, count: activities.length, activities });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/db/sessions', (req: Request, res: Response) => {
    try {
      const dateStr = req.query.date as string | undefined;
      const db = DatabaseService.getInstance();
      const sessions = db.getTodayWorkSessions(dateStr);
      const totalSeconds = db.getTodayWorkedSeconds(dateStr);
      res.json({ success: true, count: sessions.length, totalSeconds, sessions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/db/errors', (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const db = DatabaseService.getInstance();
      const errors = db.getRecentErrors(limit);
      res.json({ success: true, count: errors.length, errors });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Servir arquivos estáticos da interface web sem cache no navegador
  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(
      express.static(publicDir, {
        index: 'index.html',
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        },
      })
    );
    app.get('/', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(publicDir, 'index.html'));
    });
    app.get('*', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(path.join(publicDir, 'index.html'));
      } else {
        res.status(404).json({ error: 'API route not found' });
      }
    });
  }

  return { app, server };
}
