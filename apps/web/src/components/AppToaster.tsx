import { useEffect } from 'react';
import { Toaster } from 'sonner';

/**
 * Sonner returns focus to the element focused before a toast whenever focus leaves the
 * toaster. As the last stop in the tab order that forms a loop (… → toast → close →
 * back to the same element → toast …), a keyboard trap (WCAG 2.1.2). Toasts are
 * already announced through Sonner's live region and dismiss themselves, so they are
 * kept out of the Tab sequence instead.
 */
export function AppToaster() {
  useEffect(() => {
    const untab = (root: ParentNode) =>
      root.querySelectorAll<HTMLElement>('[data-sonner-toast], [data-sonner-toast] button').forEach((el) => {
        if (el.tabIndex !== -1) el.tabIndex = -1;
      });
    const observer = new MutationObserver(() => untab(document));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <Toaster position="top-center" richColors closeButton />;
}
