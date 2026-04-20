import { useCallback, useState } from 'react';

const BIOMETRIC_ENABLED = import.meta.env.VITE_ENABLE_BIOMETRIC === 'true';

interface BiometricAuthResult {
  success: boolean;
  credential?: PublicKeyCredential;
  error?: string;
}

export function useBiometricAuth() {
  const [isAvailable] = useState(
    BIOMETRIC_ENABLED &&
    typeof window !== 'undefined' &&
    'credentials' in navigator &&
    'create' in navigator.credentials
  );

  const register = useCallback(async (userId: string): Promise<BiometricAuthResult> => {
    if (!isAvailable) {
      return { success: false, error: 'Biometric auth not available' };
    }

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Aegis' },
          user: {
            id: new TextEncoder().encode(userId),
            name: userId,
            displayName: userId,
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            userVerification: 'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: 'Registration cancelled' };
      }

      return { success: true, credential };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }, [isAvailable]);

  const authenticate = useCallback(async (): Promise<BiometricAuthResult> => {
    if (!isAvailable) {
      return { success: false, error: 'Biometric auth not available' };
    }

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'preferred',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: 'Authentication cancelled' };
      }

      return { success: true, credential };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }, [isAvailable]);

  return {
    isAvailable,
    register,
    authenticate,
  };
}
