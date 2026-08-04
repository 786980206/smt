import { useState } from 'react';
import { Layout, Model, Actions, DockLocation, type IJsonModel, type TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { ConsoleTab } from '@/components/ConsoleTab';
import { useTaskStore, STATE_LABEL } from '@/stores/taskStore';

const WORKSPACE_KEY = 'smt-workspace-v2';

// 模块级 model 持有者：任务树面板（TaskTreePanel）双击开窗时复用
export const workspaceModel: { current: Model | null } = { current: null };

function buildDefaultModel(): IJsonModel {
  return {
    global: {
      tabEnableClose: true,
      tabEnableRename: false,
      tabEnableDrag: true,
      tabSetEnableDrop: true,
      splitterSize: 1,
    },
    borders: [],
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          id: 'main',
          weight: 100,
          children: [
            {
              type: 'tab',
              id: 'welcome',
              name: '欢迎',
              component: 'welcome',
            },
          ],
        },
      ],
    },
  };
}

function loadModel(): Model {
  try {
    const saved = localStorage.getItem(WORKSPACE_KEY);
    if (saved) return Model.fromJson(JSON.parse(saved));
  } catch {
    /* corrupted → default */
  }
  // 注意：flexlayout 的 fromJson 会原地修改传入对象（生成随机 id 等），
  // 且 StrictMode 下可能调用两次 —— 必须每次传入全新对象
  return Model.fromJson(buildDefaultModel());
}

/** 打开（或激活）某个任务的控制台标签；窗口已存在则仅选中。 */
export function openConsoleTab(taskId: string, name: string) {
  const model = workspaceModel.current;
  if (!model) return;
  const tabId = `console-${taskId}`;
  const existing = model.getNodeById(tabId);
  if (existing) {
    model.doAction(Actions.selectTab(tabId));
    return;
  }
  const tabset = model.getFirstTabSet();
  model.doAction(
    Actions.addNode(
      {
        type: 'tab',
        id: tabId,
        name,
        component: `console:${taskId}`,
      },
      tabset ? tabset.getId() : '',
      DockLocation.CENTER,
      -1,
    ),
  );
}

export function tabTitle(node: TabNode): string {
  const component = node.getComponent() ?? '';
  if (component.startsWith('console:')) {
    const taskId = component.slice('console:'.length);
    const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
    return task ? task.name : node.getName();
  }
  return node.getName();
}

export function tabDot(node: TabNode): string | null {
  const component = node.getComponent() ?? '';
  if (!component.startsWith('console:')) return null;
  const taskId = component.slice('console:'.length);
  const status = useTaskStore.getState().statuses[taskId];
  if (!status) return null;
  return STATE_LABEL[status.state];
}

export function Workspace() {
  const [model] = useState<Model>(() => {
    const m = loadModel();
    workspaceModel.current = m;
    return m;
  });

  return (
    <Layout
      model={model}
      factory={(node) => {
        const component = node.getComponent() ?? '';
        if (component.startsWith('console:')) {
          const taskId = component.slice('console:'.length);
          return <ConsoleTab taskId={taskId} />;
        }
        return (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-txt-subtle">
            <span className="text-sm">SMT Task Manager</span>
            <span className="text-xs">在左侧任务树中管理你的后台服务</span>
            <span className="text-xs">双击任务节点打开附加的输出窗口</span>
          </div>
        );
      }}
      onModelChange={() => {
        try {
          localStorage.setItem(WORKSPACE_KEY, JSON.stringify(model.toJson()));
        } catch {
          /* storage full → ignore */
        }
      }}
    />
  );
}
