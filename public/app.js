let liveStatus = null;
let ws = null;
let currentTab = 'audit';
let configData = null;

// Helpers Globais Seguros para Manipulação de DOM
const setVal = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.value = val;
};
const setChecked = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(val);
};
const setText = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  loadStatus();
  connectWebSocket();
  loadConfig();
  loadLogs();
  loadAgenda();
  loadTemplates();
  loadWhatsAppStatus();

  // Tick local a cada 1s para atualizar os timers regressivos suavemente
  setInterval(updateTimersDisplay, 1000);
  // Polling de sincronização a cada 2.5s (caso WebSockets sofram latência na nuvem)
  setInterval(loadStatus, 2500);
});

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      liveStatus = await res.json();
      renderLiveStatus();
    }
  } catch (err) {
    console.error('Erro ao buscar status HTTP:', err);
  }
}

// Conexão WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'STATUS') {
          liveStatus = msg.data;
          renderLiveStatus();
        }
      } catch (err) {
        console.error('Erro ao processar WS:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
  } catch {
    setTimeout(connectWebSocket, 3000);
  }
}

// Controles do Menu Sanduíche (Drawer)
function toggleDrawerMenu() {
  const sidebar = document.getElementById('drawerSidebar');
  const overlay = document.getElementById('drawerOverlay');
  if (!sidebar || !overlay) return;

  const isOpen = !sidebar.classList.contains('-translate-x-full');
  if (isOpen) {
    closeDrawerMenu();
  } else {
    overlay.classList.remove('opacity-0', 'pointer-events-none');
    overlay.classList.add('opacity-100', 'pointer-events-auto');
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
  }
}

function closeDrawerMenu() {
  const sidebar = document.getElementById('drawerSidebar');
  const overlay = document.getElementById('drawerOverlay');
  if (!sidebar || !overlay) return;

  overlay.classList.remove('opacity-100', 'pointer-events-auto');
  overlay.classList.add('opacity-0', 'pointer-events-none');
  sidebar.classList.remove('translate-x-0');
  sidebar.classList.add('-translate-x-full');
}

