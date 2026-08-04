// 前后端契约类型（与 Rust serde rename_all="camelCase" 对齐）

export type ProcessState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'restarting'
  | 'exited'
  | 'error';

export interface FolderDef {
  id: string;
  name: string;
  parentId: string | null;
}

export interface TaskDef {
  id: string;
  name: string;
  folderId: string | null;
  command: string;
  workdir: string | null;
  env: Record<string, string>;
  autoStart: boolean;
  autoAttach: boolean;
}

export interface TaskInput {
  name: string;
  folderId: string | null;
  command: string;
  workdir: string | null;
  env: Record<string, string>;
  autoStart: boolean;
  autoAttach: boolean;
}

export interface ProcessStatus {
  state: ProcessState;
  pid: number | null;
  exitCode: number | null;
  startedAt: number | null;
  error: string | null;
}

export interface ConsoleLine {
  at: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface AttachResult {
  taskId: string;
  taskName: string;
  status: ProcessStatus;
  lines: ConsoleLine[];
  truncated: boolean;
}

export interface TaskTreePayload {
  folders: FolderDef[];
  tasks: TaskDef[];
  statuses: Record<string, ProcessStatus>;
}

export interface OutputEvent {
  taskId: string;
  lines: ConsoleLine[];
}

export interface StatusEvent {
  taskId: string;
  status: ProcessStatus;
}

export type TreeNode =
  | { kind: 'folder'; data: FolderDef; children: TreeNode[] }
  | { kind: 'task'; data: TaskDef };
