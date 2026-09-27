import { DocumentEditor } from "@onlyoffice/document-editor-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "../toast";

const EDITOR_SETTLE_MS = 4000;
const USER_INTENT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

function findScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el && el !== document.body) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) || document.documentElement;
}

type Props = {
  documentId: string;
  documentServerUrl: string;
  config: Record<string, unknown>;
  documentType?: string;
};

/**
 * Mount Once per documentId. Do not remount on rename — OnlyOffice mutates the DOM
 * and React unmount then throws removeChild / blanks the page.
 */
export function OnlyOfficePreviewer({
  documentId,
  documentServerUrl,
  config,
  documentType,
}: Props) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const editorId = `onlyoffice-editor-${documentId}`;

  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), 50);
    return () => {
      clearTimeout(timer);
      setReady(false);
    };
  }, [documentId]);

  useEffect(() => {
    if (!ready) return undefined;
    const container = editorContainerRef.current;
    if (!container) return undefined;

    const scroller = findScrollableAncestor(container);
    if (!scroller) return undefined;

    const pinnedTop = scroller.scrollTop;
    let released = false;

    const release = () => {
      released = true;
    };
    const restore = () => {
      if (released) return;
      if (scroller.scrollTop !== pinnedTop) scroller.scrollTop = pinnedTop;
    };

    scroller.addEventListener("scroll", restore);
    USER_INTENT_EVENTS.forEach((evt) =>
      window.addEventListener(evt, release, { passive: true, capture: true }),
    );
    const settleTimer = setTimeout(release, EDITOR_SETTLE_MS);

    return () => {
      clearTimeout(settleTimer);
      scroller.removeEventListener("scroll", restore);
      USER_INTENT_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, release, { capture: true }),
      );
    };
  }, [ready, documentId]);

  const serverUrl = documentServerUrl.endsWith("/")
    ? documentServerUrl
    : `${documentServerUrl}/`;

  return (
    <div ref={editorContainerRef} className="onlyoffice-previewer">
      {ready && (
        <DocumentEditor
          id={editorId}
          documentType={documentType}
          type="desktop"
          height="100%"
          width="100%"
          documentServerUrl={serverUrl}
          config={config as never}
          onLoadComponentError={(_code: number, message: string) => {
            toast.error(message || "OnlyOffice failed to load");
          }}
        />
      )}
    </div>
  );
}
