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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('[console] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 250));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !m.params.entry.text.includes('favicon')) errors.push('[log] ' + m.params.entry.text.slice(0, 250));
  };
  const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  const evA = async (expression) => {
    const raw = await ev(`(async () => { try { return await (${expression}); } catch (e) { return 'ERR: ' + e; } })()`);
    return raw;
  };
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' })); ws.send(JSON.stringify({ id: ++id, method: 'Log.enable' }));
  ws.send(JSON.stringify({ id: ++id, method: 'Page.reload' })); await sleep(2800);

  console.log('1. 终端探测:', await evA(`window.__TAURI__.core.invoke('list_shells').then(a => a.map(s => s.id + '=' + s.name).join(' | '))`));

  console.log('2. 布局检查:', await evA(`(() => {
    const tabBtn = document.querySelector('.flexlayout__tab_button');
    const tabH = tabBtn ? getComputedStyle(tabBtn).height : null;
    const badge = [...document.querySelectorAll('span')].find(s => /^\\d+\\/\\d+$/.test(s.textContent?.trim() || ''));
    const header = [...document.querySelectorAll('div')].find(d => d.textContent?.includes('任务树') && d.textContent?.includes('新增任务'));
    return JSON.stringify({ tabH, folderBadge: badge?.textContent, headerH: header ? getComputedStyle(header).height : null });
  })()`));

  // 3. 拖拽：新建 drag-probe → 拖到 folder-web-services → 拖回根
  const dragProbe = await evA(`window.__TAURI__.core.invoke('create_task', { input: { name: 'drag-probe', folderId: null, command: 'echo drag-probe', workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: false, shell: null } }).then(p => p.tasks.find(t => t.name === 'drag-probe').id)`);
  console.log('3. drag-probe id:', dragProbe);
  const dragIntoFolder = await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const folder = [...document.querySelectorAll('div[title]')].find(d => d.getAttribute('title') === 'Web 服务');
    if (!row || !folder) return 'NO ROW/FOLDER';
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 120));
    folder.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 120));
    folder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const t = (await window.__TAURI__.core.invoke('list_tasks')).tasks.find(x => x.name === 'drag-probe');
    return t ? (t.folderId === 'folder-web-services' ? 'OK 已移入 Web 服务' : 'FOLDER=' + t.folderId) : 'GONE';
  })()`);
  console.log('   拖入文件夹:', dragIntoFolder);
  const dragToRoot = await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const panel = [...document.querySelectorAll('div')].find(d => /width:\\s*\\d+px/.test(d.getAttribute('style') || '') && d.querySelector('[title="Web 服务"]'));
    if (!row || !panel) return 'NO ROW/PANEL';
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 120));
    panel.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 120));
    panel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const t = (await window.__TAURI__.core.invoke('list_tasks')).tasks.find(x => x.name === 'drag-probe');
    return t && t.folderId === null ? 'OK 已移回根' : 'FOLDER=' + t?.folderId;
  })()`);
  console.log('   拖回根:', dragToRoot);

  // 4. 复制任务
  const dup = await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 4 }));
    await new Promise(r2 => setTimeout(r2, 300));
    const btn = [...document.querySelectorAll('.ctx-menu-item')].find(b => b.textContent === '复制任务');
    btn?.click();
    await new Promise(r2 => setTimeout(r2, 400));
    const p = await window.__TAURI__.core.invoke('list_tasks');
    return p.tasks.some(t => t.name === 'drag-probe 副本') ? 'OK 副本已创建' : 'NO COPY';
  })()`);
  console.log('4. 复制任务:', dup);

  // 5. python 单行 + 多行
  console.log('5. python:', await evA(`(async () => {
    const mk = async (name, cmd) => { const p = await window.__TAURI__.core.invoke('create_task', { input: { name, folderId: null, command: cmd, workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell: 'python' } }); return p.tasks[p.tasks.length - 1]; };
    const one = await mk('py-one', 'print("py-one", 1+1)');
    const multi = await mk('py-multi', 'x = 21\\nprint(f"py-multi {x*2}")\\nimport sys; print(sys.version.split()[0])');
    const out = {};
    for (const [k, t] of [['one', one], ['multi', multi]]) {
      await window.__TAURI__.core.invoke('start_process', { taskId: t.id });
      await new Promise(r => setTimeout(r, 3000));
      const a = await window.__TAURI__.core.invoke('attach_console', { taskId: t.id });
      out[k] = { text: a.text, exit: a.status.exitCode };
    }
    return JSON.stringify(out);
  })()`));

  // 6. q 单行 + 多行
  console.log('6. q:', await evA(`(async () => {
    const mk = async (name, cmd) => { const p = await window.__TAURI__.core.invoke('create_task', { input: { name, folderId: null, command: cmd, workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell: 'q' } }); return p.tasks[p.tasks.length - 1]; };
    const one = await mk('q-one', '1+1');
    const multi = await mk('q-multi', 'a:1 2 3\\nb:sum a\\nshow "q-multi"\\nshow b');
    const out = {};
    for (const [k, t] of [['one', one], ['multi', multi]]) {
      await window.__TAURI__.core.invoke('start_process', { taskId: t.id });
      await new Promise(r => setTimeout(r, 3000));
      const a = await window.__TAURI__.core.invoke('attach_console', { taskId: t.id });
      out[k] = { text: a.text, exit: a.status.exitCode, err: a.status.error };
    }
    return JSON.stringify(out);
  })()`));

  // 7. 控制台按钮配色 + 打开控制台
  console.log('7. 控制台按钮:', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('file-server'));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    const btns = [...document.querySelectorAll('.flexlayout__tab button')].map(b => ({ t: b.title, cls: b.className }));
    return JSON.stringify(btns.filter(b => ['启动','停止','重启'].includes(b.t)));
  })()`));

  // 8. 清理探针
  console.log('8. 清理:', await evA(`(async () => {
    const p = await window.__TAURI__.core.invoke('list_tasks');
    for (const t of p.tasks.filter(t => /^(drag-probe|py-one|py-multi|q-one|q-multi|drag-probe 副本)/.test(t.name))) { await window.__TAURI__.core.invoke('delete_task', { id: t.id }); }
    return 'OK';
  })()`));
  console.log('\n控制台错误数:', errors.length);
  errors.slice(0, 8).forEach(e => console.log(e));
  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
