"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { IntroModal } from "./IntroModal";

const STORAGE_KEY = "datax-intro-dismissed";

type IntroModalContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  dismissPermanently: () => void;
};

const IntroModalContext = createContext<IntroModalContextValue | null>(null);

export function IntroModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY) === "true";
      if (!dismissed) setIsOpen(true);
    } catch {
      setIsOpen(true);
    }
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({ isOpen, open, close, dismissPermanently }),
    [isOpen, open, close, dismissPermanently]
  );

  return (
    <IntroModalContext.Provider value={value}>
      {children}
      {hydrated && isOpen ? (
        <IntroModal
          onClose={close}
          onDismissPermanently={dismissPermanently}
        />
      ) : null}
    </IntroModalContext.Provider>
  );
}

export function useIntroModal() {
  const ctx = useContext(IntroModalContext);
  if (!ctx) {
    throw new Error("useIntroModal must be used within IntroModalProvider");
  }
  return ctx;
}
