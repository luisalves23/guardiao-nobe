import dotenv from 'dotenv';
dotenv.config();

import { createServer } from './api/server.js';
import { Engine } from './core/engine.js';
import { WhatsAppService } from './services/whatsapp.service.js';
import { TelegramAdapter } from './modules/messaging/index.js';
import { StorageService } from './services/storage.service.js';

async function bootstrap() {
  console.log('====================================================');
  console.log('    🛡️  GUARDIÃO NOBE - AUTOMAÇÃO & PROTEÇÃO DE HORAS   ');
  console.log('====================================================');

  // 1. Inicializa persistência
  StorageService.getInstance();

  // 2. Inicializa serviços e mensageria
  await TelegramAdapter.getInstance().initialize();
  await WhatsAppService.getInstance().initialize();
  await Engine.getInstance().initialize();

  // 3. Inicializa servidor HTTP & WebSockets
  const PORT = process.env.PORT || 3000;
  const { server } = createServer();

  server.listen(PORT, () => {
    console.log(`[HTTP/WS] Servidor online em http://localhost:${PORT}`);
    console.log(`[Painel] Acesse o Painel Web pelo navegador em: http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Erro fatal na inicialização:', err);
  process.exit(1);
});
