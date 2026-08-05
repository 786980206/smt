import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  PortsEvent,
  ProcessState,
  ProcessStatus,
  StatusEvent,
  TaskDef,
  TaskInput,
  TaskTreePayload,
  TreeNode,
} from '@/types';

interface TaskState {
  ready: boolean;
  folders: TaskTreePayload['folders'];
  tasks: TaskDef[];
  statuses: Record<string, ProcessStatus>;
  /** taskId → 监听端口可访问 URL */
  ports: Record<string, string[]>;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  applyStatus: (taskId: string, status: ProcessStatus) => void;
  applyPorts: (ports: Record<string, string[]>) => void;
  openBrowser: (url: string) => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createTask: (input: TaskInput) => Promise<string | null>;
  updateTask: (id: string, input: TaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  moveTask: (id: string, folderId: string | null) => Promise<void>;
  start: (taskId: string) => Promise<ProcessStatus | null>;
  stop: (taskId: string) => Promise<ProcessStatus | null>;
  restart: (taskId: string) => Promise<ProcessStatus | null>;
}

let statusListener: Promise<() => void> | null = null;
let portListener: Promise<() => void> | null = null;

export const useTaskStore = create<TaskState>((set, get) => ({
  ready: false,
  folders: [],
  tasks: [],
  statuses: {},
  ports: {},

  load: async () => {
    const payload = await invoke<TaskTreePayload>('list_tasks');
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses, ready: true });
    if (!statusListener) {
      statusListener = listen<StatusEvent>('process-status', (e) => {
        get().applyStatus(e.payload.taskId, e.payload.status);
      });
    }
    if (!portListener) {
      portListener = listen<PortsEvent>('process-ports', (e) => {
        get().applyPorts(e.payload.ports);
      });
    }
  },

  refresh: async () => {
    const payload = await invoke<TaskTreePayload>('list_tasks');
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses });
  },

  applyStatus: (taskId, status) =>
    set((s) => ({
      statuses: { ...s.statuses, [taskId]: status },
    })),

  applyPorts: (ports) => set({ ports }),

  openBrowser: async (url) => {
    try {
      await invoke('open_in_browser', { url });
    } catch {
      /* ignore */
    }
  },

  createFolder: async (name, parentId) => {
    await invoke<TaskTreePayload>('create_folder', { name, parentId });
    await get().refresh();
  },

  renameFolder: async (id, name) => {
    await invoke<TaskTreePayload>('rename_folder', { id, name });
    await get().refresh();
  },

  deleteFolder: async (id) => {
    await invoke<TaskTreePayload>('delete_folder', { id });
    await get().refresh();
  },

  createTask: async (input) => {
    const payload = await invoke<TaskTreePayload>('create_task', { input });
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses });
    return payload.tasks.find((t) => t.folderId === input.folderId && t.name === input.name)?.id ?? null;
  },

  updateTask: async (id, input) => {
    const payload = await invoke<TaskTreePayload>('update_task', { id, input });
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses });
  },

  deleteTask: async (id) => {
    const payload = await invoke<TaskTreePayload>('delete_task', { id });
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses });
  },

  moveTask: async (id, folderId) => {
    const payload = await invoke<TaskTreePayload>('move_task', { id, folderId });
    set({ folders: payload.folders, tasks: payload.tasks, statuses: payload.statuses });
  },

  start: async (taskId) => {
    try {
      const status = await invoke<ProcessStatus>('start_process', { taskId });
      get().applyStatus(taskId, status);
      return status;
    } catch {
      return null;
    }
  },

  stop: async (taskId) => {
    try {
      const status = await invoke<ProcessStatus>('stop_process', { taskId });
      get().applyStatus(taskId, status);
      return status;
    } catch {
      return null;
    }
  },

  restart: async (taskId) => {
    try {
      const status = await invoke<ProcessStatus>('restart_process', { taskId });
      get().applyStatus(taskId, status);
      return status;
    } catch {
      return null;
    }
  },
}));

/** 把 folders/tasks 构建成树。 */
export function buildTree(folders: TaskTreePayload['folders'], tasks: TaskDef[]): TreeNode[] {
  const folderNodes = new Map<string, TreeNode>();
  for (const f of folders) {
    folderNodes.set(f.id, { kind: 'folder', data: f, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of folderNodes.values()) {
    if (node.kind !== 'folder') continue;
    const parentId = node.data.parentId;
    if (parentId && folderNodes.has(parentId)) {
      const parent = folderNodes.get(parentId)!;
      if (parent.kind === 'folder') parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const taskNodes: TreeNode[] = tasks.map((t) => ({ kind: 'task', data: t }));
  for (const node of taskNodes) {
    if (node.kind !== 'task') continue;
    const fid = node.data.folderId;
    if (fid && folderNodes.has(fid)) {
      const parent = folderNodes.get(fid)!;
      if (parent.kind === 'folder') parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.data.name.localeCompare(b.data.name, 'zh-CN');
    });
    for (const n of nodes) if (n.kind === 'folder') sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

export const STATE_LABEL: Record<ProcessState, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  restarting: '重启中',
  exited: '已退出',
  error: '异常',
};
