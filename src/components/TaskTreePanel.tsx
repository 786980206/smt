import { useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Play,
  Square,
  RotateCw,
  FolderPlus,
  FilePlus,
  TerminalSquare,
  RefreshCw,
  GripVertical,
} from 'lucide-react';
import type { TreeNode, TaskDef } from '@/types';
import { useTaskStore, buildTree } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { openConsoleTab } from '@/components/Workspace';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { TaskFormModal } from '@/components/TaskFormModal';
import { Modal } from '@/components/Modal';

type MenuState =
  | { kind: 'task'; id: string; x: number; y: number }
  | { kind: 'folder'; id: string; x: number; y: number }
  | { kind: 'blank'; x: number; y: number };

interface FormState {
  task: TaskDef | null;
  defaultFolderId: string | null;
}

interface RenameState {
  kind: 'folder';
  id: string;
  name: string;
}

function stateColor(state: string): string {
  if (state === 'running') return 'status-dot-running';
  if (state === 'exited' || state === 'error') return 'status-dot-error';
  if (state === 'starting' || state === 'stopping' || state === 'restarting') return 'status-dot-starting';
  return 'status-dot-stopped';
}

const RUNNABLE_STATES = ['running', 'exited', 'error'];

/** 文件夹内的任务总数与运行数（含子文件夹） */
function folderStats(node: Extract<TreeNode, { kind: 'folder' }>, statuses: Record<string, string>): [number, number] {
  let total = 0;
  let running = 0;
  const walk = (n: TreeNode) => {
    if (n.kind === 'task') {
      total++;
      if (statuses[n.data.id] === 'running') running++;
    } else {
      for (const c of n.children) walk(c);
    }
  };
  for (const c of node.children) walk(c);
  return [total, running];
}

