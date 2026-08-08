# SMT Task Manager

轻量进程（服务）管理器桌面应用：把后台服务的启停从命令行里解放出来，用一棵任务树 + 多标签日志窗口管理所有进程。

- 技术栈：**Rust + Tauri 2**（后端）+ **React + TypeScript + Vite**（前端）
- 体积：独立运行 exe 仅约 **3.5 MB**（前端资源整体内嵌）
- 平台：Windows（WebView2）

## 功能

- **左侧任务树**：文件夹 + 任务节点两级结构，支持新建 / 重命名 / 删除 / 拖拽排序
- **任务 = 一个后台服务**：填写启动命令（如 `python -m http.server 8000`、`xxx.bat` 脚本），支持 **启动 / 停止 / 重启**，运行态实时反馈（运行中 / 已停止 / 异常）
- **挂接 CMD 黑窗**：双击任务节点在独立窗口中打开该进程的实时输出；关闭黑窗不影响后台进程，再点节点可重新挂回
- **右侧多标签**：每个任务一个标签（xterm.js 终端），日志实时滚动，可自由关闭/重开
- **系统托盘常驻**：关闭窗口最小化到托盘；托盘菜单可「显示主窗口 / 退出」，退出时自动停掉全部后台进程
- **便携配置**：任务树与设置统一存 `smt.yaml`，与 exe 同目录可写即走便携模式，否则落应用数据目录；旧版 `tasks.json` 自动迁移
- **内置示例**：自带一个 `python -m http.server 8000` 示例任务，开箱体验启停/重启

## 目录结构

```
├── src/                      # 前端（React + TS + Vite + Tailwind）
│   ├── components/           #   界面组件（TaskTreePanel / ConsoleTab / SettingsModal …）
│   ├── stores/uiStore.ts     #   zustand 状态（持久化到 localStorage）
│   └── styles/globals.css    #   主题与组件样式（参考 stkoe_portal 风格）
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs            #   Tauri 入口、命令注册、托盘/关闭行为
│   │   ├── store.rs          #   smt.yaml 读写 / 设置 / 旧数据迁移
│   │   ├── config.rs         #   便携目录解析
│   │   └── core/             #   进程管理核心库（树结构 / 进程 / PTY / 环形缓冲）
│   ├── tauri.conf.json       #   应用与打包配置
│   └── Cargo.toml
├── .github/workflows/release.yaml   # 打 tag 自动构建并发布
└── AGENTS.md
```

## 本地构建（Windows）

前置：Node.js 20+、Rust stable（MSVC toolchain）、WebView2 运行时（Win11 自带）。

```bash
# 1. 安装前端依赖
npm install

# 2. 构建前端产物（dist/）
npm run build          # = tsc -b && vite build

# 3. 编译 Rust（release 已做极限体积优化：LTO=fat / opt-level=z / panic=abort）
cargo build --release --manifest-path src-tauri/Cargo.toml

# 产物：src-tauri/target/release/smt-task-manager.exe（可直接双击运行）
```

> 注意：
> - `Cargo.toml` 默认启用 `custom-protocol` feature，因此**普通 `cargo build --release` 即内嵌前端资源、可独立运行**；若注释掉该默认特性，产物会试图加载 devUrl，前端渲染空白。
> - 修改前端后必须重新执行 `npm run build` 再编译 Rust，否则 exe 内是旧资源。

一键打包（NSIS 安装包 + MSI）：

```bash
npm run tauri:build -- --bundles nsis
# 产物：src-tauri/target/release/bundle/nsis/*-setup.exe
```

开发调试：

```bash
npm run tauri:dev
# 注意：因为 custom-protocol 默认启用，dev 模式同样加载内嵌资源（不热更），
# 改前端代码需重新 `npm run build` 后重启。
```

## 运行与配置

- 首次启动自动生成 `smt.yaml`（与 exe 同目录；若不可写则放到 `%AppData%` 对应目录）
- 任务定义字段：`name` / `command`（经 `cmd /C` 执行）/ `workdir` / `env`
- 设置项：`closeToTray`（关闭窗口是否最小化到托盘，默认开启）

## 发布流程

推送 `v*` 格式的 tag 即触发 GitHub Actions（`.github/workflows/release.yaml`）：

```bash
git tag v1.0.0-pre
git push origin v1.0.0-pre
```

CI 自动完成：前端构建 → Rust 测试 → 打包 NSIS 安装包 + 便携 exe → 创建 GitHub Release 并上传产物。含 `pre` 的 tag 自动标记为 Prerelease。

## 常见问题

| 现象 | 说明 |
| --- | --- |
| 任务栏托盘右键没有菜单 | 旧版本 bug 已修复；若托盘里是残留幽灵图标（非本次运行），结束残留进程后即消失 |
| exe 打开一片空白 | 确认用最新的构建产物（v0.6.1+，custom-protocol 默认开启） |
| 中文输出乱码 | 终端按进程输出编码自动识别（GBK/UTF-8） |