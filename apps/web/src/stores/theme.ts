import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';
const resolve = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;

type ThemeState = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      resolved: resolve('system'),
      setPreference: (preference) => set({ preference, resolved: resolve(preference) }),
    }),
    { name: 'trizen-theme', partialize: (state) => ({ preference: state.preference }) },
  ),
);

useThemeStore.subscribe((state) => { document.documentElement.dataset.theme = state.resolved; });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const state = useThemeStore.getState();
  if (state.preference === 'system') state.setPreference('system');
});
