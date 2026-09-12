/**
 * Keeping a list item visible without moving the page.
 *
 * `scrollIntoView` walks every scrollable ancestor, so bringing a move into view
 * inside its own little box also scrolls the window -- which yanks the board out
 * from under you every time you press an arrow key. Adjusting the container's
 * own scrollTop keeps the page exactly where you left it.
 */

export interface Span {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where the container should be scrolled to so `target` is visible inside it.
 *
 * Returns the current position unchanged when the target is already in view:
 * scrolling something that is already visible is movement for its own sake.
 */
export function nextScrollTop(scrollTop: number, container: Span, target: Span): number {
  if (target.top < container.top) return scrollTop - (container.top - target.top);
  if (target.bottom > container.bottom) return scrollTop + (target.bottom - container.bottom);
  return scrollTop;
}

/** Scroll `container` so `target` is visible, touching nothing else on the page. */
export function scrollWithin(container: HTMLElement, target: HTMLElement): void {
  const box = container.getBoundingClientRect();
  const item = target.getBoundingClientRect();
  container.scrollTop = nextScrollTop(
    container.scrollTop,
    { top: box.top, bottom: box.bottom },
    { top: item.top, bottom: item.bottom },
  );
}
