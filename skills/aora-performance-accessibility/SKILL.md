---
name: aora-performance-accessibility
description: Review AORA UI changes for runtime/bundle performance, network efficiency, mobile responsiveness, semantic accessibility, keyboard/focus behavior and reduced-motion/readability concerns. Use for significant UI work, slow screens, mobile regressions or accessibility QA.
---

# AORA Performance and Accessibility

## Performance review
Check:
- new dependency and asset cost
- duplicate or sequential network requests that can be avoided
- unbounded list/table rendering
- excessive DOM churn after realtime updates
- repeated subscriptions/listeners and cleanup
- service-worker/cache growth
- large images/files and blocking resources
- slow operations on interaction-critical paths

Do not add a dependency for a small behavior already supported by the browser/project unless it materially reduces complexity and its cost is justified.

## Accessibility review
Check:
- semantic controls instead of clickable generic containers
- accessible names/labels
- keyboard operation and visible focus
- logical focus restoration after dialogs/overlays
- form errors associated with fields
- status/error announcements where needed
- touch target usability on mobile
- contrast/readability using existing design tokens
- reduced-motion compatibility for non-essential animation
- no horizontal overflow at supported narrow widths

Accessibility checks complement, not replace, real keyboard/browser verification.
