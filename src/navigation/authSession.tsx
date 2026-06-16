import { createContext, useContext } from 'react';

export type AuthSessionContextValue = {
  signOut: () => Promise<void>;
};

export const AuthSessionContext = createContext<AuthSessionContextValue>({
  signOut: async () => {},
});

export function useAuthSession(): AuthSessionContextValue {
  return useContext(AuthSessionContext);
}
