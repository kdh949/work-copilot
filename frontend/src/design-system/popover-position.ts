export type AnchorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PanelSize = { width: number; height: number };

export type Viewport = { width: number; height: number };

export type PopoverPosition = {
  top: number;
  left: number;
  placement: "below" | "above";
};

/** Distance between the trigger and the panel, and from the viewport edge. */
const GAP = 8;
const EDGE_MARGIN = 8;

/**
 * Where to put a popover panel, in viewport coordinates (`position: fixed`).
 *
 * CSS anchor positioning would express this declaratively but is supported by
 * fewer browsers than the `popover` attribute itself, so the coordinates are
 * computed here instead and the browser is left to own dismissal and layering.
 *
 * Pure on purpose: the caller passes measured rects, so the flip and clamp
 * rules are testable without a DOM.
 */
export function popoverPosition(
  anchor: AnchorRect,
  panel: PanelSize,
  viewport: Viewport,
): PopoverPosition {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - panel.height - GAP;
  const overflowsBelow = below + panel.height > viewport.height - EDGE_MARGIN;
  // Only flip if flipping actually helps. On a short viewport both directions
  // overflow, and dropping the panel above the trigger would push it off the
  // top edge — worse than the overflow it was meant to fix.
  const placement =
    overflowsBelow && above >= EDGE_MARGIN ? "above" : ("below" as const);

  const maxLeft = viewport.width - panel.width - EDGE_MARGIN;
  const left = Math.max(EDGE_MARGIN, Math.min(anchor.left, maxLeft));

  return {
    top: placement === "above" ? above : below,
    // A panel wider than the viewport is clamped to the left edge rather than
    // to a negative `maxLeft`, so its start stays reachable.
    left: maxLeft < EDGE_MARGIN ? EDGE_MARGIN : left,
    placement,
  };
}

/**
 * Whether the browser implements the `popover` attribute.
 *
 * Injectable so the unsupported path can be tested rather than assumed. When
 * this is false the caller must render the same markup expanded inline: a
 * popover that cannot open would make evidence editing impossible (R28).
 */
export function popoverSupported(
  elementPrototype: object | undefined = typeof HTMLElement === "undefined"
    ? undefined
    : HTMLElement.prototype,
): boolean {
  return elementPrototype !== undefined && "popover" in elementPrototype;
}
