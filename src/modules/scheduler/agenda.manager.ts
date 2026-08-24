import { StorageService } from '../../services/storage.service.js';
import { CommentSource } from '../../types/index.js';

export interface ResolvedComment {
  text: string;
  source: CommentSource;
}

export class AgendaManager {
  private static instance: AgendaManager;

  private constructor() {}

  public static getInstance(): AgendaManager {
    if (!AgendaManager.instance) {
      AgendaManager.instance = new AgendaManager();
    }
    return AgendaManager.instance;
  }

  public resolveFallbackComment(): ResolvedComment {
    const storage = StorageService.getInstance();
    const config = storage.getConfig();

    // 1. Tenta pegar a próxima atividade pendente na Agenda
    const agenda = storage.getAgenda();
    const pendingAgenda = agenda.find((a) => !a.completed);

    if (pendingAgenda && pendingAgenda.topic) {
      return {
        text: `Atividade em andamento: ${pendingAgenda.topic}`,
        source: 'AGENDA',
      };
    }

    // 2. Tenta pegar um dos templates configurados pelo usuário
    const templates = config.fallbackTemplates || [];
    if (templates.length > 0) {
      const randomIndex = Math.floor(Math.random() * templates.length);
      return {
        text: templates[randomIndex],
        source: 'FALLBACK_TEMPLATE',
      };
    }

    // 3. Fallback genérico de emergência
    return {
      text: 'Desenvolvimento e execução das atividades em andamento.',
      source: 'FALLBACK_TEMPLATE',
    };
  }

  public getRescueComment(): string {
    const config = StorageService.getInstance().getConfig();
    const templates = config.fallbackTemplates || [];
    if (templates.length > 0) {
      const randomIndex = Math.floor(Math.random() * templates.length);
      return templates[randomIndex];
    }
    return 'Reativando contagem de horas do card.';
  }
}
