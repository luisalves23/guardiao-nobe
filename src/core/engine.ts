import { ShiftOrchestrator } from '../modules/shift/index.js';
import { AutoRescueWatcher } from '../modules/watcher/index.js';
import { TelegramAdapter } from '../modules/messaging/index.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { StorageService } from '../services/storage.service.js';
import { TrelloCardsManager } from '../modules/trello/index.js';
import { getCommentJitterMs } from '../modules/scheduler/index.js';
import { LiveStatus } from '../types/index.js';

export class Engine {
  private static instance: Engine;
  private lastTickTime: number = Date.now();

  private constructor() {}

  public static getInstance(): Engine {
    if (!Engine.instance) {
      Engine.instance = new Engine();
    }
    return Engine.instance;
  }

  public setBroadcastCallback(cb: (status: LiveStatus) => void) {
    ShiftOrchestrator.getInstance().setBroadcastCallback(cb);
  }

  public async initialize(): Promise<void> {
    console.log('[Engine] Inicializando arquitetura modular do Guardião Nobe (Polling: 3 segundos)...');
    const whatsapp = WhatsAppService.getInstance();
    const telegram = TelegramAdapter.getInstance();

    const commandHandler = async (cmd: string, args: string[]) => {
      return this.handleCommand(cmd, args);
    };

    whatsapp.setCommandHandler(commandHandler);
    telegram.setCommandHandler(commandHandler);
    await telegram.initialize();

    // Loop de monitoramento e proteção a cada 3 segundos
    const timer = setInterval(() => {
      this.tick().catch((err) => console.error('[Engine] Erro no loop de proteção (3s):', err.message));
    }, 3000);
    timer.unref();
  }

  public getStatus(): LiveStatus {
    return ShiftOrchestrator.getInstance().getStatus();
  }

  public broadcastStatus(): void {
    ShiftOrchestrator.getInstance().broadcastStatus();
  }

  public async startShift(): Promise<string> {
    return await ShiftOrchestrator.getInstance().startShift();
  }

  public async pauseShift(): Promise<string> {
    return await ShiftOrchestrator.getInstance().pauseShift();
  }

  public async resumeShift(): Promise<string> {
    return await ShiftOrchestrator.getInstance().resumeShift();
  }

  public async startLunch(): Promise<string> {
    return await ShiftOrchestrator.getInstance().startLunch();
  }

  public async endShift(): Promise<string> {
    return await ShiftOrchestrator.getInstance().endShift();
  }

  public async rotateCard(): Promise<void> {
    return await ShiftOrchestrator.getInstance().rotateCard();
  }

  public async sendPeriodicComment(): Promise<void> {
    return await ShiftOrchestrator.getInstance().sendPeriodicComment();
  }

  /**
   * Ciclo contínuo de 3 segundos
   */
  private async tick(): Promise<void> {
    const now = Date.now();
    const elapsedMinutes = (now - this.lastTickTime) / (1000 * 60);
    this.lastTickTime = now;

    const orchestrator = ShiftOrchestrator.getInstance();
    const watcher = AutoRescueWatcher.getInstance();

    // 1. Atualiza tempo acumulado e checa virada de meia-noite
    orchestrator.updateTime(elapsedMinutes);
    await orchestrator.handleMidnightDateShift();

    // 2. Rotação de 4 Horas (3h50 a 3h58)
    const nextRotation = orchestrator.getNextRotationTargetTime();
    if (orchestrator.getState() === 'WORKING' && nextRotation && now >= nextRotation) {
      await orchestrator.rotateCard();
    }

    // 3. Comentário Periódico com Jitter (20 a 25 min)
    const nextComment = orchestrator.getNextCommentTargetTime();
    if (orchestrator.getState() === 'WORKING' && nextComment && now >= nextComment && !orchestrator.isCommentInProgress()) {
      orchestrator.sendPeriodicComment().catch((err) =>
        console.error('[Engine] Erro no sendPeriodicComment:', err.message)
      );
    }

    // 4. Executa Auto-Resgate e observador de colunas (3s)
    await watcher.check({
      state: orchestrator.getState(),
      activeCardId: orchestrator.getActiveCardId(),
      activeCardName: orchestrator.getActiveCardName(),
      cardStartTime: orchestrator.getCardStartTime(),
      onCardAdopted: (id, name) => orchestrator.setAdoptedCard(id, name),
      onCardRotated: (id, title) => orchestrator.setRotatedCard(id, title),
      onCardRescued: () => orchestrator.setRescued(),
    });

    orchestrator.broadcastStatus();
  }

  /**
   * Processador de Comandos (Telegram / WhatsApp)
   */
  private async handleCommand(cmd: string, args: string[]): Promise<string> {
    const orchestrator = ShiftOrchestrator.getInstance();
    switch (cmd) {
      case 'status': {
        const s = orchestrator.getStatus();
        return `📊 *Status Guardião Nobe 24/7*\n\n🔹 *Estado:* ${s.state}\n📋 *Card:* ${s.activeCardName || 'Nenhum'}\n⏱️ *Horas Hoje:* ${(s.todayMinutesWorked / 60).toFixed(1)}h\n💰 *Ganhos Hoje:* R$ ${s.todayEarnings.toFixed(2)}`;
      }
      case 'iniciar':
        return await orchestrator.startShift();
      case 'pausar':
        return await orchestrator.pauseShift();
      case 'voltar':
      case 'continuar':
        return await orchestrator.resumeShift();
      case 'almoco':
      case 'almoçar':
        return await orchestrator.startLunch();
      case 'encerrar':
        return await orchestrator.endShift();
      case 'comentar': {
        const text = args.join(' ');
        if (!text) return 'Envie o texto do comentário: /comentar Desenvolvendo tela de login';
        const cardId = orchestrator.getActiveCardId();
        if (!cardId) return 'Nenhum card ativo no momento.';
        
        await TrelloCardsManager.getInstance().addComment(cardId, text);
        orchestrator.setRescued();
        
        StorageService.getInstance().addLog({
          type: 'COMMENT_SENT',
          message: `Comentário manual enviado: "${text}"`,
          source: 'WHATSAPP',
        });
        return `✅ Comentário registrado no card com sucesso:\n"${text}"`;
      }
      case 'ajuda':
      default:
        return `🤖 *Comandos Guardião Nobe:*\n\n/status - Status ao vivo\n/iniciar - Abre novo card\n/almoco - Pausa para almoço\n/pausar - Pausa o expediente\n/voltar - Retoma o expediente\n/encerrar - Encerra o dia\n/comentar <texto> - Comenta no card`;
    }
  }
}