// Navegação Dinâmica: Abre Abas e Reduz/Expande Card de Gestão
function openTab(tabId) {
  currentTab = tabId;
  closeDrawerMenu();

  const cardExpanded = document.getElementById('activeCardExpanded');
  const cardCompact = document.getElementById('activeCardCompact');

  if (tabId === 'dashboard') {
    // Modo Gestão Completa (Expandido)
    if (cardExpanded) cardExpanded.classList.remove('hidden');
    if (cardCompact) cardCompact.classList.add('hidden');
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
  } else {
    // Modo Aba Interna: Reduz o Card de Gestão para a barra superior compacta
    if (cardExpanded) cardExpanded.classList.add('hidden');
    if (cardCompact) cardCompact.classList.remove('hidden');
    
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.classList.remove('hidden');
  }

  // Atualiza botões no Drawer Menu
  document.querySelectorAll('[id^="drawerBtn-"]').forEach((btn) => {
    btn.className = 'w-full px-3.5 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800/80 hover:text-white flex items-center space-x-3 transition active:scale-95 text-left';
  });
  const activeDrawerBtn = document.getElementById(`drawerBtn-${tabId}`);
  if (activeDrawerBtn) {
    activeDrawerBtn.className = 'w-full px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center space-x-3 transition active:scale-95 text-left';
  }

  // Atualiza botões Desktop
  document.querySelectorAll('[id^="tabBtn-"]').forEach((btn) => {
    btn.className = 'px-3.5 py-2 rounded-lg text-slate-400 hover:text-white flex items-center space-x-2 whitespace-nowrap';
  });
  const activeBtn = document.getElementById(`tabBtn-${tabId}`);
  if (activeBtn) {
    activeBtn.className = 'px-3.5 py-2 rounded-lg bg-slate-800 text-white flex items-center space-x-2 border-b-2 border-emerald-500 whitespace-nowrap';
  }

  // Atualiza botões Mobile (Bottom Nav)
  document.querySelectorAll('[id^="mTabBtn-"]').forEach((btn) => {
    btn.className = 'flex flex-col items-center py-1 px-2 text-slate-400';
  });
  const activeMobileBtn = document.getElementById(`mTabBtn-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.className = 'flex flex-col items-center py-1 px-2 text-emerald-400 font-semibold';
  }

  if (tabId === 'audit') loadLogs();
  if (tabId === 'schedule') loadWeeklySchedule();
  if (tabId === 'test') loadCommentInterval();
  if (tabId === 'agenda') loadAgenda();
  if (tabId === 'templates') loadTemplates();
  if (tabId === 'settings') loadConfig();

  if (window.lucide) window.lucide.createIcons();
}

// Alias para compatibilidade
function switchTab(tabId) {
  openTab(tabId);
}

function expandActiveCard() {
  const cardExpanded = document.getElementById('activeCardExpanded');
  const cardCompact = document.getElementById('activeCardCompact');
  if (cardExpanded) cardExpanded.classList.remove('hidden');
  if (cardCompact) cardCompact.classList.add('hidden');
  if (window.lucide) window.lucide.createIcons();
}

// Renderização do Status Principal
function renderLiveStatus() {
  if (!liveStatus) return;

  const stateText = document.getElementById('stateText');
  const stateDot = document.getElementById('stateDot');
  const compactStateText = document.getElementById('compactStateText');
  const compactStateDot = document.getElementById('compactStateDot');
  const activeCardTitle = document.getElementById('activeCardTitle');
  const compactCardTitle = document.getElementById('compactCardTitle');
  const topEarnings = document.getElementById('topEarnings');
  const topHours = document.getElementById('topHours');

  // Badge de Estado
  if (liveStatus.state === 'WORKING') {
    if (stateText) {
      stateText.innerText = 'TRABALHANDO';
      stateText.className = 'text-xs font-bold text-emerald-400 uppercase tracking-wider';
    }
    if (stateDot) stateDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    if (compactStateText) {
      compactStateText.innerText = 'TRABALHANDO';
      compactStateText.className = 'text-[10px] font-bold text-emerald-400 uppercase tracking-wider';
    }
    if (compactStateDot) compactStateDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0';

    const bStart = document.getElementById('btnStart');
    const bPause = document.getElementById('btnPause');
    const bResume = document.getElementById('btnResume');
    const bLunch = document.getElementById('btnLunch');
    if (bStart) bStart.classList.add('hidden');
    if (bPause) bPause.classList.remove('hidden');
    if (bResume) bResume.classList.add('hidden');
    if (bLunch) bLunch.classList.remove('hidden');
  } else if (liveStatus.state === 'PAUSED') {
    if (stateText) {
      stateText.innerText = 'PAUSADO';
      stateText.className = 'text-xs font-bold text-amber-400 uppercase tracking-wider';
    }
    if (stateDot) stateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
    if (compactStateText) {
      compactStateText.innerText = 'PAUSADO';
      compactStateText.className = 'text-[10px] font-bold text-amber-400 uppercase tracking-wider';
    }
    if (compactStateDot) compactStateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0';

    const bStart = document.getElementById('btnStart');
    const bPause = document.getElementById('btnPause');
    const bResume = document.getElementById('btnResume');
    if (bStart) bStart.classList.add('hidden');
    if (bPause) bPause.classList.add('hidden');
    if (bResume) bResume.classList.remove('hidden');
  } else if (liveStatus.state === 'LUNCH') {
    if (stateText) {
      stateText.innerText = 'ALMOÇO';
      stateText.className = 'text-xs font-bold text-amber-400 uppercase tracking-wider';
    }
    if (stateDot) stateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
    if (compactStateText) {
      compactStateText.innerText = 'ALMOÇO';
      compactStateText.className = 'text-[10px] font-bold text-amber-400 uppercase tracking-wider';
    }
    if (compactStateDot) compactStateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0';

    const bStart = document.getElementById('btnStart');
    const bPause = document.getElementById('btnPause');
    const bResume = document.getElementById('btnResume');
    if (bStart) bStart.classList.add('hidden');
    if (bPause) bPause.classList.add('hidden');
    if (bResume) bResume.classList.remove('hidden');
  } else {
    if (stateText) {
      stateText.innerText = 'EM ESPERA';
      stateText.className = 'text-xs font-bold text-slate-400 uppercase tracking-wider';
    }
    if (stateDot) stateDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
    if (compactStateText) {
      compactStateText.innerText = 'EM ESPERA';
      compactStateText.className = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider';
    }
    if (compactStateDot) compactStateDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0';

    const bStart = document.getElementById('btnStart');
    const bPause = document.getElementById('btnPause');
    const bResume = document.getElementById('btnResume');
    if (bStart) bStart.classList.remove('hidden');
    if (bPause) bPause.classList.add('hidden');
    if (bResume) bResume.classList.add('hidden');
  }

  // Card Ativo
  const cardName = liveStatus.activeCardName || 'Nenhum card em andamento';
  if (activeCardTitle) activeCardTitle.innerText = cardName;
  if (compactCardTitle) compactCardTitle.innerText = cardName;

  // Horas & Ganhos
  if (topHours) {
    if (liveStatus.todayFormattedTime) {
      topHours.innerText = liveStatus.todayFormattedTime;
    } else {
      const totalSecs = (liveStatus.todayMinutesWorked || 0) * 60;
      topHours.innerText = formatHMSClient(totalSecs);
    }
  }
  if (topEarnings) {
    topEarnings.innerText = `R$ ${liveStatus.todayEarnings.toFixed(2).replace('.', ',')}`;
  }

  // WhatsApp Dot
  const waDot = document.getElementById('waDot');
  if (waDot) {
    if (liveStatus.isWhatsAppConnected) {
      waDot.className = 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-900';
    } else {
      waDot.className = 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-slate-900';
    }
  }

  updateTimersDisplay();
}

function formatHMSClient(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(hours)}h${pad(minutes)}min${pad(seconds)}seg`;
}

let wasQuestionPending = false;
let commentSuccessTimeout = null;

function showCommentSuccess(msg) {
  const badge = document.getElementById('commentSuccessBadge');
  const textEl = document.getElementById('commentSuccessText');
  const interactiveBox = document.getElementById('commentInteractiveBox');
  const normalView = document.getElementById('commentNormalView');

  if (interactiveBox) interactiveBox.classList.add('hidden');
  if (normalView) normalView.classList.remove('hidden');

  if (badge && textEl) {
    textEl.innerText = msg;
    badge.classList.remove('hidden');
    if (commentSuccessTimeout) clearTimeout(commentSuccessTimeout);
    commentSuccessTimeout = setTimeout(() => {
      badge.classList.add('hidden');
    }, 4000);
  }
  if (window.lucide) window.lucide.createIcons();
}

async function submitWebActivityComment() {
  const input = document.getElementById('webCommentInput');
  const btn = document.getElementById('btnSendWebComment');
  if (!input) return;

  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-spin inline-block mr-1">⏳</span> Enviando...';
  }

  try {
    const res = await fetch('/api/activity/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    const data = await res.json();
    if (data.success) {
      input.value = '';
      showCommentSuccess('✅ Comentário registrado via Painel Web!');
      await loadStatus();
    } else {
      alert(data.error || 'Erro ao enviar comentário.');
    }
  } catch (err) {
    console.error('Erro ao enviar comentário web:', err);
    alert('Falha na comunicação com o servidor.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5 mr-1"></i><span>Enviar</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Atualização dos Contadores Regressivos
function updateTimersDisplay() {
  const countdownComment = document.getElementById('countdownComment');
  const progressComment = document.getElementById('progressComment');
  const countdownRotation = document.getElementById('countdownRotation');
  const compactCountdownRotation = document.getElementById('compactCountdownRotation');
  const progressRotation = document.getElementById('progressRotation');
  const commentNormalView = document.getElementById('commentNormalView');
  const commentInteractiveBox = document.getElementById('commentInteractiveBox');
  const questionTimeoutCountdown = document.getElementById('questionTimeoutCountdown');

  if (!liveStatus || liveStatus.state !== 'WORKING') {
    if (countdownComment) countdownComment.innerText = '--:--';
    if (progressComment) progressComment.style.width = '0%';
    if (countdownRotation) countdownRotation.innerText = '--:--:--';
    if (compactCountdownRotation) compactCountdownRotation.innerText = '--:--:--';
    if (progressRotation) progressRotation.style.width = '0%';
    if (commentInteractiveBox) commentInteractiveBox.classList.add('hidden');
    if (commentNormalView) commentNormalView.classList.remove('hidden');
    return;
  }

  // Incremento suave em tempo real de segundos trabalhados hoje
  liveStatus.todaySecondsWorked = (liveStatus.todaySecondsWorked || 0) + 1;
  const topHours = document.getElementById('topHours');
  if (topHours) {
    topHours.innerText = formatHMSClient(liveStatus.todaySecondsWorked);
  }

  const now = Date.now();

  // Tratamento da Pergunta Ativa Bimodal (Web & Telegram)
  const isPending = Boolean(liveStatus.isQuestionPending);

  if (isPending) {
    if (commentNormalView) commentNormalView.classList.add('hidden');
    if (commentInteractiveBox) commentInteractiveBox.classList.remove('hidden');

    if (questionTimeoutCountdown && liveStatus.questionDeadline) {
      const remainingTimeout = Math.max(0, liveStatus.questionDeadline - now);
      questionTimeoutCountdown.innerText = formatTimer(remainingTimeout);
    }
    wasQuestionPending = true;
  } else {
    if (wasQuestionPending) {
      wasQuestionPending = false;
      const source = liveStatus.lastCommentSource === 'USER_WEB' || liveStatus.lastCommentSource === 'WEB' ? 'Painel Web' : 'Telegram';
      const detail = liveStatus.lastCommentText ? `: "${liveStatus.lastCommentText}"` : '!';
      showCommentSuccess(`✅ Comentado via ${source}${detail}`);
    } else {
      if (commentInteractiveBox && (!commentSuccessTimeout || document.getElementById('commentSuccessBadge')?.classList.contains('hidden'))) {
        commentInteractiveBox.classList.add('hidden');
      }
      if (commentNormalView && (!commentSuccessTimeout || document.getElementById('commentSuccessBadge')?.classList.contains('hidden'))) {
        commentNormalView.classList.remove('hidden');
      }
    }
  }

  // 1. Contador de Comentário (MM:SS ou HH:MM:SS) com contagem ininterrupta
  if (liveStatus.nextCommentTargetTime && countdownComment && progressComment) {
    const target = new Date(liveStatus.nextCommentTargetTime).getTime();
    const remaining = Math.max(0, target - now);
    countdownComment.innerText = formatTimer(remaining);

    const total = 23 * 60 * 1000;
    const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
    progressComment.style.width = `${progress}%`;
  }

  // 2. Contador de Rotação de 4h (Regressivo Digital HH:MM:SS)
  if (liveStatus.nextRotationTargetTime) {
    const target = new Date(liveStatus.nextRotationTargetTime).getTime();
    const remaining = Math.max(0, target - now);
    const rotationHMS = formatHMSCountdown(remaining);
    
    if (countdownRotation) countdownRotation.innerText = rotationHMS;
    if (compactCountdownRotation) compactCountdownRotation.innerText = rotationHMS;

    if (progressRotation) {
      const total = 235 * 60 * 1000;
      const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
      progressRotation.style.width = `${progress}%`;
    }
  }
}

function formatTimer(ms) {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatHMSCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Ações de Controle
async function controlAction(action) {
  console.log(`[Guardião UI] Executando ação de controle: ${action}`);
  const stateText = document.getElementById('stateText');
  const stateDot = document.getElementById('stateDot');
  if (stateText) {
    stateText.innerText = 'PROCESSANDO...';
    stateText.className = 'text-xs font-bold text-blue-400 uppercase tracking-wider animate-pulse';
  }
  if (stateDot) {
    stateDot.className = 'w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping';
  }

  try {
    const res = await fetch(`/api/control/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      alert(`⚠️ Atenção: ${data.error || 'Falha ao executar ação'}`);
    }
    await loadStatus();
    loadLogs();
  } catch (err) {
    alert(`Erro de conexão com o servidor: ${err.message}`);
    await loadStatus();
  }
}

async function promptQuickComment() {
  const text = prompt('Digite o comentário para registrar agora no card ativo:');
  if (!text || !text.trim()) return;

  try {
    const res = await fetch('/api/control/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ Comentário enviado com sucesso para o Trello!');
      loadLogs();
    } else {
      alert(`Erro: ${data.error}`);
    }
  } catch (err) {
    alert(`Erro: ${err.message}`);
  }
}

// ----------------------------------------------------
// BANCO DE DADOS & AUDITORIA UNIFICADA DO SISTEMA
// ----------------------------------------------------
async function loadUnifiedAuditLogs() {
  const container = document.getElementById('unifiedAuditLogsContainer');
  if (!container) return;

  const category = document.getElementById('unifiedLogCategoryFilter')?.value || 'ALL';
  const search = document.getElementById('unifiedLogSearchInput')?.value || '';

  try {
    let url = `/api/logs/unified?limit=300`;
    if (category && category !== 'ALL') url += `&category=${encodeURIComponent(category)}`;
    if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;

    const res = await fetch(url);
    const list = await res.json();

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-slate-500">Nenhum evento registrado com os filtros selecionados.</div>';
      return;
    }

    container.innerHTML = list
      .map((item) => {
        const time = new Date(item.timestamp).toLocaleString('pt-BR');
        let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
        let icon = 'activity';

        switch (item.category) {
          case 'CONTROL':
            badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-800';
            icon = 'play-circle';
            break;
          case 'TRELLO':
            badgeColor = 'bg-blue-950/80 text-blue-400 border-blue-800';
            icon = 'layout-grid';
            break;
          case 'TELEGRAM':
            badgeColor = 'bg-sky-950/80 text-sky-400 border-sky-800';
            icon = 'send';
            break;
          case 'SCHEDULER':
            badgeColor = 'bg-amber-950/80 text-amber-400 border-amber-800';
            icon = 'clock';
            break;
          case 'ERROR':
            badgeColor = 'bg-rose-950/80 text-rose-400 border-rose-800';
            icon = 'alert-triangle';
            break;
          default:
            badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
            icon = 'activity';
            break;
        }

        let detailsHtml = '';
        if (item.details) {
          detailsHtml = `<div class="text-[11px] bg-slate-900/90 rounded-lg p-2 mt-1.5 border border-slate-800 font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">${item.details}</div>`;
        }

        return `
          <div class="p-3 sm:p-3.5 flex items-start space-x-3 hover:bg-slate-900/40 transition">
            <div class="p-2 rounded-lg border ${badgeColor} shrink-0 mt-0.5">
              <i data-lucide="${icon}" class="w-4 h-4"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-slate-200 flex items-center space-x-2">
                  <span>${item.type}</span>
                  <span class="text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">${item.category}</span>
                </span>
                <span class="text-slate-500 font-mono text-[10px]">${time}</span>
              </div>
              <p class="text-xs text-slate-300 mt-0.5">${item.title}</p>
              ${detailsHtml}
            </div>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar auditoria unificada:', err);
  }
}

async function loadLogs() {
  await loadUnifiedAuditLogs();
}

async function loadDbSessions() {
  await loadUnifiedAuditLogs();
}

async function loadDbActivities() {
  await loadUnifiedAuditLogs();
}

async function loadDbErrors() {
  await loadUnifiedAuditLogs();
}

// Carregar Agenda
async function loadAgenda() {
  try {
    const res = await fetch('/api/agenda');
    const agenda = await res.json();
    const container = document.getElementById('agendaList');

    if (!agenda || agenda.length === 0) {
      container.innerHTML = '<div class="p-4 text-center text-xs text-slate-500">Nenhuma tarefa na agenda. Adicione tarefas para o dia.</div>';
      return;
    }

    container.innerHTML = agenda
      .map(
        (item, index) => `
        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
          <div class="flex items-center space-x-3 flex-1">
            <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleAgendaItem(${index})" class="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4" />
            <div class="${item.completed ? 'line-through text-slate-500' : 'text-slate-200'} text-xs">
              <span class="font-mono text-emerald-400 mr-2">${item.timeSlot || '--:--'}</span>
              <span>${item.topic}</span>
            </div>
          </div>
          <button onclick="removeAgendaItem(${index})" class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-rose-400 transition">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `
      )
      .join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar agenda:', err);
  }
}

async function addAgendaItem() {
  const timeSlot = prompt('Intervalo de horário (ex: 08:00 - 10:00):', '08:00 - 10:00');
  if (!timeSlot) return;
  const topic = prompt('Descrição da atividade a ser realizada:');
  if (!topic || !topic.trim()) return;

  const res = await fetch('/api/agenda');
  const agenda = await res.json();
  agenda.push({
    id: Date.now().toString(),
    timeSlot: timeSlot.trim(),
    topic: topic.trim(),
    completed: false,
  });

  await fetch('/api/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agenda),
  });

  loadAgenda();
}

async function toggleAgendaItem(index) {
  const res = await fetch('/api/agenda');
  const agenda = await res.json();
  agenda[index].completed = !agenda[index].completed;

  await fetch('/api/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agenda),
  });

  loadAgenda();
}

async function removeAgendaItem(index) {
  const res = await fetch('/api/agenda');
  const agenda = await res.json();
  agenda.splice(index, 1);

  await fetch('/api/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agenda),
  });

  loadAgenda();
}

// Carregar Templates Fallback
async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const templates = await res.json();
    const container = document.getElementById('templatesList');

    if (!templates || templates.length === 0) {
      container.innerHTML = '<div class="p-4 text-center text-xs text-slate-500">Nenhum template cadastrado.</div>';
      return;
    }

    container.innerHTML = templates
      .map(
        (tpl, index) => `
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs">
          <span class="text-slate-300 flex-1">${tpl}</span>
          <button onclick="removeTemplateItem(${index})" class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-rose-400 transition">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `
      )
      .join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar templates:', err);
  }
}

async function addTemplateItem() {
  const text = prompt('Digite o novo modelo de comentário:');
  if (!text || !text.trim()) return;

  const res = await fetch('/api/templates');
  const templates = await res.json();
  templates.push(text.trim());

  await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(templates),
  });

  loadTemplates();
}

