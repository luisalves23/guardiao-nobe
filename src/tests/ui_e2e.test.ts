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

    // 4. Navegação pelas Abas Desktop
    console.log('[E2E UI] 📑 2. Testando navegação por abas...');
    
    // Aba: Agenda do Dia
    await page.evaluate("switchTab('agenda')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-agenda').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Agenda do Dia aberta com sucesso');

    // Aba: Comentários Fallback
    await page.evaluate("switchTab('templates')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-templates').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Comentários Fallback aberta com sucesso');

    // Aba: Configurações
    await page.evaluate("switchTab('settings')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-settings').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Configurações aberta com sucesso');

    // Aba: Auditoria (30 Dias)
    await page.evaluate("switchTab('audit')");
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-audit').evaluate((el) => !el.classList.contains('hidden')), true);
    console.log('[E2E UI] ✅ Aba Auditoria aberta com sucesso');

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
    await page.waitForFunction("document.getElementById('stateText')?.innerText === 'EM ESPERA'", { timeout: 8000 });
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
    const mobileAgendaBtn = page.locator('#mTabBtn-agenda');
    assert.ok(await mobileAgendaBtn.isVisible(), 'Barra inferior mobile deve estar visível');
    await mobileAgendaBtn.click();
    await page.waitForTimeout(500);
    assert.strictEqual(await page.locator('#tab-agenda').evaluate((el) => !el.classList.contains('hidden')), true);

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