/** 按 id 在树中查找节点 */
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.data.id === id) return n;
    if (n.kind === 'folder') {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** 节点下所有任务 id（含子文件夹） */
function collectTaskIds(node: TreeNode): string[] {
  return node.kind === 'task' ? [node.data.id] : node.children.flatMap(collectTaskIds);
}

/** 节点自身及其所有子文件夹 id */
function collectFolderIds(node: TreeNode): string[] {
  return node.kind === 'folder' ? [node.data.id, ...node.children.flatMap(collectFolderIds)] : [];
}

export function TaskTreePanel() {
  const folders = useTaskStore((s) => s.folders);
  const tasks = useTaskStore((s) => s.tasks);
  const statuses = useTaskStore((s) => s.statuses);
  const ports = useTaskStore((s) => s.ports);
  const openBrowser = useTaskStore((s) => s.openBrowser);
  const ready = useTaskStore((s) => s.ready);
  const start = useTaskStore((s) => s.start);
  const startElevated = useTaskStore((s) => s.startElevated);
  const stop = useTaskStore((s) => s.stop);
  const restart = useTaskStore((s) => s.restart);
  const createTask = useTaskStore((s) => s.createTask);
  const createFolder = useTaskStore((s) => s.createFolder);
  const renameFolder = useTaskStore((s) => s.renameFolder);
  const deleteFolder = useTaskStore((s) => s.deleteFolder);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const refresh = useTaskStore((s) => s.refresh);
  const treeWidth = useUIStore((s) => s.treeWidth);
  const collapsed = useUIStore((s) => s.collapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleCollapsed);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formSeq, setFormSeq] = useState(0);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; kind: 'folder' | 'task' } | null>(null);
  const [dragOver, setDragOver] = useState<{ kind: 'folder' | 'task'; id: string } | 'root' | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);

  interface DragSession {
    id: string;
    kind: 'folder' | 'task';
    sourceParent: string | null;
    startX: number;
    startY: number;
    active: boolean;
  }
  const dragRef = useRef<DragSession | null>(null);
  const didDragRef = useRef(false);

  const openForm = (f: FormState) => {
    setForm(f);
    setFormSeq((n) => n + 1);
  };

  const tree = useMemo(() => buildTree(folders, tasks), [folders, tasks]);

  const openConsole = (task: TaskDef) => {
    setSelected(task.id);
    openConsoleTab(task.id, task.name);
    // 进程未运行时，开 tab 后自动启动（让 ConsoleTab 先订阅再启动，保证初始输出不丢）
    const st = statuses[task.id]?.state;
    if (!st || ['stopped', 'exited', 'error'].includes(st)) {
      setTimeout(() => void start(task.id), 200);
    }
  };

  const onTaskContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    setMenu({ kind: 'task', id, x: e.clientX, y: e.clientY });
  };

  const onFolderContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: 'folder', id, x: e.clientX, y: e.clientY });
  };

  const taskMenu = (task: TaskDef): ContextMenuItem[] => {
    const st = statuses[task.id]?.state;
    return [
      { label: '启动', color: 'rgb(var(--color-up))', action: () => void start(task.id), disabled: st === 'running' || st === 'starting' },
      { label: '以管理员身份运行', color: 'rgb(var(--color-accent))', action: () => void startElevated(task.id), disabled: st === 'running' || st === 'starting' },
      { label: '停止', color: 'rgb(var(--color-down))', action: () => void stop(task.id), disabled: st !== 'running' && st !== 'starting' },
      { label: '重启', color: 'rgb(var(--color-accent))', action: () => void restart(task.id), disabled: !st || !RUNNABLE_STATES.includes(st) },
      { label: '', action: () => {}, disabled: true },
      { label: '打开输出窗口', action: () => openConsole(task) },
      { label: '复制任务', action: () => void duplicate(task) },
      { label: '编辑', action: () => openForm({ task, defaultFolderId: task.folderId }) },
      { label: '删除', action: () => void deleteTask(task.id), danger: true },
    ];
  };

  const duplicate = async (task: TaskDef) => {
    const id = await createTask({
      name: `${task.name} 副本`,
      folderId: task.folderId,
      command: task.command,
      workdir: task.workdir,
      env: task.env,
      autoStart: false,
      autoAttach: false,
      saveLog: task.saveLog,
      shell: task.shell,
      runAsAdmin: task.runAsAdmin,
    });
    if (id) setSelected(id);
  };

  const folderMenu = (folderId: string): ContextMenuItem[] => {
    const node = findNode(tree, folderId);
    const runAll = (fn: (id: string) => Promise<unknown>) => {
      if (node) void Promise.all(collectTaskIds(node).map((id) => fn(id)));
    };
    return [
      { label: '启动全部', color: 'rgb(var(--color-up))', action: () => runAll(start) },
      { label: '停止全部', color: 'rgb(var(--color-down))', action: () => runAll(stop) },
      { label: '重启全部', color: 'rgb(var(--color-accent))', action: () => runAll(restart) },
      { label: '', action: () => {}, disabled: true },
      { label: '新增子文件夹', action: () => void createFolder('新建文件夹', folderId) },
      { label: '新增任务', action: () => openForm({ task: null, defaultFolderId: folderId }) },
      { label: '重命名', action: () => setRename({ kind: 'folder', id: folderId, name: folders.find((f) => f.id === folderId)?.name ?? '' }) },
      { label: '删除', action: () => void deleteFolder(folderId), danger: true },
    ];
  };

  const blankMenu: ContextMenuItem[] = [
    { label: '新增文件夹', action: () => void createFolder('新建文件夹', null) },
    { label: '新增任务', action: () => openForm({ task: null, defaultFolderId: null }) },
  ];

  /** Pointer 事件实现拖拽（不依赖 WebView2 时好时坏的 HTML5 DnD） */

  const resolveDrop = (clientX: number, clientY: number): { kind: 'folder' | 'task'; id: string } | 'root' | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const target = el instanceof Element ? el.closest<HTMLElement>('[data-node-kind]') : null;
    if (!target) return null;
    const kind = target.getAttribute('data-node-kind');
    if (kind === 'folder') return { kind: 'folder', id: target.getAttribute('data-node-id')! };
    if (kind === 'task') return { kind: 'task', id: target.getAttribute('data-node-id')! };
    if (kind === 'tree') return 'root';
    return null;
  };

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
      d.active = true;
      didDragRef.current = true;
      setDragging({ id: d.id, kind: d.kind });
    }
    const label = d.kind === 'folder' ? folders.find((f) => f.id === d.id)?.name ?? '' : tasks.find((t) => t.id === d.id)?.name ?? '';
    setGhost({ x: e.clientX, y: e.clientY, label });
    document.body.style.cursor = 'grabbing';
    const hit = resolveDrop(e.clientX, e.clientY);
    setDragOver(hit);
  };

  const onUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    didDragRef.current = false;
    const d = dragRef.current;
    dragRef.current = null;
    document.body.style.cursor = '';
    setGhost(null);
    if (!d || !d.active) {
      setDragging(null);
      setDragOver(null);
      return;
    }
    const hit = resolveDrop(e.clientX, e.clientY);
    const store = useTaskStore.getState();
    if (d.kind === 'folder') {
      const source = d as DragSession;
      const node = findNode(tree, source.id);
      const selfAndDesc = (node?.kind === 'folder' ? collectFolderIds(node) : []) as string[];
      const forbidden = (fid: string | null) => !!fid && (selfAndDesc.includes(fid) || fid === source.id);
      if (hit === 'root') {
        if (source.sourceParent !== null) void store.moveFolder(source.id, null);
      } else if (hit) {
        if (hit.kind === 'folder' && !forbidden(hit.id) && hit.id !== source.sourceParent) {
          void store.moveFolder(source.id, hit.id);
        } else if (hit.kind === 'task') {
          const parent = tasks.find((t) => t.id === hit.id)?.folderId ?? null;
          if (parent !== null && !forbidden(parent)) void store.moveFolder(source.id, parent);
        }
      }
    } else {
      const source = d as DragSession;
      if (hit === 'root') {
        if (source.sourceParent !== null) void store.moveTask(source.id, null);
      } else if (hit) {
        if (hit.kind === 'folder') {
          if (hit.id !== source.sourceParent) void store.moveTask(source.id, hit.id);
        } else if (hit.id !== source.id) {
          const parent = tasks.find((t) => t.id === hit.id)?.folderId ?? null;
          if (parent !== source.sourceParent) void store.moveTask(source.id, parent);
        }
      }
    }
    setDragging(null);
    setDragOver(null);
  };

  const beginDrag = (e: React.PointerEvent, kind: 'folder' | 'task', id: string, sourceParent: string | null) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('[data-act]')) return;
    // 不要 setPointerCapture：拖动逻辑全部走 window 级 pointermove/pointerup，
    // 捕获没有任何收益；反而若指针在窗口外松开，捕获不会被释放，
    // 会把后续第一次点击重定向到本节点（Modal 里 Monaco 首次点击失焦的根因）。
    dragRef.current = { id, kind, sourceParent, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      const f = node.data;
      const isCollapsed = !!collapsed[f.id];
      const hasChildren = node.children.length > 0;
      const overFolderId = dragOver !== null && dragOver !== 'root' && dragOver.kind === 'folder' ? dragOver.id : null;
      const [total, running] = folderStats(node, Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, v.state])));
      return (
        <div key={f.id}>
          <div
            data-node-kind="folder"
            data-node-id={f.id}
            className={`flex items-center h-6 pr-2 cursor-pointer group hover:bg-nav-hover select-none ${selected === f.id ? 'bg-nav-active' : ''} ${dragging?.id === f.id ? 'opacity-60 outline outline-dashed outline-1 outline-border-default -outline-offset-2' : ''} ${overFolderId === f.id ? 'bg-accent/15 outline outline-1 outline-accent/60 -outline-offset-1' : ''}`}
            style={{ paddingLeft: depth * 12 + 4 }}
            title={f.name}
            onPointerDown={(e) => beginDrag(e, 'folder', f.id, f.parentId)}
            onClick={() => {
              if (didDragRef.current) {
                didDragRef.current = false;
                return;
              }
              setSelected(f.id);
              if (hasChildren) toggleCollapsed(f.id);
            }}
            onContextMenu={(e) => onFolderContextMenu(e, f.id)}
          >
            {hasChildren ? (
              isCollapsed ? (
                <ChevronRight size={11} className="shrink-0 text-txt-muted" />
              ) : (
                <ChevronDown size={11} className="shrink-0 text-txt-muted" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            {isCollapsed ? (
              <Folder size={12} className="shrink-0 mx-1 text-txt-muted" />
            ) : (
              <FolderOpen size={12} className="shrink-0 mx-1 text-accent" />
            )}
            <span className="flex-1 text-xs truncate">{f.name}</span>
            {total > 0 && (
              <span className={`shrink-0 mr-1 text-[10px] font-mono ${running > 0 ? 'text-financial-up' : 'text-txt-subtle'}`}>
                {running}/{total}
              </span>
            )}
            <span className="hidden group-hover:flex items-center gap-1.5 shrink-0">
              <span data-act title="启动全部" className="flex items-center">
                <Play
                  size={11}
                  className="text-financial-up hover:bg-financial-up/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const n = findNode(tree, f.id);
                    if (n) void Promise.all(collectTaskIds(n).map((id) => start(id)));
                  }}
                />
              </span>
              <span data-act title="停止全部" className="flex items-center">
                <Square
                  size={10}
                  className="text-financial-down hover:bg-financial-down/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const n = findNode(tree, f.id);
                    if (n) void Promise.all(collectTaskIds(n).map((id) => stop(id)));
                  }}
                />
              </span>
              <span data-act title="重启全部" className="flex items-center">
                <RotateCw
                  size={11}
                  className="text-accent hover:bg-accent/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const n = findNode(tree, f.id);
                    if (n) void Promise.all(collectTaskIds(n).map((id) => restart(id)));
                  }}
                />
              </span>
              <span data-act title="新增子文件夹" className="flex items-center">
                <FolderPlus
                  size={12}
                  className="text-txt-muted hover:text-txt-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    void createFolder('新建文件夹', f.id);
                  }}
                />
              </span>
              <span data-act title="在此文件夹新增任务" className="flex items-center">
                <FilePlus
                  size={12}
                  className="text-txt-muted hover:text-txt-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm({ task: null, defaultFolderId: f.id });
                  }}
                />
              </span>
            </span>
          </div>
          {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    const task = node.data;
    const st = statuses[task.id]?.state ?? 'stopped';
    const overTaskId = dragOver !== null && dragOver !== 'root' && dragOver.kind === 'task' ? dragOver.id : null;
    return (
      <div
        key={task.id}
        data-node-kind="task"
        data-node-id={task.id}
        data-folder={task.folderId ?? ''}
        className={`flex items-center h-6 pr-2 cursor-pointer group hover:bg-nav-hover select-none ${selected === task.id ? 'bg-nav-active' : ''} ${dragging?.id === task.id ? 'opacity-60 outline outline-dashed outline-1 outline-border-default -outline-offset-2' : ''} ${overTaskId === task.id ? 'bg-accent/10' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        title={`${task.name} — ${task.command}`}
        onPointerDown={(e) => beginDrag(e, 'task', task.id, task.folderId)}
        onDoubleClick={() => openConsole(task)}
        onClick={() => {
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          setSelected(task.id);
        }}
        onContextMenu={(e) => onTaskContextMenu(e, task.id)}
      >
        <span className="w-3 shrink-0" />
        <span className={`status-dot ${stateColor(st)} mx-1`} />
        <span className="flex-1 text-xs truncate">{task.name}</span>
        {ports[task.id]?.length ? (
          <span className="flex items-center gap-1 mr-1 shrink-0">
            {ports[task.id]!.map((url) => (
              <button
                key={url}
                data-act
                className="px-1 text-[10px] rounded-sm text-accent bg-accent/10 hover:bg-accent/20 font-mono"
                title={`用浏览器打开 ${url}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void openBrowser(url);
                }}
              >
                :{url.slice(url.lastIndexOf(':') + 1)}
              </button>
            ))}
          </span>
        ) : null}
        <span className="hidden group-hover:flex items-center gap-1.5 shrink-0">
          <button
            data-act
            className="flex items-center justify-center w-4 h-4 rounded-sm text-txt-muted hover:text-accent"
            title="打开输出窗口"
            onClick={(e) => {
              e.stopPropagation();
              openConsole(task);
            }}
          >
            <TerminalSquare size={11} />
          </button>
          {st === 'running' ? (
            <button
              data-act
              className="flex items-center justify-center w-4 h-4 rounded-sm text-financial-down hover:bg-financial-down/10"
              title="停止"
              onClick={(e) => {
                e.stopPropagation();
                void stop(task.id);
              }}
            >
              <Square size={10} />
            </button>
          ) : (
            st !== 'starting' && (
              <button
                data-act
                className="flex items-center justify-center w-4 h-4 rounded-sm text-financial-up hover:bg-financial-up/10"
                title="启动"
                onClick={(e) => {
                  e.stopPropagation();
                  void start(task.id);
                }}
              >
                <Play size={10} />
              </button>
            )
          )}
          <button
            data-act
            className="flex items-center justify-center w-4 h-4 rounded-sm text-accent hover:bg-accent/10"
            title="重启"
            onClick={(e) => {
              e.stopPropagation();
              void restart(task.id);
            }}
          >
            <RotateCw size={10} />
          </button>
        </span>
      </div>
    );
  };

  const menuItems =
    menu?.kind === 'task'
      ? taskMenu(tasks.find((t) => t.id === menu.id) ?? ({ id: menu.id } as TaskDef))
      : menu?.kind === 'folder'
        ? folderMenu(menu.id)
        : menu?.kind === 'blank'
          ? blankMenu
          : [];

  const ghostHint = (() => {
    if (dragOver === 'root') return '移到根目录';
    if (dragOver?.kind === 'folder') return `移入「${folders.find((f) => f.id === dragOver.id)?.name ?? ''}」`;
    if (dragOver?.kind === 'task') {
      const parentId = tasks.find((t) => t.id === dragOver.id)?.folderId;
      return `移入「${folders.find((f) => f.id === parentId)?.name ?? ''}」`;
    }
    return '';
  })();

  const activeMenu =
    menu?.kind === 'task'
      ? tasks.find((t) => t.id === menu.id)
      : menu?.kind === 'folder'
        ? folders.find((f) => f.id === menu.id)
        : null;

  const menuDisabled = (i: number) => {
    if (menu?.kind === 'task') {
      const t = tasks.find((x) => x.id === menu.id);
      if (!t) return true;
      const st = statuses[t.id]?.state;
      const item = menuItems[i];
      if (item.label === '启动') return st === 'running' || st === 'starting';
      if (item.label === '停止') return st !== 'running' && st !== 'starting';
      if (item.label === '重启') return !st || !RUNNABLE_STATES.includes(st);
      if (item.label === '') return true;
    }
    return false;
  };

  return (
    <div
      className="flex flex-col h-full bg-nav border-r border-border-default shrink-0"
      style={{ width: treeWidth }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ kind: 'blank', x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex items-center h-7 px-2 gap-1 border-b border-border-default shrink-0">
        <span className="flex-1 text-xs font-medium text-txt-secondary">任务树</span>
        <button
          className="flex items-center justify-center w-6 h-6 rounded-sm text-txt-muted hover:bg-nav-hover"
          title="刷新"
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} />
        </button>
        <button
          className="flex items-center gap-1 h-6 px-2 rounded-sm text-xs text-txt-muted hover:bg-nav-hover"
          title="新增文件夹"
          onClick={() => void createFolder('新建文件夹', null)}
        >
          <FolderPlus size={12} /> 文件夹
        </button>
        <button
          className="flex items-center gap-1 h-6 px-2 rounded-sm text-xs text-txt-muted hover:bg-nav-hover"
          title="新增任务"
          onClick={() => openForm({ task: null, defaultFolderId: null })}
        >
          <FilePlus size={12} /> 任务
        </button>
      </div>
      <div data-node-kind="tree" className="flex-1 overflow-y-auto min-h-0 py-0.5 select-none">
        {!ready && <div className="px-3 py-2 text-xs text-txt-subtle">加载中…</div>}
        {ready && tree.length === 0 && (
          <div className="px-3 py-2 text-xs text-txt-subtle">
            暂无任务，点击右上角「任务」新建
          </div>
        )}
        {tree.map((node) => renderNode(node, 0))}
      </div>
      <div className="shrink-0 h-6 px-2 flex items-center text-[10px] text-txt-subtle border-t border-border-default">
        双击任务打开输出窗口 · 拖拽任务/文件夹到其他文件夹或空白处
      </div>

      {ghost && <DragGhost x={ghost.x} y={ghost.y} label={ghost.label} hint={ghostHint} />}

      {menu && (menu.kind === 'blank' || activeMenu !== null) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menuItems.map((item, i) => ({ ...item, disabled: menuDisabled(i) }))}
        />
      )}
      {form && (
        <TaskFormModal
          key={form.task ? form.task.id : `new-${formSeq}`}
          task={form.task}
          defaultFolderId={form.defaultFolderId}
          onClose={() => setForm(null)}
          onSaved={(taskId) => setSelected(taskId)}
        />
      )}
      {rename && (
        <RenameModal
          current={rename.name}
          onClose={() => setRename(null)}
          onSave={async (name) => {
            await renameFolder(rename.id, name);
            setRename(null);
          }}
        />
      )}
    </div>
  );
}