async function removeTemplateItem(index) {
  const res = await fetch('/api/templates');
  const templates = await res.json();
  templates.splice(index, 1);

  await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(templates),
  });

  loadTemplates();
}

// WhatsApp & Simulador
async function loadWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();

    const qrImg = document.getElementById('waQrImage');
    if (qrImg) {
      if (data.qrCode) {
        qrImg.src = data.qrCode;
        qrImg.classList.remove('hidden');
      } else {
        qrImg.classList.add('hidden');
      }
    }

    const chatContainer = document.getElementById('chatHistory');
    if (chatContainer && data.recentMessages && data.recentMessages.length > 0) {
      chatContainer.innerHTML = data.recentMessages
        .map((m) => {
          const isOut = m.type === 'OUT';
          return `
            <div class="flex flex-col ${isOut ? 'items-start' : 'items-end'}">
              <div class="max-w-[85%] px-3 py-2 rounded-xl ${isOut ? 'bg-slate-800 text-slate-200' : 'bg-emerald-600 text-white'}">
                <p class="whitespace-pre-wrap">${m.text}</p>
                <span class="text-[9px] ${isOut ? 'text-slate-500' : 'text-emerald-200'} block mt-1 text-right">${m.time}</span>
              </div>
            </div>
          `;
        })
        .join('');
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  } catch (err) {
    console.error('Erro ao carregar WhatsApp:', err);
  }
}

