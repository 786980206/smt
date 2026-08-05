#!/usr/bin/env node
// 端到端验证：list_tasks → start_process → attach_console → 等 12s 确认进程存活
import { get } from 'node:http';
const WS = globalThis.WebSocket;

function getJson(url) {
  return new Promise((res, rej) =>
    get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej),
  );
}

async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page' && p.title.includes('SMT'));
  if (!page) throw new Error('APP PAGE NOT FOUND: ' + pages.map((p) => p.title).join(' | '));
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const r = m.result?.result;
      pend.get(m.id)(r?.subtype === 'error' ? `EXPR_ERR: ${r?.description}` : r?.value);
      pend.delete(m.id);
    }
  };
  const ev = (expression) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  const expr = (body) => `(async () => { try { return await (${body}); } catch (e) { return 'INVOKE_ERR: ' + e; } })()`;

  const step = async (name, body) => {
    const out = await ev(expr(body));
    console.log(`\n=== ${name} ===`);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
    return out;
  };

  await step('1. stop file-server (clean)', `window.__TAURI__.core.invoke('stop_process', { taskId: 'task-file-server' })`);
  await step('2. start file-server', `window.__TAURI__.core.invoke('start_process', { taskId: 'task-file-server' })`);
  await step('3. attach_console (immediate)', `window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' })`);

  console.log('\n等待 3 秒让 python 输出…');
  await new Promise((r) => setTimeout(r, 3000));
  await step('4. attach_console (after 3s)', `window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' })`);

  console.log('\n等待 10 秒（验证 8 秒强杀 bug 已修复）…');
  await new Promise((r) => setTimeout(r, 10000));
  await step('5. status (after 13s total)', `window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' }).then(r => r.status)`);

  await step('6. stop', `window.__TAURI__.core.invoke('stop_process', { taskId: 'task-file-server' })`);
  ws.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
