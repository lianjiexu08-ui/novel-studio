import { createContext, useContext } from 'react';

type WorkChrome = {
  title: string | null;
  setTitle: (title: string | null) => void;
};

export const WorkChromeContext = createContext<WorkChrome>({
  title: null,
  setTitle: () => {},
});

export function useWorkChrome() {
  return useContext(WorkChromeContext);
}
