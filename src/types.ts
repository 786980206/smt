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
  /** 终端类型：null/"cmd"=CMD，"powershell"，"pwsh"，"bash" */
  shell: string | null;
  /** Windows 下经 UAC 以管理员身份启动 */
  runAsAdmin: boolean;
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
  shell: string | null;
  runAsAdmin: boolean;
}

/** list_shells 返回的可选终端 */
export interface ShellOption {
  id: string;
  name: string;
  exe: string;
  args: string;
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
  /** 是否以换行收尾的完整行；false 表示未换行的部分行（提示符等），前端不应补换行 */
  eol: boolean;
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
