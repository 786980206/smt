import { useState } from 'react';
import type { TaskDef, TaskInput } from '@/types';
import { useTaskStore } from '@/stores/taskStore';
import { Modal } from '@/components/Modal';

interface Props {
  /** null = 新建 */
  task: TaskDef | null;
  /** 新建时预填的文件夹 */
  defaultFolderId: string | null;
  onClose: () => void;
  onSaved: (taskId: string) => void;
}

/**
 * 注意：父组件应以 key 重建本组件实例（task id 或自增序号），
 * 保证初始 state 与打开场景一致。
 */
export function TaskFormModal({ task, defaultFolderId, onClose, onSaved }: Props) {
  const folders = useTaskStore((s) => s.folders);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [name, setName] = useState(task?.name ?? '');
  const [folderId, setFolderId] = useState<string>(task?.folderId ?? defaultFolderId ?? '');
  const [command, setCommand] = useState(task?.command ?? '');
  const [workdir, setWorkdir] = useState(task?.workdir ?? '');
  const [envText, setEnvText] = useState(
    Object.entries(task?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );
  const [autoStart, setAutoStart] = useState(task?.autoStart ?? false);
  const [autoAttach, setAutoAttach] = useState(task?.autoAttach ?? true);
  const [saveLog, setSaveLog] = useState(task?.saveLog ?? false);
  const [error, setError] = useState('');

  const parseEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
  };

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('请输入任务名称');
    if (!command.trim()) return setError('请输入启动命令');
    const input: TaskInput = {
      name: name.trim(),
      folderId: folderId || null,
      command: command.trim(),
      workdir: workdir.trim() || null,
      env: parseEnv(),
      autoStart,
      autoAttach,
      saveLog,
    };
    try {
      let id = task?.id ?? null;
      if (task) {
        await updateTask(task.id, input);
        id = task.id;
      } else {
        id = await createTask(input);
      }
      if (id) onSaved(id);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  const inputCls =
    'w-full h-7 px-2 rounded-sm bg-input-bg text-txt-primary placeholder:text-txt-subtle border border-transparent focus:border-accent';

  return (
    <Modal title={task ? `编辑任务 · ${task.name}` : '新增任务'} onClose={onClose} width={480}>
      <div className="flex flex-col gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs text-txt-muted">
          任务名称
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-xs text-txt-muted">
          所属文件夹
          <select className={inputCls} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">（根目录）</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-txt-muted">
          启动命令
          <textarea
            className={`${inputCls} h-16 py-1 resize-y font-mono`}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="如: python -m http.server 8000"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-txt-muted">
          工作目录
          <input
            className={inputCls}
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="留空使用应用默认目录"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-txt-muted">
          环境变量（每行 KEY=VALUE）
          <textarea
            className={`${inputCls} h-16 py-1 resize-y font-mono`}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs text-txt-secondary">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            应用启动时自动拉起
          </label>
          <label className="flex items-center gap-2 text-xs text-txt-secondary">
            <input type="checkbox" checked={autoAttach} onChange={(e) => setAutoAttach(e.target.checked)} />
            启动后自动打开输出窗口
          </label>
          <label className="flex items-center gap-2 text-xs text-txt-secondary">
            <input type="checkbox" checked={saveLog} onChange={(e) => setSaveLog(e.target.checked)} />
            保存日志文件（每次启动生成带时间戳的 .log 文件）
          </label>
        </div>
        {error && <div className="text-xs text-financial-down">{error}</div>}
        <div className="flex justify-end gap-2 pt-1 border-t border-border-default">
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