function DragGhost({ x, y, label, hint }: { x: number; y: number; label: string; hint: string }) {
  return (
    <div
      className="fixed z-[60] pointer-events-none flex items-center gap-1.5 pl-1 pr-2 h-6 rounded-md text-xs bg-accent/10 border border-accent/50 text-txt-primary shadow-lg shadow-black/40"
      style={{ left: x + 10, top: y + 10, transform: 'translate(-50%, -100%)' }}
    >
      <GripVertical size={10} className="text-accent shrink-0" />
      <span className="font-medium whitespace-nowrap max-w-48 truncate">{label}</span>
      {hint && (
        <span className="whitespace-nowrap text-txt-subtle border-l border-accent/30 pl-1.5">{hint}</span>
      )}
    </div>
  );
}

function RenameModal({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(current);
  const save = async () => {
    if (!name.trim()) return;
    await onSave(name.trim());
  };
  return (
    <Modal title="重命名文件夹" onClose={onClose} width={320}>
      <div className="flex flex-col gap-3 p-3">
        <input
          className="w-full h-7 px-2 rounded-sm bg-input-bg text-txt-primary border border-transparent focus:border-accent"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            className="h-7 px-3 rounded-sm text-xs border border-border-default hover:bg-nav-hover"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="h-7 px-3 rounded-sm text-xs bg-accent text-white hover:opacity-90"
            onClick={() => void save()}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
