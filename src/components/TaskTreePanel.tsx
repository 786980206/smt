import { useMemo, useState } from 'react';
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

export function TaskTreePanel() {
  const folders = useTaskStore((s) => s.folders);
  const tasks = useTaskStore((s) => s.tasks);
  const statuses = useTaskStore((s) => s.statuses);
  const ports = useTaskStore((s) => s.ports);
  const openBrowser = useTaskStore((s) => s.openBrowser);
  const ready = useTaskStore((s) => s.ready);
  const start = useTaskStore((s) => s.start);
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
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

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
    });
    if (id) setSelected(id);
  };

  const folderMenu = (folderId: string): ContextMenuItem[] => [
    { label: '新增子文件夹', action: () => void createFolder('新建文件夹', folderId) },
    { label: '新增任务', action: () => openForm({ task: null, defaultFolderId: folderId }) },
    { label: '重命名', action: () => setRename({ kind: 'folder', id: folderId, name: folders.find((f) => f.id === folderId)?.name ?? '' }) },
    { label: '删除', action: () => void deleteFolder(folderId), danger: true },
  ];

  const blankMenu: ContextMenuItem[] = [
    { label: '新增文件夹', action: () => void createFolder('新建文件夹', null) },
    { label: '新增任务', action: () => openForm({ task: null, defaultFolderId: null }) },
  ];

  const onDropOnFolder = async (folderId: string | null) => {
    setDragOverFolder(null);
    if (!dragging) return;
    if (dragging.kind === 'task') {
      await useTaskStore.getState().moveTask(dragging.id, folderId);
    }
    setDragging(null);
  };

  /** 任务行也是落点：落到任务上 = 移到该任务所在文件夹 */
  const onDropOnTask = async (task: TaskDef) => {
    setDragOverFolder(null);
    if (!dragging || dragging.kind !== 'task' || dragging.id === task.id) return;
    await useTaskStore.getState().moveTask(dragging.id, task.folderId);
    setDragging(null);
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      const f = node.data;
      const isCollapsed = !!collapsed[f.id];
      const hasChildren = node.children.length > 0;
      const [total, running] = folderStats(node, Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, v.state])));
      return (
        <div key={f.id}>
          <div
            className={`flex items-center h-6 pr-2 cursor-pointer group hover:bg-nav-hover ${selected === f.id ? 'bg-nav-active' : ''} ${dragOverFolder === f.id ? 'bg-accent/20' : ''}`}
            style={{ paddingLeft: depth * 12 + 4 }}
            title={f.name}
            onClick={() => {
              setSelected(f.id);
              if (hasChildren) toggleCollapsed(f.id);
            }}
            onContextMenu={(e) => onFolderContextMenu(e, f.id)}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverFolder !== f.id) setDragOverFolder(f.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onDropOnFolder(f.id);
            }}
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
            <span className="hidden group-hover:flex items-center gap-1 shrink-0">
              <span title="新增子文件夹" className="flex items-center">
                <FolderPlus
                  size={12}
                  className="text-txt-muted hover:text-txt-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    void createFolder('新建文件夹', f.id);
                  }}
                />
              </span>
              <span title="在此文件夹新增任务" className="flex items-center">
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
    return (
      <div
        key={task.id}
        className={`flex items-center h-6 pr-2 cursor-pointer group hover:bg-nav-hover ${selected === task.id ? 'bg-nav-active' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        title={`${task.name} — ${task.command}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragging({ id: task.id, kind: 'task' });
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onDropOnTask(task);
        }}
        onDoubleClick={() => openConsole(task)}
        onClick={() => setSelected(task.id)}
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
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
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
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        void onDropOnFolder(null);
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
      <div className="flex-1 overflow-y-auto min-h-0 py-0.5">
        {!ready && <div className="px-3 py-2 text-xs text-txt-subtle">加载中…</div>}
        {ready && tree.length === 0 && (
          <div className="px-3 py-2 text-xs text-txt-subtle">
            暂无任务，点击右上角「任务」新建
          </div>
        )}
        {tree.map((node) => renderNode(node, 0))}
      </div>
      <div className="shrink-0 h-6 px-2 flex items-center text-[10px] text-txt-subtle border-t border-border-default">
        双击任务打开输出窗口 · 拖拽任务到文件夹或空白处
      </div>

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
