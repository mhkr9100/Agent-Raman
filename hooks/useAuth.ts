import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { authService } from '../services/auth';

export const useAuth = () => {
    const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const user = await authService.getCurrentUser();
                if (user) {
                    const profile: UserProfile = {
                        id: user.id || 'aws-user-id',
                        email: user.email || user.username || '',
                        name: user.name || user.username || 'Architect',
                        avatar: ''
                    };
                    setCurrentUser(profile);
                } else {
                    setCurrentUser(null);
                }
            } catch (err) {
                console.error("Auth session error:", err);
            } finally {
                setIsInitializing(false);
            }
        };
        checkSession();
    }, []);

    const login = useCallback(async (email: string, name: string, password?: string) => {
        try {
            const user = await authService.login(email, password);
            const profile: UserProfile = {
                id: user.id,
                email: user.email,
                name: user.name || name,
                avatar: ''
            };
            setCurrentUser(profile);
        } catch (e) {
            console.error(e);
            throw e;
        }
    }, []);

    const register = useCallback(async (email: string, name: string, password?: string) => {
        try {
            await authService.register(email, password || 'password', name);
            // We do not set currentUser here because Cognito requires OTP verification first.
            // The UI handles the transition to OTP screen.
        } catch (e) {
            console.error(e);
            throw e;
        }
    }, []);
    const logout = useCallback(async () => {
        await authService.logout();
        setCurrentUser(null);
        setIsInitializing(false);
    }, []);

    // Platform-managed: no user API keys. Returns empty object for backward compat with any callers.
    const getUserKeys = useCallback(() => ({}), []);

    return {
        currentUser, setCurrentUser, isInitializing, setIsInitializing,
        login, logout, getUserKeys
    };
};
