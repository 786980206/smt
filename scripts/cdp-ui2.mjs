#!/usr/bin/env node
// UI 实测：双击任务 → 标签页打开 → 黑窗输出可见 → 状态徽标正确
import { get } from 'node:http';
const WS = globalThis.WebSocket;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!page) throw new Error('APP PAGE NOT FOUND');
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

  const findRow = `(() => {
    const spans = [...document.querySelectorAll('span')].filter(s => s.textContent === 'file-server');
    let el = spans[0];
    while (el && !(el.onclick || el.getAttribute('data-task'))) el = el.parentElement;
    return { found: !!spans[0], dblclickable: !!el };
  })()`;

  await step('1. 等待任务树加载', `(async () => {
    for (let i = 0; i < 50; i++) {
      const s = [...document.querySelectorAll('span')].some(s => s.textContent === 'file-server');
      if (s) return 'tree loaded';
      await new Promise(r => setTimeout(r, 200));
    }
    return 'TREE NOT LOADED: ' + document.body.innerText.slice(0, 300);
  })()`);

  await step('2. 双击 file-server 行', `(async () => {
    const spans = [...document.querySelectorAll('span')].filter(s => s.textContent === 'file-server');
    const span = spans[0];
    let row = span;
    for (let i = 0; i < 8 && row.parentElement; i++) {
      if (row.parentElement.querySelector && row.parentElement.querySelector('button')) { row = row.parentElement; break; }
      row = row.parentElement;
    }
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'dblclicked on <' + row.tagName + '>';
  })()`);

  await sleep(4000);
  await step('3. 控制台 tab 输出', `(() => {
    const tabs = [...document.querySelectorAll('.flexlayout__tab')];
    const cons = [...document.querySelectorAll('.flexlayout__tab')].flatMap(t =>
      [...t.querySelectorAll('*')].filter(e => e.textContent && e.textContent.includes('Serving HTTP'))
    );
    return {
      tabCount: tabs.length,
      tabTexts: tabs.map(t => t.textContent.trim().slice(0, 120)),
      consoleHasOutput: cons.length > 0,
      outputSnippet: cons.length ? cons[0].textContent.slice(0, 80) : null,
      innerHeight: cons.length ? cons[0].getBoundingClientRect().height : 0,
    };
  })()`);

  await step('4. 状态徽标', `(() => {
    const badges = [...document.querySelectorAll('*')].filter(e =>
      e.textContent === '运行中' && e.children.length === 0);
    return badges.length > 0 ? '找到运行中徽标' : '未找到运行中徽标';
  })()`);

  await step('5. 停止进程（UI 按钮模拟）', `(async () => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.title === '停止');
    if (!btns.length) return 'NO STOP BTN';
    btns[0].click();
    await new Promise(r => setTimeout(r, 1500));
    const badges = [...document.querySelectorAll('*')].filter(e =>
      e.textContent === '已停止' && e.children.length === 0);
    return badges.length ? '已变为 已停止' : '状态未变为已停止';
  })()`);

  ws.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
