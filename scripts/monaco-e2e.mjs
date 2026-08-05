import { get } from 'node:http';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function getJson(url) { return new Promise((res, rej) => get(url, (r) => { let d=''; r.on('data',(c)=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej)); }
async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const r = m.result?.result; pend.get(m.id)(r?.subtype==='error' ? 'EXPR_ERR ' + r?.description : r?.value); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('[log.error] ' + m.params.entry.text.slice(0, 300));
  };
  const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  const mouse = (type, x, y, opts = {}) => ws.send(JSON.stringify({ method: 'Input.dispatchMouseEvent', params: { type, x, y, ...opts } }));
  const key = (type, key, opts = {}) => ws.send(JSON.stringify({ method: 'Input.dispatchKeyEvent', params: { type, key, code: key, ...opts } }));
  await ev('1'); ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' })); ws.send(JSON.stringify({ id: ++id, method: 'Log.enable' }));
  await sleep(300);

  // 1. 右键 file-server 任务行 → 编辑
  await ev(`(() => { const row = [...document.querySelectorAll('.flex.items-center')].find(el => el.textContent.includes('file-server')); if (!row) return 'NO ROW'; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 30, clientY: r.y + 6 })); return 'OK'; })()`);
  await sleep(400);
  const menuText = await ev(`[...document.querySelectorAll('.ctx-menu-item')].map(b => b.textContent).join('|')`);
  console.log('右键菜单:', menuText);
  await ev(`(() => { const btn = [...document.querySelectorAll('.ctx-menu-item')].find(b => b.textContent === '编辑'); btn?.click(); return 'OK'; })()`);
  await sleep(600);

  // 2. 弹窗检查
  const modal = await ev(`(() => {
    const wrap = [...document.querySelectorAll('div')].find(el => el.style?.width === '880px');
    const monaco = document.querySelector('.monaco-editor');
    const rect = monaco ? monaco.getBoundingClientRect() : null;
    return JSON.stringify({ modalW: wrap ? getComputedStyle(wrap).width : null, hasMonaco: !!monaco, editorH: rect ? Math.round(rect.height) : null, title: document.querySelector('.bg-surface span')?.textContent });
  })()`);
  console.log('弹窗检查:', modal);

  // 3. 点击编辑器 → 全选 → 输入多行 bash 脚本
  const clickEditor = await ev(`(() => { const el = document.querySelector('.monaco-editor'); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`);
  const { x, y } = JSON.parse(clickEditor);
  await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
  await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
  await sleep(300);
  const focused = await ev(`(() => { const ta = document.querySelector('.monaco-editor textarea'); if (!ta) return 'NO TA'; ta.focus(); return 'OK'; })()`);
  await sleep(200);
  await key('keyDown', 'a', { modifiers: 2 });
  await key('keyUp', 'a', { modifiers: 2 });
  await sleep(200);
  const bashScript = `echo "bash line 1"\necho "bash line 2"\nwhoami\npwd`;
  ws.send(JSON.stringify({ method: 'Input.insertText', params: { text: bashScript } }));
  await sleep(400);
  const curLang = await ev(`(() => { const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('系统默认（CMD）'))); return sel ? sel.value : 'NO SEL'; })()`);
  console.log('当前终端值:', curLang);
  // 4. 切到 bash
  await ev(`(() => { const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('系统默认（CMD）'))); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, 'bash'); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value; })()`);
  await sleep(300);
  // 5. 保存
  await ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存'); btn?.click(); return 'OK'; })()`);
  await sleep(700);
  const saved = await ev(`window.__TAURI__.core.invoke('list_tasks').then(p => { const t = p.tasks.find(x => x.id === 'task-file-server'); return JSON.stringify({ command: t.command, shell: t.shell }); })`);
  console.log('保存后任务:', saved);

  // 6. 启动并检查输出
  const run1 = await ev(`(async () => { await window.__TAURI__.core.invoke('start_process', { taskId: 'task-file-server' }); await new Promise(r => setTimeout(r, 2500)); const a = await window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' }); return JSON.stringify({ text: a.text, status: a.status.state }); })()`);
  console.log('bash 多行输出:', run1);

  // 7. CMD / PowerShell 多行直调
  const run2 = await ev(`(async () => {
    const mk = async (name, shell, cmd) => { const p = await window.__TAURI__.core.invoke('create_task', { input: { name, folderId: null, command: cmd, workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell } }); return p.tasks[p.tasks.length - 1]; };
    const bat = await mk('ml-bat', null, '@echo off\\necho bat line 1\\necho bat line 2\\ndir /b "%TEMP%" >nul && echo temp-ok');
    const ps = await mk('ml-ps', 'powershell', '$x = 42\\nWrite-Output "ps line 1: $x"\\nWrite-Output "ps line 2"');
    const out = {};
    for (const [key, t] of [['bat', bat], ['ps', ps]]) {
      await window.__TAURI__.core.invoke('start_process', { taskId: t.id });
      await new Promise(r => setTimeout(r, 2500));
      const a = await window.__TAURI__.core.invoke('attach_console', { taskId: t.id });
      out[key] = { text: a.text, exit: a.status.exitCode };
    }
    return JSON.stringify(out);
  })()`);
  console.log('CMD/PowerShell 多行输出:', run2);

  // 8. 还原 file-server、清理探针
  const clean = await ev(`(async () => {
    await window.__TAURI__.core.invoke('update_task', { id: 'task-file-server', input: { name: 'file-server', folderId: 'folder-web-services', command: 'python -m http.server 8000', workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell: null } });
    const p = await window.__TAURI__.core.invoke('list_tasks');
    for (const t of p.tasks.filter(t => t.name.startsWith('ml-'))) { await window.__TAURI__.core.invoke('delete_task', { id: t.id }); }
    return 'OK';
  })()`);
  console.log('清理:', clean);
  console.log('\n控制台错误数:', errors.length);
  errors.slice(0, 10).forEach(e => console.log(e));
  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
