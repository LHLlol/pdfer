# 纸落 — PDF 工具

一个安静、轻量的浏览器端 PDF 工具，支持本地合并和压缩 PDF 文件。文件只在当前设备中读取和处理，无需账号，也不会上传到服务器。

## 功能

- **合并 PDF**
  - 一次选择多个 PDF 文件
  - 拖拽或点击添加文件
  - 拖动调整文件顺序
  - 显示文件页数和大小
  - 输出 `merged.pdf`
- **压缩 PDF**
  - 一次处理一个 PDF 文件
  - 设置目标大小，支持 KB / MB
  - 提供轻度、中度、强力三档快捷目标
  - 显示压缩前后体积和减少比例
  - 输出 `<原文件名>-compressed.pdf`
- 拖拽上传、键盘操作和基础错误提示
- 单文件最大支持 `100 MB`

## 技术栈

- React 18
- TypeScript
- Vite
- `pdf-lib`：PDF 读取、页面复制与保存
- `@dnd-kit`：文件列表拖拽排序
- Framer Motion：界面过渡动画
- Lucide React：图标

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

启动后打开终端提示的本地地址，通常是 `http://localhost:5173`。

### 构建生产版本

```bash
npm run build
```

构建产物会输出到 `dist/` 目录。

### 预览生产版本

```bash
npm run preview
```

## 使用说明

### 合并 PDF

1. 保持在“合并 PDF”模式。
2. 拖入或选择至少两个 PDF 文件。
3. 在文件列表中拖动调整顺序。
4. 点击“合并 PDF”。
5. 处理完成后点击“下载 PDF”。

### 压缩 PDF

1. 切换到“压缩 PDF”模式。
2. 选择一个 PDF 文件。
3. 输入目标大小，或选择一个快捷目标。
4. 点击“压缩 PDF”。
5. 处理完成后点击“下载 PDF”。

## 项目结构

```text
.
├── index.html          # HTML 入口
├── src/
│   ├── App.tsx         # 页面、交互与 PDF 处理逻辑
│   ├── main.tsx        # React 挂载入口
│   └── styles.css      # 页面样式与响应式布局
├── package.json        # 脚本与依赖
├── tsconfig*.json      # TypeScript 配置
└── vite.config.ts      # Vite 配置
```

## 处理边界

- 暂不支持有密码保护的 PDF。
- 合并会保留页面顺序，并复制各源 PDF 的页面内容。
- 压缩主要通过重新保存和优化 PDF 结构实现；对于已经高度优化或主要由图片构成的 PDF，输出文件不一定能达到目标大小。
- 所有处理均在浏览器中完成，刷新页面后当前任务不会保留。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并构建生产版本 |
| `npm run preview` | 预览生产构建 |
