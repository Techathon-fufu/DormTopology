import { create } from 'zustand'

export const useCabinetStore = create<{ open: boolean; toggle: () => void }>((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
}))