async function sendSimulatedMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';

  try {
    await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Luís (Web)', text }),
    });
    setTimeout(loadWhatsAppStatus, 500);
  } catch (err) {
    console.error('Erro ao enviar mensagem simulada:', err);
  }
}

function exportLogs() {
  window.open('/api/logs/export', '_blank');
}

async function clearAllLogs() {
  if (!confirm('Deseja realmente limpar todos os logs e histórico de auditoria do sistema?')) {
    return;
  }

  try {
    const res = await fetch('/api/logs/clear', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadLogs();
      alert('Logs e histórico limpos com sucesso!');
    } else {
      alert('Erro ao limpar logs: ' + (data.error || 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('Erro ao limpar logs:', err);
    alert('Erro ao conectar ao servidor para limpar logs.');
  }
}

// Configurações
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    configData = await res.json();

    setVal('cfgApiKey', configData.trello.apiKey || '');
    setVal('cfgToken', configData.trello.token || '');
    setVal('cfgBoardId', configData.trello.boardId || '');
    setVal('cfgWorkingListId', configData.trello.workingListId || '');
    setVal('cfgWaitListId', configData.trello.waitListId || '');
    setVal('cfgMemberId', configData.trello.memberId || '');
    setVal('cfgUserName', configData.trello.userName || 'Luís Alves');
    setVal('cfgHourlyRate', configData.hourlyRate || 18);
    setVal('cfgRotationLimitMinutes', configData.rotationLimitMinutes || 230);
    setVal('cfgPhone', configData.notificationPhone || '');
    setVal('cfgTelegramToken', (configData.telegram && configData.telegram.botToken) || '');

    // Carrega mensagens customizáveis por ação
    const msgs = configData.actionMessages || {};
    setChecked('cfgMsgStartEnabled', msgs.start?.enabled !== false);
    setVal('cfgMsgStartText', msgs.start?.text || 'Iniciando as atividades do dia.');

    setChecked('cfgMsgLunchEnabled', msgs.lunch?.enabled !== false);
    setVal('cfgMsgLunchText', msgs.lunch?.text || 'Pausa para almoço.');

    setChecked('cfgMsgResumeEnabled', msgs.resume?.enabled !== false);
    setVal('cfgMsgResumeText', msgs.resume?.text || 'Retomando as tarefas.');

    setChecked('cfgMsgPauseEnabled', msgs.pause?.enabled === true);
    setVal('cfgMsgPauseText', msgs.pause?.text || 'Pausa rápida.');

    setChecked('cfgMsgRotateEnabled', msgs.rotate?.enabled !== false);
    setVal('cfgMsgRotateText', msgs.rotate?.text || 'Atualizando card para continuidade das tarefas.');

    setChecked('cfgMsgEndEnabled', msgs.end?.enabled === true);
    setVal('cfgMsgEndText', msgs.end?.text || 'Finalizando o expediente por hoje.');

    // Atualiza preview da coluna mensal
    const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const currentMonth = monthsPt[new Date().getMonth()];
    setText('monthlyColumnPreview', `${currentMonth} - ${configData.trello.userName || 'Luís Alves'}`);
    setText('rateBadge', `Taxa: R$ ${Number(configData.hourlyRate || 18).toFixed(2).replace('.', ',')}/h`);
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    trello: {
      apiKey: document.getElementById('cfgApiKey').value.trim(),
      token: document.getElementById('cfgToken').value.trim(),
      boardId: document.getElementById('cfgBoardId').value.trim(),
      workingListId: document.getElementById('cfgWorkingListId').value.trim(),
      waitListId: document.getElementById('cfgWaitListId').value.trim(),
      memberId: document.getElementById('cfgMemberId').value.trim(),
      userName: document.getElementById('cfgUserName').value.trim(),
    },
    hourlyRate: Number(document.getElementById('cfgHourlyRate').value),
    rotationLimitMinutes: Number(document.getElementById('cfgRotationLimitMinutes').value) || 230,
    notificationPhone: document.getElementById('cfgPhone').value.trim(),
    telegram: {
      botToken: document.getElementById('cfgTelegramToken').value.trim(),
      chatId: (configData.telegram && configData.telegram.chatId) || '',
      enabled: !!document.getElementById('cfgTelegramToken').value.trim(),
    },
    actionMessages: {
      start: {
        enabled: document.getElementById('cfgMsgStartEnabled').checked,
        text: document.getElementById('cfgMsgStartText').value.trim(),
      },
      lunch: {
        enabled: document.getElementById('cfgMsgLunchEnabled').checked,
        text: document.getElementById('cfgMsgLunchText').value.trim(),
      },
      resume: {
        enabled: document.getElementById('cfgMsgResumeEnabled').checked,
        text: document.getElementById('cfgMsgResumeText').value.trim(),
      },
      pause: {
        enabled: document.getElementById('cfgMsgPauseEnabled').checked,
        text: document.getElementById('cfgMsgPauseText').value.trim(),
      },
      rotate: {
        enabled: document.getElementById('cfgMsgRotateEnabled').checked,
        text: document.getElementById('cfgMsgRotateText').value.trim(),
      },
      end: {
        enabled: document.getElementById('cfgMsgEndEnabled').checked,
        text: document.getElementById('cfgMsgEndText').value.trim(),
      },
    },
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ Configurações salvas com sucesso!');
      loadConfig();
    }
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
}

async function testTrello() {
  const feedback = document.getElementById('trelloTestFeedback');
  if (!feedback) return;
  feedback.className = 'self-center text-xs font-semibold text-slate-400';
  feedback.innerText = 'Testando conexão com a API do Trello...';

  try {
    const res = await fetch('/api/trello/test');
    const data = await res.json();
    if (data.ok) {
      feedback.className = 'self-center text-xs font-semibold text-emerald-400';
      feedback.innerText = `✅ Conectado como: ${data.user}`;
    } else {
      feedback.className = 'self-center text-xs font-semibold text-rose-400';
      feedback.innerText = `❌ Falha: ${data.error || 'Credenciais inválidas'}`;
    }
  } catch (err) {
    feedback.className = 'self-center text-xs font-semibold text-rose-400';
    feedback.innerText = `❌ Erro: ${err.message}`;
  }
}

// ----------------------------------------------------
// AGENDA SEMANAL (HORÁRIOS DE TRABALHO)
// ----------------------------------------------------
const DAY_LABELS = {
  seg: 'Segunda-feira',
  ter: 'Terça-feira',
  qua: 'Quarta-feira',
  qui: 'Quinta-feira',
  sex: 'Sexta-feira',
  sab: 'Sábado',
  dom: 'Domingo',
};

async function loadWeeklySchedule() {
  const container = document.getElementById('weeklyScheduleDaysContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const sched = cfg.weeklySchedule || {
      autoStartEnabled: false,
      autoEndEnabled: false,
      days: {
        seg: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
        ter: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
        qua: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
        qui: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
        sex: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
        sab: { enabled: false, start: '08:00', end: '12:00', lunchStart: '12:00', lunchEnd: '13:00' },
        dom: { enabled: false, start: '08:00', end: '12:00', lunchStart: '12:00', lunchEnd: '13:00' },
      }
    };

    setChecked('schedAutoStart', !!sched.autoStartEnabled);
    setChecked('schedAutoEnd', !!sched.autoEndEnabled);

    container.innerHTML = '';
    Object.keys(DAY_LABELS).forEach((dayKey) => {
      const dayData = (sched.days && sched.days[dayKey]) || {
        enabled: dayKey !== 'sab' && dayKey !== 'dom',
        start: '08:00',
        end: '18:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
      };

      const row = document.createElement('div');
      row.className = 'p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3';
      row.innerHTML = `
        <div class="flex items-center space-x-3 min-w-[140px]">
          <label class="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" id="sched-${dayKey}-enabled" ${dayData.enabled ? 'checked' : ''} class="rounded bg-slate-900 border-slate-700 text-blue-500" />
            <span class="font-bold text-slate-200 text-xs">${DAY_LABELS[dayKey]}</span>
          </label>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          <div>
            <label class="block text-[10px] text-slate-400 mb-0.5">Entrada</label>
            <input type="time" id="sched-${dayKey}-start" value="${dayData.start || '08:00'}" class="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-0.5">Almoço Início</label>
            <input type="time" id="sched-${dayKey}-lunchStart" value="${dayData.lunchStart || '12:00'}" class="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-0.5">Almoço Fim</label>
            <input type="time" id="sched-${dayKey}-lunchEnd" value="${dayData.lunchEnd || '13:00'}" class="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-400 mb-0.5">Saída</label>
            <input type="time" id="sched-${dayKey}-end" value="${dayData.end || '18:00'}" class="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono" />
          </div>
        </div>
      `;
      container.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar agenda semanal:', err);
  }
}

async function saveWeeklySchedule(e) {
  if (e) e.preventDefault();
  const autoStart = document.getElementById('schedAutoStart')?.checked || false;
  const autoEnd = document.getElementById('schedAutoEnd')?.checked || false;

  const days = {};
  Object.keys(DAY_LABELS).forEach((dayKey) => {
    days[dayKey] = {
      enabled: document.getElementById(`sched-${dayKey}-enabled`)?.checked || false,
      start: document.getElementById(`sched-${dayKey}-start`)?.value || '08:00',
      end: document.getElementById(`sched-${dayKey}-end`)?.value || '18:00',
      lunchStart: document.getElementById(`sched-${dayKey}-lunchStart`)?.value || '12:00',
      lunchEnd: document.getElementById(`sched-${dayKey}-lunchEnd`)?.value || '13:00',
    };
  });

  try {
    const res = await fetch('/api/schedule/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weeklySchedule: {
          autoStartEnabled: autoStart,
          autoEndEnabled: autoEnd,
          days,
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ Agenda semanal salva com sucesso!');
      loadWeeklySchedule();
    }
  } catch (err) {
    alert(`Erro ao salvar agenda semanal: ${err.message}`);
  }
}

// ----------------------------------------------------
// BATERIA DE TESTES & AJUSTE DE TEMPO DE COMENTÁRIOS
// ----------------------------------------------------
async function loadCommentInterval() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const interval = cfg.commentInterval || { minMinutes: 20, maxMinutes: 25 };
    setVal('testMinMinutes', interval.minMinutes || 20);
    setVal('testMaxMinutes', interval.maxMinutes || 25);
  } catch (err) {
    console.error('Erro ao carregar intervalo de comentários:', err);
  }
}

