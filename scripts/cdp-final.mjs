#!/usr/bin/env node
// 最终验证：HTTP 可用性 + stop 杀进程 + ping 任务
import { get } from 'node:http';
const WS = globalThis.WebSocket;
function getJson(url) {
  return new Promise((res, rej) =>
    get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej),
  );
}
async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page' && p.title.includes('SMT'));
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result?.result?.value); pend.delete(m.id); }
  };
  const ev = (expression) =>
    new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  const expr = (body) => `(async () => { try { return await (${body}); } catch (e) { return 'ERR: ' + e; } })()`;
  const step = async (name, body) => {
    const out = await ev(expr(body));
    console.log(`=== ${name} ===`);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  };

  await step('1. HTTP GET localhost:8000', `fetch('http://127.0.0.1:8000/').then(r => 'HTTP ' + r.status)`, );

  await step('2. 停止 file-server', `window.__TAURI__.core.invoke('stop_process', { taskId: 'task-file-server' })`);
  console.log('\n等待 3 秒让进程树被杀…');
  await new Promise((r) => setTimeout(r, 3000));
  await step('3. attach_console 确认状态', `window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' }).then(r => r.status)`);
  await step('4. HTTP 应失败', `fetch('http://127.0.0.1:8000/').then(() => 'STILL ALIVE!', () => 'connection refused (correct)')`);

  console.log('\n启动 ping 任务…');
  await step('5. 启动 ping (baidu.com)', `window.__TAURI__.core.invoke('start_process', { taskId: 'task-1785849981361-361922000' })`);
  console.log('\n等待 8 秒（ping 运行+退出）…');
  await new Promise((r) => setTimeout(r, 8000));
  await step('6. ping 输出与状态', `window.__TAURI__.core.invoke('attach_console', { taskId: 'task-1785849981361-361922000' })`);

  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
