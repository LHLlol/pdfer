# Design QA

- Source visual truth: `/Users/linhongle/Desktop/截屏2026-08-19 23.18.28.png`
- Implementation screenshot: `/Users/linhongle/Documents/pdfer/qa-progress-state.png`
- Viewport: 1280 × 1072 full-page browser capture; source reference is 830 × 333.
- State: Compress PDF flow, active loading state at approximately 58–67%.

## Full-view comparison evidence

The reference uses a prominent percentage, a 20-segment rounded track, high-contrast completed segments, and a low-contrast unfinished track. The implementation preserves those relationships inside the existing Paperdrop workspace and maps the reference terracotta accent to the product's existing blue token (`--blue`).

## Focused region comparison evidence

The progress panel is fully visible and legible in the implementation screenshot, so a separate crop was not required. The percentage, stage label, segment count, rounded corners, blue token, and local-processing note can all be inspected at the full capture scale.

## Findings

No actionable P0/P1/P2 differences found.

- P3: The reference includes a draggable secondary slider below the segmented track. It was intentionally not copied because this is a real loading indicator, not a user-adjustable value control; adding drag behavior would conflict with the product's processing semantics.

## Comparison history

- Initial implementation: replaced the former 4px continuous bar with a 20-segment blue track, made the percentage the primary value, added a subtle active-segment pulse, and added progressbar ARIA attributes.
- Post-fix evidence: `/Users/linhongle/Documents/pdfer/qa-progress-state.png` shows the active loading state with the updated segmented track. No P0/P1/P2 fixes remained.

## Verification

- `npm run build` passed.
- Tested mode switch to “压缩 PDF”.
- Tested local synthetic PDF upload and processing start.
- Confirmed one `progressbar` with `aria-valuemin="0"`, `aria-valuemax="100"`, and a live `aria-valuenow` value.
- Checked browser console warnings/errors: none reported.

## Implementation Checklist

- [x] Keep the existing blue palette as the primary progress color.
- [x] Use rounded segmented progress states inspired by the reference.
- [x] Preserve real progress behavior and avoid misleading drag interaction.
- [x] Add reduced-motion handling for the active segment.
- [x] Preserve responsive layout and accessibility semantics.

final result: passed