async function saveCommentInterval(e) {
  if (e) e.preventDefault();
  const min = parseFloat(document.getElementById('testMinMinutes')?.value) || 20;
  const max = parseFloat(document.getElementById('testMaxMinutes')?.value) || 25;

  const feedback = document.getElementById('intervalSaveFeedback');
  if (feedback) feedback.innerText = 'Salvando e reagendando...';

  try {
    const res = await fetch('/api/test/comment-interval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minMinutes: min,
        maxMinutes: max,
        testMode: min < 10,
      }),
    });
    const data = await res.json();
    if (data.success) {
      if (feedback) {
        feedback.innerText = `✅ Intervalo configurado: ${min}m a ${max}m`;
        setTimeout(() => (feedback.innerText = ''), 4000);
      }
      logTestOutput(`⏱️ Intervalo de comentários alterado para: ${min}m a ${max}m. Próximo sorteio reagendado!`, 'success');
    }
  } catch (err) {
    if (feedback) feedback.innerText = `❌ Erro: ${err.message}`;
    logTestOutput(`❌ Erro ao configurar intervalo: ${err.message}`, 'error');
  }
}

function setCommentIntervalPreset(min, max) {
  setVal('testMinMinutes', min);
  setVal('testMaxMinutes', max);
  saveCommentInterval();
}

