import assert from 'node:assert';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { chromium, Browser, Page } from 'playwright';
import { createServer } from '../api/server.js';
import { Engine } from '../core/engine.js';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'data', 'screenshots');

test('E2E UI & Graphical Interface: Bateria Completa com Navegador Real', async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // 1. Inicializa o Engine e o Servidor Web local
  await Engine.getInstance().initialize();
  const { server } = createServer();

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => resolve());
  });

  let browser: Browser | null = null;

  try {
    // 2. Lança navegador Chromium headless
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page: Page = await context.newPage();

    // Debug de Console e Erros do Navegador
    page.on('console', (msg) => console.log(`[Browser Console ${msg.type()}]:`, msg.text()));
    page.on('pageerror', (err) => console.error('[Browser PageError]:', err.message));

    // Dialog handler para prompt/alert
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Desenvolvimento de Módulos E2E');
      } else {
        await dialog.accept();
      }
    });

    console.log('\n[E2E UI] 🌐 1. Acessando painel web em', BASE_URL);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // 3. Validação de Carregamento e Estado Inicial
    await page.waitForSelector('#stateText');
    const initialText = await page.locator('#stateText').innerText();
    console.log('[E2E UI] ✅ Estado inicial do badge renderizado:', initialText);
    assert.ok(initialText === 'EM ESPERA' || initialText === 'TRABALHANDO');

    // Validação da linha de métricas superior
    const topHours = await page.locator('#topHours').innerText();
    console.log('[E2E UI] ✅ Formato de horas no cabeçalho:', topHours);
    assert.match(topHours, /^\d{2}h\d{2}min\d{2}seg$/);

    const topEarnings = await page.locator('#topEarnings').innerText();
    assert.match(topEarnings, /^R\$\s*\d+,\d{2}$/);

    // Validação da versão v2.7.2 no cabeçalho
    const versionBadge = await page.locator('text=v2.7.2').first();
    assert.ok(await versionBadge.isVisible(), 'Badge de versão v2.7.2 deve estar visível no topo');
    console.log('[E2E UI] ✅ Badge de versão v2.7.2 identificado com sucesso no cabeçalho');

    // Teste de Submissão de Comentário pelo Painel Web
    console.log('[E2E UI] 💬 Testando envio de comentário pelo Painel Web...');
    await page.evaluate("document.getElementById('commentInteractiveBox')?.classList.remove('hidden')");
    const webInput = page.locator('#webCommentInput');
    await webInput.fill('Desenvolvendo testes E2E do Guardião Nobe');
    const btnSendWeb = page.locator('#btnSendWebComment');
    await btnSendWeb.click();
    await page.waitForTimeout(600);
    console.log('[E2E UI] ✅ Comentário submetido com sucesso via Painel Web');

    // 4. Teste do Menu Sanduíche (Drawer)
    console.log('[E2E UI] 🥪 Testando Menu Sanduíche (Drawer)...');
    const menuSandwichBtn = page.locator('#menuSandwichBtn');
    await menuSandwichBtn.click();
    await page.waitForTimeout(400);
    const drawerSidebar = page.locator('#drawerSidebar');
    assert.strictEqual(await drawerSidebar.evaluate((el) => el.classList.contains('translate-x-0')), true);
    console.log('[E2E UI] ✅ Menu Sanduíche aberto com sucesso');

    // Clica em um item do menu sanduíche
    const drawerAuditBtn = page.locator('#drawerBtn-audit');
    await drawerAuditBtn.click();
    await page.waitForTimeout(400);
    assert.strictEqual(await drawerSidebar.evaluate((el) => el.classList.contains('-translate-x-full')), true);
    console.log('[E2E UI] ✅ Menu Sanduíche fechado automaticamente após navegação');

    // Validação do Card Compacto (quando aba interna está ativa)
    const cardCompact = page.locator('#activeCardCompact');
    assert.strictEqual(await cardCompact.evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Card de Gestão compactado com sucesso ao abrir a aba');

    // Expande o Card de Gestão novamente
    await page.evaluate("expandActiveCard()");
    await page.waitForTimeout(300);
    const cardExpanded = page.locator('#activeCardExpanded');
    assert.strictEqual(await cardExpanded.evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Card de Gestão re-expandido com sucesso');

    // 5. Navegação pelas Abas
    console.log('[E2E UI] 📑 2. Testando navegação por abas...');
    
    // Aba: Agenda Semanal (Horários)
    await page.evaluate("openTab('schedule')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-schedule').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Agenda Semanal aberta com sucesso');

    // Aba: Bateria de Testes & Jitter
    await page.evaluate("openTab('test')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-test').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Testes & Jitter aberta com sucesso');

    // Aba: Agenda de Tarefas do Dia
    await page.evaluate("openTab('agenda')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-agenda').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Tarefas do Dia aberta com sucesso');

    // Aba: Comentários Fallback
    await page.evaluate("openTab('templates')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-templates').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Comentários Fallback aberta com sucesso');

    // Aba: Configurações
    await page.evaluate("openTab('settings')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-settings').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Configurações aberta com sucesso');

    // Aba: Auditoria (30 Dias)
    await page.evaluate("openTab('audit')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-audit').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Auditoria aberta com sucesso');

    // Re-expande a Gestão Principal para testar os botões
    await page.evaluate("expandActiveCard()");
    await page.waitForTimeout(300);

    // 5. Teste de Transição dos Botões de Controle na Interface
    console.log('[E2E UI] 🎮 3. Testando botões de controle de expediente na interface gráfica...');
    
    // Clica em Iniciar
    const btnStart = page.locator('#btnStart');
    if (await btnStart.isVisible()) {
      await btnStart.click();
      await page.waitForFunction("document.getElementById('stateText')?.innerText === 'TRABALHANDO'", { timeout: 8000 });
      const stateAfterStart = await page.locator('#stateText').innerText();
      console.log('[E2E UI] ✅ Botão Iniciar clicado -> Estado atual:', stateAfterStart);
      assert.strictEqual(stateAfterStart, 'TRABALHANDO');
    }

    // Clica em Pausar
    const btnPause = page.locator('#btnPause');
    await btnPause.click();
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'PAUSADO'", { timeout: 8000 });
    const stateAfterPause = await page.locator('#stateText').innerText();
    console.log('[E2E UI] ✅ Botão Pausar clicado -> Estado atual:', stateAfterPause);
    assert.strictEqual(stateAfterPause, 'PAUSADO');

    // Clica em Retomar
    const btnResume = page.locator('#btnResume');
    await btnResume.click();
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'TRABALHANDO'", { timeout: 8000 });
    const stateAfterResume = await page.locator('#stateText').innerText();
    console.log('[E2E UI] ✅ Botão Retomar clicado -> Estado atual:', stateAfterResume);
    assert.strictEqual(stateAfterResume, 'TRABALHANDO');

    // Clica em Almoço
    const btnLunch = page.locator('#btnLunch');
    await btnLunch.click();
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'ALMOÇO'", { timeout: 8000 });
    const stateAfterLunch = await page.locator('#stateText').innerText();
    console.log('[E2E UI] ✅ Botão Almoço clicado -> Estado atual:', stateAfterLunch);
    assert.strictEqual(stateAfterLunch, 'ALMOÇO');

    // Clica em Retomar do almoço
    await btnResume.click();
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'TRABALHANDO'", { timeout: 8000 });
    assert.strictEqual(await page.locator('#stateText').innerText(), 'TRABALHANDO');

    // Clica em Encerrar
    const btnEnd = page.locator('#btnEnd');
    await btnEnd.click();
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'EM ESPERA'", { timeout: 15000 });
    const stateAfterEnd = await page.locator('#stateText').innerText();
    console.log('[E2E UI] ✅ Botão Encerrar clicado -> Estado atual:', stateAfterEnd);
    assert.strictEqual(stateAfterEnd, 'EM ESPERA');

    // 6. Screenshot Desktop
    const desktopScreenshotPath = path.join(SCREENSHOT_DIR, 'desktop_e2e.png');
    await page.screenshot({ path: desktopScreenshotPath, fullPage: true });
    console.log('[E2E UI] 📸 Screenshot Desktop salvo em:', desktopScreenshotPath);

    // 7. Teste de Responsividade Mobile (375x667 iPhone SE)
    console.log('[E2E UI] 📱 4. Testando interface gráfica em Mobile (375x667)...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Validação da barra inferior Mobile (Bottom Nav)
    const mobileDashboardBtn = page.locator('#mTabBtn-dashboard');
    assert.ok(await mobileDashboardBtn.isVisible(), 'Barra inferior mobile deve estar visível');
    await mobileDashboardBtn.click();
    await page.waitForTimeout(500);

    const mobileAuditBtn = page.locator('#mTabBtn-audit');
    await mobileAuditBtn.click();
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-audit').evaluate((el) => !el.classList.contains('hidden')), true);

    // Screenshot Mobile
    const mobileScreenshotPath = path.join(SCREENSHOT_DIR, 'mobile_e2e.png');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
    console.log('[E2E UI] 📸 Screenshot Mobile salvo em:', mobileScreenshotPath);

    console.log('\n[E2E UI] 🎉 TODOS OS TESTES DE INTERFACE GRÁFICA PASSARAM COM SUCESSO!\n');
  } finally {
    if (browser) {
      await browser.close();
    }
    Engine.getInstance().stop();
    server.close();
  }
});
