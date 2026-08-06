import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  popoverPosition,
  popoverSupported,
  type PopoverPosition,
} from "./popover-position";
import "./components.css";

type PopoverProps = {
  /** Unique id, used to wire the trigger to the panel. */
  id: string;
  triggerLabel: ReactNode;
  triggerClassName?: string;
  /** Accessible name of the panel. */
  panelLabel: string;
  className?: string;
  /** Rendered inside the panel. `close` returns focus to the trigger. */
  children: (api: { close: () => void; open: boolean }) => ReactNode;
  /**
   * A second control that opens the same panel — the chip overflow, say.
   * It is given the wiring rather than a callback so the browser still owns
   * opening where `popover` exists.
   */
  extraTrigger?: (attributes: {
    "aria-controls": string;
    "aria-expanded": boolean;
    popoverTarget?: string;
    onClick?: () => void;
  }) => ReactNode;
  /** Overrides feature detection. Tests fix this to false; app code does not. */
  supported?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A panel anchored to its trigger, built on the native `popover` attribute.
 *
 * Dismissal (ESC, click outside) and the top layer are the browser's job — a
 * hand-written version of either is where accessibility bugs live. What the
 * browser does not do is position the panel or move focus, so those two are
 * done here.
 *
 * Where `popover` is missing the same markup renders expanded inline. That is
 * a class and an attribute, not a second implementation: a trigger that cannot
 * open would leave evidence uneditable in those browsers (R28).
 */
export function Popover({
  id,
  triggerLabel,
  triggerClassName = "",
  panelLabel,
  className = "",
  children,
  extraTrigger,
  supported: supportedProp,
  onOpenChange,
}: PopoverProps) {
  const supported = useMemo(
    () => supportedProp ?? popoverSupported(),
    [supportedProp],
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Without `popover` the panel is open from the start: the user must be able
  // to reach the controls even though nothing can toggle a top layer.
  const [open, setOpen] = useState(!supported);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    setPosition(
      popoverPosition(
        {
          top: anchor.top,
          left: anchor.left,
          width: anchor.width,
          height: anchor.height,
        },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  // `close` is handed to the panel's own content, which is rendered as a
  // child. It therefore records a request and lets an effect touch the DOM:
  // a callback that reached into a ref would be built during render.
  const [closeRequests, setCloseRequests] = useState(0);
  const close = useCallback(() => {
    if (!supported) setOpen(false);
    setCloseRequests((count) => count + 1);
  }, [supported]);

  useEffect(() => {
    if (closeRequests === 0) return;
    if (supported) {
      // The `toggle` event that follows is what restores focus.
      panelRef.current?.hidePopover();
      return;
    }
    triggerRef.current?.focus();
  }, [closeRequests, supported]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !supported) return;

    const onToggle = (event: Event) => {
      const isOpen =
        (event as Event & { newState?: string }).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        reposition();
        const target = panel.querySelector<HTMLElement>(
          "[data-popover-autofocus]",
        );
        target?.focus();
        return;
      }
      // `popover=auto` gives light dismiss but not focus return. Only take
      // focus back if the browser left it nowhere useful — stealing it from
      // whatever the user clicked next would be worse than not restoring it.
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) {
        triggerRef.current?.focus();
      }
    };

    panel.addEventListener("toggle", onToggle);
    return () => panel.removeEventListener("toggle", onToggle);
  }, [supported, reposition]);

  // Read through a ref: an inline callback would change identity every render
  // and re-announce "open" to a listener that resets state on it.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  useEffect(() => {
    if (!open || !supported) return;
    const handle = () => reposition();
    // Capture, so a scroll inside any ancestor is seen too. Repositioning
    // rather than closing: the editor is long, and closing mid-scroll would
    // throw away the selection the user was in the middle of making (R25).
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, supported, reposition]);

  return (
    <div
      className={[
        "ds-popover",
        supported ? "" : "ds-popover--inline",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {extraTrigger?.({
        "aria-controls": id,
        "aria-expanded": open,
        ...(supported
          ? { popoverTarget: id }
          : { onClick: () => setOpen((current) => !current) }),
      })}
      <button
        type="button"
        ref={triggerRef}
        className={["ds-popover__trigger", triggerClassName]
          .filter(Boolean)
          .join(" ")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={id}
        {...(supported
          ? { popoverTarget: id }
          : { onClick: () => setOpen((current) => !current) })}
      >
        {triggerLabel}
      </button>
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-label={panelLabel}
        {...(supported ? { popover: "auto" as const } : {})}
        className={[
          "ds-popover__panel",
          supported ? "" : "ds-popover__panel--inline",
        ]
          .filter(Boolean)
          .join(" ")}
        hidden={!supported && !open}
        style={
          supported && position
            ? { top: position.top, left: position.left }
            : undefined
        }
        data-placement={position?.placement}
      >
        {children({ close, open })}
      </div>
    </div>
  );
}
