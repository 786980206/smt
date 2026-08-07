import { useEffect, useRef } from 'react';
import monaco from '@/monaco';

interface Props {
  value: string;
  language: string;
  onChange: (value: string) => void;
  height?: number;
}

/** 基于 Monaco 的多行脚本编辑器（命令区）。语言：bat / powershell / shell */
export function ScriptEditor({ value, language, onChange, height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      padding: { top: 6, bottom: 6 },
      renderLineHighlight: 'gutter',
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    // WebView2 新弹出模态的首次点击经常被合成器吞掉（首击无效、二击才生效），
    // 因此不能依赖"点击去拿焦点"，必须在弹窗打开瞬间就同步聚焦：
    // 1) 同步 focus —— 打开即可输入，不需要任何点击；
    // 2) rAF 等 Monaco 首轮布局完成后再补一次 focus（StrictMode 双挂载时旧实例已 dispose，判空兜底）。
    editor.focus();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (editorRef.current !== editor) return;
      raf2 = requestAnimationFrame(() => {
        if (editorRef.current === editor) editor.focus();
      });
    });
    const subs: monaco.IDisposable[] = [editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))];
    // E2E/CDP 测试钩子：拿最新 editor 实例直接 setValue（走真实 onChange 管线）
    const w = window as unknown as { __monacoEditors?: monaco.editor.IStandaloneCodeEditor[] };
    w.__monacoEditors = w.__monacoEditors ?? [];
    w.__monacoEditors.push(editor);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      subs.forEach((s) => s.dispose());
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      // 捕获阶段兜底：即使 Monaco 内部或任何下层 handler 拦截/吞掉事件，
      // 也能在事件到达目标前强制聚焦（配合打开即聚焦，双保险）
      onMouseDownCapture={() => editorRef.current?.focus()}
      onPointerDownCapture={() => editorRef.current?.focus()}
      style={{ height }}
      className="rounded-sm overflow-hidden border border-border-default"
    />
  );
}
