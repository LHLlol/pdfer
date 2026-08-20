纸落 · ZhiLuo

纸落（ZhiLuo）是一个轻量的浏览器端文件工具，支持 PDF 合并、PDF 压缩，以及 Word、PDF 和图片之间的格式转换。

所有文件均在当前设备的浏览器中读取和处理，无需注册账号，也不会上传到服务器。

## 功能

### 合并 PDF

- 一次选择多个 PDF 文件
- 支持拖拽添加和拖动排序
- 显示文件大小与页数
- 保持文件列表顺序并输出合并后的 PDF

### 压缩 PDF

- 一次处理一个 PDF
- 支持设置 KB / MB 目标大小
- 提供轻度、中度、强力三档快捷目标
- 显示压缩前后大小与体积变化

### 格式转换

- Word（`.docx`）转 PDF 或逐页 PNG
- PDF 转逐页 PNG
- PNG、JPG、WebP 等图片转 PDF 或 PNG
- 多页图片自动打包为 ZIP

### 公章抠图

- 支持 PDF、PNG、JPG 和 WebP
- PDF 会逐页寻找最可能的红色公章位置，并自动选中命中页面
- 以更高分辨率放大定位区域，输出透明 PNG
- 支持在结果上继续擦除、恢复和撤销调整

## 隐私与处理边界

- 文件处理全部在浏览器端完成，不上传服务器
- 单个文件最大支持 `500 MB`
- 暂不支持有密码保护的 PDF
- 暂不支持旧版二进制 `.doc` 文件，请先另存为 `.docx`
- 复杂 Word 特性（宏、批注、嵌入对象和部分高级版式）可能与桌面 Word 存在差异
- PDF 压缩效果取决于原文件结构和图片内容，不保证所有文件都能达到目标大小
- 公章识别以红色印章为目标；同一页面存在大量红色文字或图形时，建议使用结果中的擦除 / 恢复工具微调
- 刷新页面后，当前任务和文件列表不会保留

## 品牌图标

网站使用黑色圆润几何风格的 ZhiLuo 字标，背景为暖米白色。

图标资源位于 `public/zhiluo-icons/`：

- `favicon.svg` / `favicon.ico`：浏览器图标
- `icon-16.png`、`icon-32.png`、`icon-48.png`：常规 favicon 尺寸
- `apple-touch-icon.png`：Apple Touch Icon
- `icon-192.png`、`icon-512.png`：PWA 图标
- `icon-512-maskable.png`：支持安全区域裁切的 PWA 图标
- `zhiluo-mark-ai-v1.png`：方形 Z 图标
- `zhiluo-wordmark-ai-v1-cropped.png`：横向 ZhiLuo 字标

页面顶部品牌标记和 `index.html` 中的 favicon、Apple Touch Icon、PWA manifest 已统一使用这套图标。

## 技术栈

- React 18 + TypeScript
- Vite
- `pdf-lib`：PDF 读取、合并与保存
- `pdfjs-dist`：PDF 页面渲染
- `mammoth`：`.docx` 内容读取
- `html2canvas`：Word 页面图片渲染
- `jspdf`：生成 PDF
- `jszip`：打包多页图片
- `@dnd-kit`：文件列表拖拽排序
- Framer Motion：界面动效
- Lucide React：功能操作图标

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

启动后访问终端输出的本地地址，通常为 `http://localhost:5173`。

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 预览生产版本

```bash
npm run preview
```

## 项目结构

```text
.
├── index.html
├── src/
│   ├── App.tsx          # 页面结构、交互和文件处理逻辑
│   ├── main.tsx         # React 挂载入口
│   └── styles.css       # 页面样式和响应式布局
├── public/
│   └── zhiluo-icons/    # favicon、PWA 和品牌图标资源
├── package.json
├── package-lock.json
├── tsconfig*.json
└── vite.config.ts
```

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并构建生产版本 |
| `npm run preview` | 预览生产构建 |
