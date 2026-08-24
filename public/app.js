let liveStatus = null;
let ws = null;
let currentTab = 'audit';
let configData = null;

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

// Alternador de Abas (Desktop & Mobile)
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.remove('hidden');

  // Atualiza botões Desktop
  document.querySelectorAll('[id^="tabBtn-"]').forEach((btn) => {
    btn.className = 'px-4 py-2 rounded-lg text-slate-400 hover:text-white flex items-center space-x-2';
  });
  const activeBtn = document.getElementById(`tabBtn-${tabId}`);
  if (activeBtn) {
    activeBtn.className = 'px-4 py-2 rounded-lg bg-slate-800 text-white flex items-center space-x-2 border-b-2 border-emerald-500';
  }

  // Atualiza botões Mobile (Bottom Nav)
  document.querySelectorAll('[id^="mTabBtn-"]').forEach((btn) => {
    btn.className = 'flex flex-col items-center py-1 px-3 text-slate-400';
  });
  const activeMobileBtn = document.getElementById(`mTabBtn-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.className = 'flex flex-col items-center py-1 px-3 text-emerald-400 font-semibold';
  }

  if (tabId === 'audit') loadLogs();
  if (tabId === 'agenda') loadAgenda();
  if (tabId === 'templates') loadTemplates();
  if (tabId === 'settings') loadConfig();

  if (window.lucide) window.lucide.createIcons();
}

// Renderização do Status Principal
function renderLiveStatus() {
  if (!liveStatus) return;

  const stateText = document.getElementById('stateText');
  const stateDot = document.getElementById('stateDot');
  const activeCardTitle = document.getElementById('activeCardTitle');
  const topEarnings = document.getElementById('topEarnings');
  const topHours = document.getElementById('topHours');

  // Badge de Estado
  if (liveStatus.state === 'WORKING') {
    stateText.innerText = 'TRABALHANDO';
    stateDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    stateText.className = 'text-xs font-bold text-emerald-400 uppercase tracking-wider';
    document.getElementById('btnStart').classList.add('hidden');
    document.getElementById('btnPause').classList.remove('hidden');
    document.getElementById('btnResume').classList.add('hidden');
    document.getElementById('btnLunch').classList.remove('hidden');
  } else if (liveStatus.state === 'PAUSED') {
    stateText.innerText = 'PAUSADO';
    stateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
    stateText.className = 'text-xs font-bold text-amber-400 uppercase tracking-wider';
    document.getElementById('btnStart').classList.add('hidden');
    document.getElementById('btnPause').classList.add('hidden');
    document.getElementById('btnResume').classList.remove('hidden');
  } else if (liveStatus.state === 'LUNCH') {
    stateText.innerText = 'ALMOÇO';
    stateDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
    stateText.className = 'text-xs font-bold text-amber-400 uppercase tracking-wider';
    document.getElementById('btnStart').classList.add('hidden');
    document.getElementById('btnPause').classList.add('hidden');
    document.getElementById('btnResume').classList.remove('hidden');
  } else {
    stateText.innerText = 'EM ESPERA';
    stateDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
    stateText.className = 'text-xs font-bold text-slate-400 uppercase tracking-wider';
    document.getElementById('btnStart').classList.remove('hidden');
    document.getElementById('btnPause').classList.add('hidden');
    document.getElementById('btnResume').classList.add('hidden');
  }

  // Card Ativo
  if (liveStatus.activeCardName) {
    activeCardTitle.innerText = liveStatus.activeCardName;
  } else {
    activeCardTitle.innerText = 'Nenhum card em andamento';
  }

  // Horas & Ganhos
  const topHours = document.getElementById('topHours');
  const topEarnings = document.getElementById('topEarnings');
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
  if (liveStatus.isWhatsAppConnected) {
    waDot.className = 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-900';
  } else {
    waDot.className = 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-slate-900';
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

// Atualização dos Contadores Regressivos
function updateTimersDisplay() {
  if (!liveStatus || liveStatus.state !== 'WORKING') {
    document.getElementById('countdownComment').innerText = '--:--';
    document.getElementById('progressComment').style.width = '0%';
    document.getElementById('countdownRotation').innerText = '--:--';
    document.getElementById('progressRotation').style.width = '0%';
    return;
  }

  // Incremento suave em tempo real de segundos trabalhados hoje
  liveStatus.todaySecondsWorked = (liveStatus.todaySecondsWorked || 0) + 1;
  const topHours = document.getElementById('topHours');
  if (topHours) {
    topHours.innerText = formatHMSClient(liveStatus.todaySecondsWorked);
  }

  const now = Date.now();

  // 1. Contador de Comentário
  if (liveStatus.nextCommentTargetTime) {
    const target = new Date(liveStatus.nextCommentTargetTime).getTime();
    const remaining = Math.max(0, target - now);
    document.getElementById('countdownComment').innerText = formatTimer(remaining);

    // Progresso baseado em janela média de 23 minutos
    const total = 23 * 60 * 1000;
    const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
    document.getElementById('progressComment').style.width = `${progress}%`;
  }

  // 2. Contador de Rotação de 4h
  if (liveStatus.nextRotationTargetTime) {
    const target = new Date(liveStatus.nextRotationTargetTime).getTime();
    const remaining = Math.max(0, target - now);
    document.getElementById('countdownRotation').innerText = formatTimer(remaining);

    // Progresso baseado em janela de 235 minutos (3h55)
    const total = 235 * 60 * 1000;
    const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
    document.getElementById('progressRotation').style.width = `${progress}%`;
  }
}

function formatTimer(ms) {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Ações de Controle
async function controlAction(action) {
  try {
    const res = await fetch(`/api/control/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      alert(`Erro: ${data.error || 'Falha ao executar ação'}`);
    }
    await loadStatus();
    loadLogs();
  } catch (err) {
    alert(`Erro na requisição: ${err.message}`);
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

// Carregar Logs de Auditoria (30 Dias)
async function loadLogs() {
  try {
    const res = await fetch('/api/logs?limit=100');
    const logs = await res.json();
    const container = document.getElementById('logsContainer');

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="p-6 text-center text-sm text-slate-500">Nenhum evento registrado ainda.</div>';
      return;
    }

    container.innerHTML = logs
      .map((log) => {
        const time = new Date(log.timestamp).toLocaleString('pt-BR');
        let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
        let icon = 'info';

        switch (log.type) {
          case 'AUTO_RESCUED':
            badgeColor = 'bg-rose-950/80 text-rose-400 border-rose-800';
            icon = 'shield-alert';
            break;
          case 'CARD_ROTATED':
            badgeColor = 'bg-purple-950/80 text-purple-400 border-purple-800';
            icon = 'refresh-cw';
            break;
          case 'CARD_CREATED':
            badgeColor = 'bg-sky-950/80 text-sky-400 border-sky-800';
            icon = 'plus-circle';
            break;
          case 'CARD_MOVED':
            badgeColor = 'bg-blue-950/80 text-blue-400 border-blue-800';
            icon = 'arrow-right-left';
            break;
          case 'CARD_UNARCHIVED':
            badgeColor = 'bg-fuchsia-950/80 text-fuchsia-400 border-fuchsia-800';
            icon = 'archive-restore';
            break;
          case 'CARD_ADOPTED':
            badgeColor = 'bg-cyan-950/80 text-cyan-400 border-cyan-800';
            icon = 'check-circle';
            break;
          case 'COMMENT_SENT':
            badgeColor = 'bg-indigo-950/80 text-indigo-400 border-indigo-800';
            icon = 'message-square';
            break;
          case 'QUESTION_ASKED':
            badgeColor = 'bg-yellow-950/80 text-yellow-400 border-yellow-800';
            icon = 'help-circle';
            break;
          case 'QUESTION_ANSWERED':
            badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-800';
            icon = 'message-circle';
            break;
          case 'QUESTION_TIMEOUT':
            badgeColor = 'bg-rose-950/80 text-rose-400 border-rose-800';
            icon = 'clock';
            break;
          case 'SHIFT_STARTED':
          case 'RESUMED':
            badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-800';
            icon = 'play-circle';
            break;
          case 'SHIFT_ENDED':
          case 'PAUSED':
          case 'LUNCH_STARTED':
            badgeColor = 'bg-amber-950/80 text-amber-400 border-amber-800';
            icon = 'pause-circle';
            break;
          case 'MIDNIGHT_ROTATION':
            badgeColor = 'bg-violet-950/80 text-violet-400 border-violet-800';
            icon = 'moon';
            break;
          case 'COMMAND_RECEIVED':
            badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
            icon = 'terminal';
            break;
          case 'JITTER_CALCULATED':
            badgeColor = 'bg-teal-950/80 text-teal-400 border-teal-800';
            icon = 'timer';
            break;
          case 'ERROR':
            badgeColor = 'bg-red-950/80 text-red-400 border-red-800';
            icon = 'alert-triangle';
            break;
        }

        const sourceLabel = log.source
          ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 ml-2 font-mono">${log.source}</span>`
          : '';

        let detailsHtml = '';
        if (log.details && Object.keys(log.details).length > 0) {
          const detailsStr = Object.entries(log.details)
            .map(([k, v]) => `<span class="text-slate-400">${k}:</span> <span class="text-slate-200">${typeof v === 'object' ? JSON.stringify(v) : v}</span>`)
            .join(' • ');
          detailsHtml = `<div class="text-[11px] bg-slate-950/50 rounded px-2 py-1 mt-1.5 border border-slate-800/80 font-mono text-slate-400">${detailsStr}</div>`;
        }

        return `
          <div class="p-3 sm:p-3.5 flex items-start space-x-3 hover:bg-slate-800/30 transition">
            <div class="p-2 rounded-lg border ${badgeColor} shrink-0 mt-0.5">
              <i data-lucide="${icon}" class="w-4 h-4"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-slate-200 flex items-center">${log.type}${sourceLabel}</span>
                <span class="text-slate-500 font-mono text-[11px]">${time}</span>
              </div>
              <p class="text-xs text-slate-300 mt-1">${log.message}</p>
              ${detailsHtml}
            </div>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
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
    if (data.qrCode) {
      qrImg.src = data.qrCode;
      qrImg.classList.remove('hidden');
    }

    const chatContainer = document.getElementById('chatHistory');
    if (data.recentMessages && data.recentMessages.length > 0) {
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

// Configurações e Trello
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    configData = await res.json();

    document.getElementById('cfgApiKey').value = configData.trello.apiKey || '';
    document.getElementById('cfgToken').value = configData.trello.token || '';
    document.getElementById('cfgBoardId').value = configData.trello.boardId || '';
    document.getElementById('cfgWorkingListId').value = configData.trello.workingListId || '';
    document.getElementById('cfgWaitListId').value = configData.trello.waitListId || '';
    document.getElementById('cfgMemberId').value = configData.trello.memberId || '';
    document.getElementById('cfgUserName').value = configData.trello.userName || 'Luís Alves';
    document.getElementById('cfgHourlyRate').value = configData.hourlyRate || 18;
    document.getElementById('cfgRotationLimitMinutes').value = configData.rotationLimitMinutes || 230;
    document.getElementById('cfgPhone').value = configData.notificationPhone || '';

    document.getElementById('cfgTelegramToken').value = (configData.telegram && configData.telegram.botToken) || '';

    // Carrega mensagens customizáveis por ação
    const msgs = configData.actionMessages || {};
    document.getElementById('cfgMsgStartEnabled').checked = msgs.start?.enabled !== false;
    document.getElementById('cfgMsgStartText').value = msgs.start?.text || 'Iniciando as atividades do dia.';

    document.getElementById('cfgMsgLunchEnabled').checked = msgs.lunch?.enabled !== false;
    document.getElementById('cfgMsgLunchText').value = msgs.lunch?.text || 'Pausa para almoço.';

    document.getElementById('cfgMsgResumeEnabled').checked = msgs.resume?.enabled !== false;
    document.getElementById('cfgMsgResumeText').value = msgs.resume?.text || 'Retomando as tarefas.';

    document.getElementById('cfgMsgPauseEnabled').checked = msgs.pause?.enabled === true;
    document.getElementById('cfgMsgPauseText').value = msgs.pause?.text || 'Pausa rápida.';

    document.getElementById('cfgMsgRotateEnabled').checked = msgs.rotate?.enabled !== false;
    document.getElementById('cfgMsgRotateText').value = msgs.rotate?.text || 'Atualizando card para continuidade das tarefas.';

    document.getElementById('cfgMsgEndEnabled').checked = msgs.end?.enabled === true;
    document.getElementById('cfgMsgEndText').value = msgs.end?.text || 'Finalizando o expediente por hoje.';

    // Atualiza preview da coluna mensal
    const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const currentMonth = monthsPt[new Date().getMonth()];
    document.getElementById('monthlyColumnPreview').innerText = `${currentMonth} - ${configData.trello.userName || 'Luís Alves'}`;
    document.getElementById('rateBadge').innerText = `Taxa: R$ ${Number(configData.hourlyRate || 18).toFixed(2).replace('.', ',')}/h`;
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
