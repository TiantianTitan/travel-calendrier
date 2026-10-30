"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { sheetTranslateY, useSheetSwipe } from "@/hooks/use-sheet-swipe";

const openerChains = new WeakMap<HTMLElement, HTMLElement[]>();
export const SheetClose = Dialog.Close;

interface SheetProps {
  title: string;
  description?: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  mobileBodyTitle?: boolean;
  children: ReactNode;
  className?: string;
}

export function Sheet({ title, description, onClose, onBack, backLabel = "返回", backDisabled = false, mobileBodyTitle = false, children, className }: SheetProps) {
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const finished = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCallback = useRef(onClose); closeCallback.current = onClose;
  const [handoff] = useState(() => typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement && !!document.activeElement.closest("[data-travel-sheet]"));
  const [returnFocus] = useState<HTMLElement[]>(() => {
    if (typeof document === "undefined" || !(document.activeElement instanceof HTMLElement)) return [];
    const active = document.activeElement;
    const parent = active.closest<HTMLElement>("[data-travel-sheet]");
    return [active, ...(parent ? openerChains.get(parent) ?? [] : [])];
  });
  const setContent = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (node) openerChains.set(node, returnFocus);
  }, [returnFocus]);
  const finishClose = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeCallback.current();
  }, []);
  const requestClose = (swipeOffset = 0) => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finishClose(); return; }
    // Reverse from the visible frame, including an entrance interrupted mid-flight.
    const content = contentRef.current, overlay = overlayRef.current;
    let exitOffset = swipeOffset;
    if (content) {
      const current = getComputedStyle(content);
      content.style.setProperty("--sheet-exit-opacity", current.opacity);
      content.style.setProperty("--sheet-exit-transform", current.transform);
      if (window.matchMedia("(max-width: 799px)").matches) exitOffset = Math.max(exitOffset, sheetTranslateY(current.transform));
    }
    if (overlay) overlay.style.setProperty("--overlay-exit-opacity", getComputedStyle(overlay).opacity);
    stopForClose();
    content?.style.setProperty("--sheet-exit-y", `${exitOffset > 0 ? exitOffset + 48 : 12}px`);
    contentRef.current?.focus({ preventScroll: true });
    setClosing(true);
    // Keep the original modal and session exclusive until dismissal finishes.
    closeTimer.current = setTimeout(finishClose, 180);
  };
  const { handleRef, stopForClose, onHandleClick } = useSheetSwipe({ contentRef, overlayRef, closingRef, onDismiss: requestClose });
  const setChrome = useCallback((chrome: HTMLDivElement | null) => {
    if (!chrome) return;
    const measure = () => chrome.closest<HTMLElement>("[data-travel-sheet]")?.style.setProperty("--sheet-chrome-height", `${chrome.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => { if (closing && reducedMotion) finishClose(); }, [closing, reducedMotion, finishClose]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay ref={overlayRef} className="sheet-overlay" data-closing={closing || undefined} data-sheet-handoff={handoff || undefined} />
        <Dialog.Content
          ref={setContent}
          className={["sheet-content", className].filter(Boolean).join(" ")}
          data-travel-sheet=""
          data-sheet-handoff={handoff || undefined}
          data-closing={closing || undefined}
          aria-describedby={description ? descriptionId : undefined}
          onAnimationEnd={event => {
            if (event.target === event.currentTarget && closingRef.current && event.animationName.startsWith("sheet-out")) finishClose();
          }}
          onSubmitCapture={event => { if (closingRef.current) { event.preventDefault(); event.stopPropagation(); } }}
          onKeyDownCapture={event => { if (closingRef.current) { event.preventDefault(); event.stopPropagation(); } }}
          onOpenAutoFocus={(event) => {
            const preferred = contentRef.current?.querySelector<HTMLElement>("[data-sheet-autofocus]");
            if (preferred) {
              event.preventDefault();
              preferred.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A detail → editor handoff must not steal focus from its successor.
            const sheets = Array.from(document.querySelectorAll<HTMLElement>("[data-travel-sheet]"));
            const current = sheets.filter(node => node !== contentRef.current).at(-1);
            const target = returnFocus.find(node => node.isConnected && node.getClientRects().length &&
              !node.closest("[inert]") && (!current || current.contains(node)));
            target?.focus({ preventScroll: true });
          }}
        >
          <div ref={setChrome} className={`sheet-chrome${mobileBodyTitle ? " sheet-chrome-body-title" : ""}`}>
            <button ref={handleRef} className="sheet-handle" type="button" aria-label="关闭弹窗" tabIndex={-1} onClick={onHandleClick} disabled={closing}><span aria-hidden="true" /></button>
            <div className="sheet-header">
              {onBack && <button className="icon-button sheet-back" type="button" aria-label={backLabel} onClick={onBack} disabled={closing || backDisabled}><ArrowLeft size={20} aria-hidden="true" /></button>}
              {!mobileBodyTitle && <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>}
              <Dialog.Close asChild>
                <button className="icon-button" type="button" aria-label="关闭" disabled={closing}><X size={20} aria-hidden="true" /></button>
              </Dialog.Close>
            </div>
          </div>
          {mobileBodyTitle && <Dialog.Title className="sheet-body-title">{title}</Dialog.Title>}
          {description && <Dialog.Description id={descriptionId} className="sheet-description">{description}</Dialog.Description>}
          <div className="sheet-body" inert={closing}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
