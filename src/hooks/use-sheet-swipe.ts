"use client";

import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

interface SheetSwipeOptions {
  contentRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  closingRef: RefObject<boolean>;
  onDismiss: (offset: number) => void;
}

type StyleSnapshot = { node: HTMLElement; values: [string, string, string][] };
type Gesture = {
  pointerId: number;
  startY: number;
  baseY: number;
  offset: number;
  travel: number;
  height: number;
  opacity: number;
  overlayOpacity: number;
  samples: { y: number; time: number }[];
};

export function sheetTranslateY(transform: string): number {
  const values = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
  if (!values) return 0;
  const result = Number(values[2].split(",")[values[1] ? 13 : 5]);
  return Number.isFinite(result) ? result : 0;
}

/** DOM-only controller, also used to exercise gesture cancellation without a server. */
export function createSheetSwipeController(handle: HTMLButtonElement, options: SheetSwipeOptions) {
  const doc = handle.ownerDocument;
  const win = doc.defaultView!;
  const mobile = win.matchMedia("(max-width: 799px)");
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  let gesture: Gesture | null = null;
  let snapshots: StyleSnapshot[] = [];
  let rebound: Animation[] = [];
  let reboundTimer: ReturnType<typeof setTimeout> | null = null;
  let reboundGeneration = 0;
  let suppressClick = false;
  let disposed = false;
  const pointers = new Set<number>();

  const cancelRebound = () => {
    ++reboundGeneration;
    if (reboundTimer !== null) clearTimeout(reboundTimer);
    reboundTimer = null;
    const previous = rebound; rebound = [];
    previous.forEach(animation => { animation.onfinish = null; animation.cancel(); });
  };
  const restoreStyles = () => {
    for (const { node, values } of snapshots) for (const [name, value, priority] of values) {
      if (value) node.style.setProperty(name, value, priority);
      else node.style.removeProperty(name);
    }
    snapshots = [];
  };
  const remember = (node: HTMLElement) => {
    if (snapshots.some(snapshot => snapshot.node === node)) return;
    snapshots.push({ node, values: ["transform", "opacity"].map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]) });
  };
  const release = (active: Gesture | null) => {
    if (!active) return;
    try { if (handle.hasPointerCapture(active.pointerId)) handle.releasePointerCapture(active.pointerId); }
    catch { /* A detached handle or already-cancelled pointer has no capture. */ }
  };
  const settle = (animate: boolean) => {
    cancelRebound();
    const content = options.contentRef.current;
    const overlay = options.overlayRef.current;
    if (!snapshots.length) return;
    if (!animate || reduced.matches || !mobile.matches || doc.hidden || !content?.isConnected || !content.animate) {
      restoreStyles(); return;
    }
    const sequence = reboundGeneration;
    const finish = () => {
      if (disposed || sequence !== reboundGeneration) return;
      cancelRebound(); restoreStyles();
    };
    const current = win.getComputedStyle(content);
    try {
      rebound.push(content.animate([
        { transform: current.transform, opacity: current.opacity },
        { transform: "translateY(0px)", opacity: 1 },
      ], { duration: 140, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }));
      if (overlay?.isConnected && overlay.animate) rebound.push(overlay.animate([
        { opacity: win.getComputedStyle(overlay).opacity }, { opacity: 1 },
      ], { duration: 140, easing: "ease-out", fill: "forwards" }));
      rebound[0].onfinish = finish;
      reboundTimer = setTimeout(finish, 180);
    } catch { cancelRebound(); restoreStyles(); }
  };
  const cancelGesture = (animate: boolean) => {
    const active = gesture; gesture = null;
    if (active) suppressClick = true;
    release(active);
    settle(animate);
  };
  const stopForClose = () => {
    const active = gesture; gesture = null;
    suppressClick = true;
    release(active);
    cancelRebound(); restoreStyles();
  };
  const update = (event: PointerEvent) => {
    const active = gesture, content = options.contentRef.current;
    if (!active || event.pointerId !== active.pointerId || !content) return;
    const delta = event.clientY - active.startY;
    active.travel = Math.max(active.travel, Math.abs(delta));
    active.offset = Math.max(0, active.baseY + delta);
    active.samples.push({ y: event.clientY, time: event.timeStamp });
    while (active.samples.length > 1 && event.timeStamp - active.samples[0].time > 100) active.samples.shift();
    content.style.transform = `translateY(${active.offset}px)`;
    content.style.opacity = String(active.opacity);
    const overlay = options.overlayRef.current;
    if (overlay) overlay.style.opacity = String(active.overlayOpacity * (1 - Math.min(active.offset / active.height, 1) * .5));
  };
  const onDocumentDown = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (gesture && event.pointerId !== gesture.pointerId) cancelGesture(true);
  };
  const onDown = (event: PointerEvent) => {
    if (disposed || options.closingRef.current || !mobile.matches || !event.isPrimary || event.button !== 0 || pointers.size > 1) return;
    const content = options.contentRef.current;
    if (!content || !content.isConnected || gesture) return;
    const overlay = options.overlayRef.current;
    // Capture the visible frame before interrupting an entrance or a short pull's rebound.
    const visible = win.getComputedStyle(content);
    const baseY = Math.max(0, sheetTranslateY(visible.transform));
    const opacity = Number(visible.opacity) || 1;
    const overlayOpacity = overlay ? Number(win.getComputedStyle(overlay).opacity) || 1 : 1;
    cancelRebound();
    remember(content); if (overlay) remember(overlay);
    // Complete only animations on these surfaces, never animations in the form.
    for (const node of [content, overlay]) node?.getAnimations?.().forEach(animation => {
      if ((animation.effect as KeyframeEffect | null)?.target === node) {
        try { animation.finish(); } catch { /* Infinite or externally removed animation. */ }
      }
    });
    suppressClick = false;
    gesture = {
      pointerId: event.pointerId, startY: event.clientY, baseY, offset: baseY, travel: 0,
      height: Math.max(1, content.getBoundingClientRect().height), opacity, overlayOpacity,
      samples: [{ y: event.clientY, time: event.timeStamp }],
    };
    content.style.transform = `translateY(${baseY}px)`; content.style.opacity = String(opacity);
    if (overlay) overlay.style.opacity = String(overlayOpacity);
    try { handle.setPointerCapture(event.pointerId); }
    catch { cancelGesture(false); }
  };
  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (options.closingRef.current || !mobile.matches) { cancelGesture(false); return; }
    event.preventDefault(); update(event);
  };
  const onUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    update(event);
    gesture = null; release(active);
    if (options.closingRef.current || !mobile.matches) { suppressClick = true; settle(false); return; }
    const first = active.samples[0], last = active.samples.at(-1)!;
    const velocity = last.time > first.time ? (last.y - first.y) / (last.time - first.time) : 0;
    const distance = Math.max(0, event.clientY - active.startY);
    const threshold = Math.min(120, Math.max(72, active.height * .22));
    if (distance >= threshold || (distance >= 40 && velocity >= .65)) {
      suppressClick = true;
      options.onDismiss(active.offset);
    } else if (active.travel >= 6) {
      suppressClick = true; settle(true);
    } else {
      // Leave a genuine tap to the click handler; no form or background receives it.
      settle(false);
    }
  };
  const onCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (gesture?.pointerId === event.pointerId) cancelGesture(true);
  };
  const onLostCapture = (event: PointerEvent) => {
    if (gesture?.pointerId === event.pointerId) cancelGesture(true);
  };
  const onEnvironmentChange = () => { cancelGesture(false); pointers.clear(); };
  const onVisibility = () => { if (doc.hidden) onEnvironmentChange(); };
  const onReducedChange = () => { if (reduced.matches && !gesture) settle(false); };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("lostpointercapture", onLostCapture);
  doc.addEventListener("pointerdown", onDocumentDown, true);
  doc.addEventListener("pointermove", onMove, { capture: true, passive: false });
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onCancel, true);
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("resize", onEnvironmentChange);
  win.visualViewport?.addEventListener("resize", onEnvironmentChange);
  mobile.addEventListener("change", onEnvironmentChange);
  reduced.addEventListener("change", onReducedChange);

  return {
    stopForClose,
    onHandleClick(event: Pick<ReactMouseEvent<HTMLButtonElement>, "detail" | "preventDefault" | "stopPropagation">) {
      if (disposed || options.closingRef.current || (event.detail !== 0 && suppressClick)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      options.onDismiss(gesture?.offset ?? 0);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      stopForClose(); pointers.clear();
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("lostpointercapture", onLostCapture);
      doc.removeEventListener("pointerdown", onDocumentDown, true);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onUp, true);
      doc.removeEventListener("pointercancel", onCancel, true);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("resize", onEnvironmentChange);
      win.visualViewport?.removeEventListener("resize", onEnvironmentChange);
      mobile.removeEventListener("change", onEnvironmentChange);
      reduced.removeEventListener("change", onReducedChange);
    },
  };
}

export function useSheetSwipe({ contentRef, overlayRef, closingRef, onDismiss }: SheetSwipeOptions) {
  const dismissRef = useRef(onDismiss); dismissRef.current = onDismiss;
  const controllerRef = useRef<ReturnType<typeof createSheetSwipeController> | null>(null);
  // Radix Portal can attach after the Sheet's first effect. Bind to the actual handle.
  const handleRef = useCallback((handle: HTMLButtonElement | null) => {
    if (!handle) return;
    const controller = createSheetSwipeController(handle, { contentRef, overlayRef, closingRef, onDismiss: offset => dismissRef.current(offset) });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [contentRef, overlayRef, closingRef]);
  const stopForClose = useCallback(() => controllerRef.current?.stopForClose(), []);
  const onHandleClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (controllerRef.current) controllerRef.current.onHandleClick(event);
    else if (!closingRef.current) dismissRef.current(0);
  }, [closingRef]);
  return { handleRef, stopForClose, onHandleClick };
}
