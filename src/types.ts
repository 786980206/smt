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
  /** 每次启动把输出保存到 <数据目录>/logs/ 下带时间戳的日志文件 */
  saveLog: boolean;
}

export interface TaskInput {
  name: string;
  folderId: string | null;
  command: string;
  workdir: string | null;
  env: Record<string, string>;
  autoStart: boolean;
  autoAttach: boolean;
  saveLog: boolean;
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
  /** 当前运行期的日志文件全文（未开启日志保存则为空串） */
  text: string;
  /** 日志文件路径（未开启日志保存则为 null） */
  logPath: string | null;
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

/** process-ports：taskId → 可访问 URL 列表（如 http://127.0.0.1:8000） */
export interface PortsEvent {
  ports: Record<string, string[]>;
}

export type TreeNode =
  | { kind: 'folder'; data: FolderDef; children: TreeNode[] }
  | { kind: 'task'; data: TaskDef };
