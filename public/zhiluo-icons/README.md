# ZhiLuo 网页图标包

这套图标参考用户提供的设计，保留米白、红、橙、蓝四种主色和几何徽章构成，并针对 favicon 的小尺寸识别做了简化。

## 文件说明

- `favicon.svg`：浏览器优先使用的矢量 favicon
- `icon-16.png` / `icon-32.png` / `icon-48.png`：常规浏览器图标
- `apple-touch-icon.png`：iOS / macOS 主屏图标
- `icon-192.png` / `icon-512.png`：PWA 图标
- `icon-512-maskable.png`：支持系统自适应裁切的 PWA 图标
- `favicon.ico`：兼容旧浏览器的多尺寸图标
- `zhiluo-mark.svg`：可编辑的正方形源图形
- `zhiluo-wordmark.svg`：带 ZhiLuo 字标的横向组合

## 使用

`index.html` 已接入 favicon、Apple Touch Icon 和 `site.webmanifest`。如果只需要复用品牌图形，可直接引用 `zhiluo-mark.svg`。
