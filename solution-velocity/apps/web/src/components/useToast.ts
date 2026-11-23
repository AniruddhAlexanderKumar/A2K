import { useCallback, useState } from 'react';

export type ToastState = { message: string; tone?: 'error' | 'success' } | null;

/** Tiny toast store; each screen owns its own notification. */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const show = useCallback((message: string, tone?: 'error' | 'success') => {
    setToast({ message, tone });
  }, []);
  const clear = useCallback(() => setToast(null), []);
  return { toast, show, clear };
}
