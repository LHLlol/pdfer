# Design QA — 标题字体优化

- Source visual truth: `/Users/linhongle/Desktop/截屏2026-08-20 12.11.05.png`
- Implementation screenshot: `/Users/linhongle/Documents/pdfer/title-preview.png`
- Combined comparison: `/Users/linhongle/Documents/pdfer/title-qa-comparison.png`
- Responsive evidence: `/Users/linhongle/Documents/pdfer/title-preview-mobile.png`
- Viewport: 830 × 333 desktop comparison; 390 × 844 responsive check.
- State: 默认“合并 PDF”空状态，标题区域可见。

## Source and instruction distinction

The attached image contains no executable or textual product instructions. It is used only as a visual reference for the title treatment: thin geometric strokes, outlined forms, and square control nodes. The user's request remains authoritative for the copy and for preserving the existing color contrast.

## Full-view comparison evidence

The combined comparison places the supplied reference on the left and the browser-rendered implementation on the right at the same 830 × 333 canvas size. The implementation keeps the existing page composition and applies the reference's outline/technical drawing language to the title without changing the surrounding product UI.

## Focused region comparison evidence

The focused region is the `h1.hero-title` band. `处理工作，` uses the existing ink token and `从这里开始` uses the existing blue token, both as 1px-scale outlined glyphs with small square nodes anchored to each phrase. The title remains semantic text and falls back to solid text when text stroke is unsupported.

## Findings

No actionable P0/P1/P2 differences found.

- P3: The reference uses a custom single-line glyph construction, while the implementation uses the platform's Chinese glyphs with an outline treatment. This keeps the real title copy responsive and accessible; exact skeleton-level matching would require a dedicated font asset that was not supplied.

## Comparison history

- Initial implementation: changed the heavy filled title into outlined black/blue glyphs, added geometric square nodes, and kept the existing ink/blue tokens.
- Post-fix evidence: repositioned the nodes from their initial static position to the upper-right of each phrase. Desktop and mobile screenshots show no clipping or horizontal overflow.

## Verification

- `npm run build` passed.
- Desktop browser evidence captured at 830 × 333.
- Mobile browser evidence captured at 390 × 844; title wraps to two lines without horizontal overflow.
- Computed stroke colors: `#111111` and `#146ef5`; computed stroke widths: `1.05px` and `1.15px`.
- Browser console warnings/errors: none observed.

## Implementation Checklist

- [x] Preserve existing black/blue contrast.
- [x] Use a geometric outlined title treatment inspired by the supplied reference.
- [x] Keep the title as accessible, responsive text.
- [x] Verify desktop and mobile rendering.
- [x] Confirm no console warnings or errors during the visual check.

final result: passed
