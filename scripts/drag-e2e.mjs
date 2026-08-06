import { get } from 'node:http';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function getJson(url) { return new Promise((res, rej) => get(url, (r) => { let d=''; r.on('data',(c)=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej)); }
async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const r = m.result?.result; pend.get(m.id)(r?.subtype==='error' ? 'EXPR_ERR ' + r?.description : r?.value); pend.delete(m.id); } };
  const evA = async (expression) => { const raw = await (() => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async () => { try { return await (${expression}); } catch (e) { return 'ERR: ' + e; } })()`, returnByValue: true, awaitPromise: true } })); }))(); return raw; };
  ws.send(JSON.stringify({ id: ++id, method: 'Page.reload' })); await sleep(2800);

  const probeId = await evA(`window.__TAURI__.core.invoke('create_task', { input: { name: 'drag-probe', folderId: null, command: 'echo drag-probe', workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: false, shell: null } }).then(p => p.tasks.find(t => t.name === 'drag-probe').id)`);
  await evA(`useTaskStore ? 'n/a' : 'n/a'`).catch(() => {});
  // 前端树需要感知新任务：直接调 store 的 refresh
  await evA(`(async () => { const mod = await import('/src/stores/taskStore.ts'); mod.useTaskStore.getState().refresh(); return 'refreshed'; })()`);
  await sleep(500);

  console.log('行存在:', await evA(`(() => { const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe')); return row ? row.getAttribute('title') : 'NO ROW'; })()`));

  console.log('拖入文件夹:', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const folder = [...document.querySelectorAll('div[title]')].find(d => d.getAttribute('title') === 'Web 服务');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    folder.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    folder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const t = (await window.__TAURI__.core.invoke('list_tasks')).tasks.find(x => x.id === '${probeId}');
    return t.folderId === 'folder-web-services' ? 'OK 已移入 Web 服务' : 'FOLDER=' + t.folderId;
  })()`));

  console.log('拖回根:', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const panel = document.querySelector('div[class*="bg-nav"] > div');
    const root = [...document.querySelectorAll('div')].find(d => d.textContent?.includes('暂无任务') || (d.querySelectorAll('[title]').length > 3 && (d.getAttribute('style') || '').includes('width:')));
    const target = root && root.querySelector('div[class*="overflow-y-auto"]') ? root.querySelector('div[class*="overflow-y-auto"]') : root;
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const t = (await window.__TAURI__.core.invoke('list_tasks')).tasks.find(x => x.id === '${probeId}');
    return t.folderId === null ? 'OK 已移回根' : 'FOLDER=' + t.folderId;
  })()`));

  console.log('拖到任务行(移至该任务所在文件夹):', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const fileServer = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('file-server'));
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    fileServer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 150));
    fileServer.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const t = (await window.__TAURI__.core.invoke('list_tasks')).tasks.find(x => x.id === '${probeId}');
    return t.folderId === 'folder-web-services' ? 'OK 移到 file-server 所在文件夹' : 'FOLDER=' + t.folderId;
  })()`));

  console.log('复制任务:', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 4 }));
    await new Promise(r2 => setTimeout(r2, 300));
    const btn = [...document.querySelectorAll('.ctx-menu-item')].find(b => b.textContent === '复制任务');
    btn?.click();
    await new Promise(r2 => setTimeout(r2, 400));
    const p = await window.__TAURI__.core.invoke('list_tasks');
    return p.tasks.some(t => t.name === 'drag-probe 副本') ? 'OK 副本已创建' : 'NO COPY';
  })()`));

  console.log('右键菜单颜色:', await evA(`(async () => {
    const row = [...document.querySelectorAll('div[title]')].find(d => (d.getAttribute('title') || '').startsWith('drag-probe'));
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 4 }));
    await new Promise(r2 => setTimeout(r2, 300));
    const items = [...document.querySelectorAll('.ctx-menu-item')].filter(b => ['启动','停止','重启'].includes(b.textContent)).map(b => b.textContent + '=' + b.style.color);
    return JSON.stringify(items);
  })()`));

  console.log('清理:', await evA(`(async () => {
    const p = await window.__TAURI__.core.invoke('list_tasks');
    for (const t of p.tasks.filter(t => t.name.startsWith('drag-probe'))) { await window.__TAURI__.core.invoke('delete_task', { id: t.id }); }
    return 'OK';
  })()`));
  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
