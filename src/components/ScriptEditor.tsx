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
    const subs: monaco.IDisposable[] = [editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))];
    // E2E/CDP 测试钩子：拿最新 editor 实例直接 setValue（走真实 onChange 管线）
    const w = window as unknown as { __monacoEditors?: monaco.editor.IStandaloneCodeEditor[] };
    w.__monacoEditors = w.__monacoEditors ?? [];
    w.__monacoEditors.push(editor);
    return () => {
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
      style={{ height }}
      className="rounded-sm overflow-hidden border border-border-default"
    />
  );
}
