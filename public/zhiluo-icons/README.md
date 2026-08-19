# ZhiLuo 网页图标包

这套图标使用 ZhiLuo 黑色圆润几何字标，并针对 favicon、桌面安装图标和页面品牌标记分别做了尺寸适配。

## 文件说明

- `favicon.svg`：浏览器优先使用的矢量 favicon
- `icon-16.png` / `icon-32.png` / `icon-48.png`：常规浏览器图标
- `apple-touch-icon.png`：iOS / macOS 主屏图标
- `icon-192.png` / `icon-512.png`：PWA 图标
- `icon-512-maskable.png`：支持系统自适应裁切的 PWA 图标
- `favicon.ico`：兼容旧浏览器的多尺寸图标
- `zhiluo-mark.svg`：正方形 Z 字标
- `zhiluo-wordmark.svg`：ZhiLuo 横向字标
- `zhiluo-mark-ai-v1.png`：新字标提取的方形 Z 图标
- `zhiluo-wordmark-ai-v1-cropped.png`：新生成的横向 ZhiLuo 字标

## 使用

`index.html` 已接入 favicon、Apple Touch Icon 和 `site.webmanifest`。页面顶部品牌标记使用 `zhiluo-mark-ai-v1.png`，需要横向品牌字标时可引用 `zhiluo-wordmark-ai-v1-cropped.png`。
