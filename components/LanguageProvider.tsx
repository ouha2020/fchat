"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getStoredLanguage,
  saveLanguage,
  translate,
  type Language,
  type TranslationKey,
} from "@/lib/i18n";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export default function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh");

  useEffect(() => {
    setLanguageState(getStoredLanguage());
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const setLanguage = (next: Language) => {
      saveLanguage(next);
      setLanguageState(next);
    };
    return {
      language,
      setLanguage,
      t: (key, vars) => translate(language, key, vars),
    };
  }, [language]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return value;
}
