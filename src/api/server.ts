import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { Engine } from '../core/engine.js';
import { StorageService } from '../services/storage.service.js';
import { TrelloService } from '../services/trello.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';

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

  // 0. Healthcheck & Keep-Alive (UptimeRobot 24/7)
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // 1. Status Geral
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json(Engine.getInstance().getStatus());
  });

  // 2. Configurações
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(StorageService.getInstance().getConfig());
  });

  app.post('/api/config', (req: Request, res: Response) => {
    const updated = StorageService.getInstance().saveConfig(req.body);
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

  // Servir arquivos estáticos da interface web
  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  return { app, server };
}
