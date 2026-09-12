import { create } from 'zustand';
import type { Me, Membership, User } from '../types';

type AuthState = {
  status: 'unknown' | 'authed' | 'anon';
  user: User | null;
  memberships: Membership[];
  setSession: (me: Me) => void;
  clear: () => void;
  roleIn: (eventId: string) => 'admin' | 'member' | null;
};

// Deliberately not persisted. Identity belongs to the httpOnly server session.
export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  memberships: [],
  setSession: (me) => set({ status: 'authed', user: me.user, memberships: me.memberships }),
  clear: () => set({ status: 'anon', user: null, memberships: [] }),
  roleIn: (eventId) => get().memberships.find((membership) => membership.eventId === eventId)?.role ?? null,
}));
