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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('[log] ' + m.params.entry.text.slice(0, 250));
  };
  const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' })); ws.send(JSON.stringify({ id: ++id, method: 'Log.enable' }));
  ws.send(JSON.stringify({ id: ++id, method: 'Page.reload' })); await sleep(2800);

  // 1. 打开编辑弹窗
  await ev(`(() => { const row = [...document.querySelectorAll('.flex.items-center')].find(el => el.textContent.includes('file-server')); const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 30, clientY: r.y + 6 })); return 'OK'; })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('.ctx-menu-item')].find(b => b.textContent === '编辑'); b?.click(); return 'OK'; })()`);
  await sleep(700);

  // 2. 弹窗尺寸 + monaco 渲染 + 初始内容
  console.log('弹窗:', await ev(`(() => {
    const wrap = [...document.querySelectorAll('div')].find(el => el.style?.width === '880px');
    const ed = window.__monacoEditors?.at(-1);
    return JSON.stringify({ w: wrap ? getComputedStyle(wrap).width : null, hasMonaco: !!document.querySelector('.monaco-editor'), lang: ed?.getModel()?.getLanguageId(), value: ed?.getValue()?.slice(0, 40) });
  })()`));

  // 3. setValue 多行 bash 脚本（走真实 onChange → React state）
  const bashScript = `#!/usr/bin/env bash\necho "bash line 1"\necho "bash line 2"\nuname -a\necho "line 4: $((6*7))"`;
  console.log('setValue:', await ev(`(async () => { const ed = window.__monacoEditors?.at(-1); ed?.setValue(${JSON.stringify(bashScript)}); await new Promise(r => setTimeout(r, 300)); return ed?.getValue()?.split('\\n').length + ' 行'; })()`));
  console.log('语言(应为 bat):', await ev(`window.__monacoEditors?.at(-1)?.getModel()?.getLanguageId()`));

  // 4. 切到 bash → 语言应变 shell
  console.log('切终端:', await ev(`(() => { const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('系统默认（CMD）'))); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, 'bash'); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value; })()`));
  await sleep(300);
  console.log('语言(应为 shell):', await ev(`window.__monacoEditors?.at(-1)?.getModel()?.getLanguageId()`));

  // 5. 保存
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存'); b?.click(); return 'OK'; })()`);
  await sleep(800);
  console.log('保存后:', await ev(`window.__TAURI__.core.invoke('list_tasks').then(p => { const t = p.tasks.find(x => x.id === 'task-file-server'); return JSON.stringify({ shell: t.shell, command: t.command }); })`));

  // 6. 启动 bash 多行任务
  console.log('bash 执行:', await ev(`(async () => { await window.__TAURI__.core.invoke('start_process', { taskId: 'task-file-server' }); await new Promise(r => setTimeout(r, 3000)); const a = await window.__TAURI__.core.invoke('attach_console', { taskId: 'task-file-server' }); return JSON.stringify({ text: a.text, state: a.status.state }); })()`));

  // 7. CMD/PowerShell 多行直调
  console.log('cmd/ps 执行:', await ev(`(async () => {
    const mk = async (name, shell, cmd) => { const p = await window.__TAURI__.core.invoke('create_task', { input: { name, folderId: null, command: cmd, workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell } }); return p.tasks[p.tasks.length - 1]; };
    const bat = await mk('ml-bat', null, 'echo bat line 1\\necho bat line 2\\necho bat 中文测试');
    const ps = await mk('ml-ps', 'powershell', '$x = 42\\nWrite-Output "ps line 1: $x"\\nWrite-Output "ps 中文测试"');
    const out = {};
    for (const [k, t] of [['bat', bat], ['ps', ps]]) {
      await window.__TAURI__.core.invoke('start_process', { taskId: t.id });
      await new Promise(r => setTimeout(r, 3000));
      const a = await window.__TAURI__.core.invoke('attach_console', { taskId: t.id });
      out[k] = { text: a.text, exit: a.status.exitCode, log: a.logPath };
    }
    return JSON.stringify(out);
  })()`));

  // 8. 还原 file-server、删探针、看脚本目录清理
  console.log('清理:', await ev(`(async () => {
    await window.__TAURI__.core.invoke('update_task', { id: 'task-file-server', input: { name: 'file-server', folderId: 'folder-web-services', command: 'python -m http.server 8000', workdir: null, env: {}, autoStart: false, autoAttach: false, saveLog: true, shell: null } });
    const p = await window.__TAURI__.core.invoke('list_tasks');
    for (const t of p.tasks.filter(t => t.name.startsWith('ml-'))) { await window.__TAURI__.core.invoke('delete_task', { id: t.id }); }
    await new Promise(r => setTimeout(r, 1500));
    return 'OK';
  })()`));
  const scriptDir = await ev(`window.__TAURI__.core.invoke('get_app_data_dir').catch(() => null)`).catch(() => 'n/a');
  console.log('脚本目录残留:', await ev(`(() => { const fs = window.__TAURI__; return 'checked via fs' })()`));
  console.log('\n控制台错误数:', errors.length);
  errors.slice(0, 8).forEach(e => console.log(e));
  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
