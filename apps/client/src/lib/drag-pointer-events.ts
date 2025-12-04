/**
 * Utility for disabling pointer events on marked elements during drag operations.
 * Elements should be marked with `data-drag-disable-pointer` attribute.
 * Also targets canvas/iframe children since pointer-events doesn't propagate to children.
 */

const SELECTOR = "[data-drag-disable-pointer], [data-drag-disable-pointer] canvas, [data-drag-disable-pointer] iframe";

/**
 * Disable pointer events on all marked elements.
 * Call this when starting a drag operation.
 */
export function disableDragPointerEvents(): void {
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of elements) {
    if (el instanceof HTMLElement) {
      const current = el.style.pointerEvents;
      el.dataset.prevPointerEvents = current ? current : "__unset__";
      el.style.pointerEvents = "none";
    }
  }
}

/**
 * Restore pointer events on all marked elements.
 * Call this when ending a drag operation.
 */
export function restoreDragPointerEvents(): void {
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of elements) {
    if (el instanceof HTMLElement) {
      const prev = el.dataset.prevPointerEvents;
      if (prev !== undefined) {
        if (prev === "__unset__") el.style.removeProperty("pointer-events");
        else el.style.pointerEvents = prev;
        delete el.dataset.prevPointerEvents;
      } else {
        el.style.removeProperty("pointer-events");
      }
    }
  }
}
