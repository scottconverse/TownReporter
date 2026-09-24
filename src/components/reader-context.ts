import { createContext, useContext } from "react";

export type ReaderPrefs = { dark: boolean; size: number; saved: string[] };
export const readerDefaults: ReaderPrefs = { dark: false, size: 21, saved: [] };
export const ReaderContext = createContext({
  ...readerDefaults,
  ready: false,
  update: (_value: Partial<ReaderPrefs>) => {},
  notify: (_message: string) => {},
});
export const useReader = () => useContext(ReaderContext);