function logTestOutput(msg, type = 'info') {
  const consoleEl = document.getElementById('testConsole');
  if (!consoleEl) return;

  const colors = {
    info: 'text-slate-300',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-rose-400',
  };

  const line = document.createElement('div');
  line.className = `${colors[type] || 'text-slate-300'} flex space-x-1.5`;
  const time = new Date().toLocaleTimeString('pt-BR');
  line.innerHTML = `<span class="text-slate-500">[${time}]</span> <span>${msg}</span>`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearTestConsole() {
  const consoleEl = document.getElementById('testConsole');
  if (consoleEl) {
    consoleEl.innerHTML = '<div class="text-slate-500">Console limpo.</div>';
  }
}

async function testTriggerQuestion() {
  logTestOutput('🔔 Disparando pergunta interativa no Telegram...', 'info');
  try {
    const res = await fetch('/api/test/trigger-question', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      logTestOutput('✅ Pergunta enviada para o Telegram! Responda no chat em até 2 minutos para ver o comentário entrar no Trello.', 'success');
    } else {
      logTestOutput(`❌ Falha ao disparar pergunta: ${data.error}`, 'error');
    }
  } catch (err) {
    logTestOutput(`❌ Erro de rede: ${err.message}`, 'error');
  }
}

async function testDirectComment() {
  const text = prompt('Digite o texto para o comentário de teste no Trello:', 'Teste de comentário instantâneo via Guardião Nobe.');
  if (!text) return;

  logTestOutput(`💬 Enviando comentário de teste: "${text}"...`, 'info');
  try {
    const res = await fetch('/api/control/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.success) {
      logTestOutput(`✅ Comentário postado no Trello com sucesso!`, 'success');
    } else {
      logTestOutput(`❌ Falha ao postar comentário: ${data.error}`, 'error');
    }
  } catch (err) {
    logTestOutput(`❌ Erro: ${err.message}`, 'error');
  }
}

async function testTelegramPing() {
  logTestOutput('📡 Testando conexão e ping com o Telegram Bot API...', 'info');
  try {
    const res = await fetch('/api/test/ping-telegram', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.sent) {
      logTestOutput('✅ Mensagem de teste recebida com sucesso no @guardiao_luis_bot!', 'success');
    } else {
      logTestOutput(`❌ Falha ao enviar mensagem no Telegram. Verifique o botToken e chatId.`, 'error');
    }
  } catch (err) {
    logTestOutput(`❌ Erro ao conectar com Telegram: ${err.message}`, 'error');
  }
}

async function testTrelloPing() {
  logTestOutput('📋 Testando conexão e auditando listas no Trello...', 'info');
  try {
    const res = await fetch('/api/test/ping-trello', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      logTestOutput(`✅ Conexão OK! Encontradas ${data.listsCount} listas no quadro.`, 'success');
      data.lists.forEach(l => {
        logTestOutput(`   • Lista: "${l.name}" (ID: ${l.id})`, 'info');
      });
    } else {
      logTestOutput(`❌ Falha na API do Trello: ${data.error}`, 'error');
    }
  } catch (err) {
    logTestOutput(`❌ Erro de conexão com Trello: ${err.message}`, 'error');
  }
}

// Exposição Global no Window
window.switchTab = switchTab;
window.controlAction = controlAction;
window.promptQuickComment = promptQuickComment;
window.addAgendaItem = addAgendaItem;
window.toggleAgendaItem = toggleAgendaItem;
window.removeAgendaItem = removeAgendaItem;
window.addTemplateItem = addTemplateItem;
window.removeTemplateItem = removeTemplateItem;
window.saveSettings = saveSettings;
window.testTrello = testTrello;
window.exportLogs = exportLogs;
window.clearAllLogs = clearAllLogs;
window.loadLogs = loadLogs;
window.loadDbSessions = loadDbSessions;
window.loadDbActivities = loadDbActivities;
window.loadDbErrors = loadDbErrors;
window.loadWeeklySchedule = loadWeeklySchedule;
window.saveWeeklySchedule = saveWeeklySchedule;
window.loadCommentInterval = loadCommentInterval;
window.saveCommentInterval = saveCommentInterval;
window.setCommentIntervalPreset = setCommentIntervalPreset;
window.testTriggerQuestion = testTriggerQuestion;
window.testDirectComment = testDirectComment;
window.testTelegramPing = testTelegramPing;
window.testTrelloPing = testTrelloPing;
window.clearTestConsole = clearTestConsole;

