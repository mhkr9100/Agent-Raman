import {
    CognitoUserPool,
    CognitoUser,
    AuthenticationDetails,
    CognitoUserAttribute
} from 'amazon-cognito-identity-js';

const USER_POOL_ID = import.meta.env.VITE_AWS_USER_POOL_ID || import.meta.env.VITE_COGNITO_USER_POOL_ID;
const CLIENT_ID = import.meta.env.VITE_AWS_CLIENT_ID || import.meta.env.VITE_COGNITO_CLIENT_ID;

if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Missing required frontend auth env vars: VITE_AWS_USER_POOL_ID and VITE_AWS_CLIENT_ID');
}

const POOL_DATA = {
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID
};

const userPool = new CognitoUserPool(POOL_DATA);

export interface UserSession {
    email: string;
    id: string; // The sub claim
    name?: string;
}

const normalizeAuthError = (err: any, fallback: string) => {
    const raw = (err?.message || err?.code || fallback || 'Authentication failed').toString();
    const lower = raw.toLowerCase();

    if (lower.includes('user does not exist') || lower.includes('usernotfoundexception')) {
        return 'No account found for this email.';
    }
    if (lower.includes('incorrect username or password') || lower.includes('not authorized')) {
        return 'Incorrect email or password.';
    }
    if (lower.includes('username/client id combination not found')) {
        return 'No account found for this email.';
    }
    if (lower.includes('user is not confirmed')) {
        return 'Account not verified yet. Please confirm your email code.';
    }
    if (lower.includes('code mismatch')) {
        return 'Invalid verification code.';
    }
    if (lower.includes('expiredcodeexception') || lower.includes('expired code')) {
        return 'Verification code expired. Request a new code.';
    }
    if (lower.includes('invalid password')) {
        return 'Password does not meet security requirements.';
    }
    if (lower.includes('limit exceeded')) {
        return 'Too many attempts. Please wait a moment and try again.';
    }

    return raw;
};

export const authService = {
    /**
     * Initializes signup. Will trigger OTP to email.
     */
    async register(emailRaw: string, password: string, name: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();

            const attributeList = [
                new CognitoUserAttribute({ Name: 'email', Value: email }),
                new CognitoUserAttribute({ Name: 'name', Value: name })
            ];

            userPool.signUp(email, password, attributeList, [], (err, result) => {
                if (err) {
                    console.error("SignUp Error:", err);
                    reject(new Error(normalizeAuthError(err, 'Failed to create account.')));
                    return;
                }
                resolve();
            });
        });
    },

    /**
     * Verifies the OTP sent to email after register()
     */
    async verifyOtp(emailRaw: string, otp: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();
            const userData = { Username: email, Pool: userPool };
            const cognitoUser = new CognitoUser(userData);

            cognitoUser.confirmRegistration(otp, true, (err, result) => {
                if (err) {
                    console.error("OTP Error:", err);
                    reject(new Error(normalizeAuthError(err, 'Failed to verify code.')));
                    return;
                }
                resolve();
            });
        });
    },

    /**
     * Resends the verification code for signup
     */
    async resendVerificationCode(emailRaw: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();
            const userData = { Username: email, Pool: userPool };
            const cognitoUser = new CognitoUser(userData);

            cognitoUser.resendConfirmationCode((err, result) => {
                if (err) {
                    console.error("Resend OTP Error:", err);
                    reject(new Error(normalizeAuthError(err, 'Failed to resend verification code.')));
                    return;
                }
                resolve();
            });
        });
    },

    /**
     * Initiates the forgot password flow
     */
    async forgotPassword(emailRaw: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();
            const userData = { Username: email, Pool: userPool };
            const cognitoUser = new CognitoUser(userData);

            cognitoUser.forgotPassword({
                onSuccess: function (data) {
                    resolve();
                },
                onFailure: function (err) {
                    reject(new Error(normalizeAuthError(err, 'Unable to start password reset.')));
                }
            });
        });
    },

    /**
     * Confirms the new password
     */
    async confirmPassword(emailRaw: string, code: string, newPassword: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();
            const userData = { Username: email, Pool: userPool };
            const cognitoUser = new CognitoUser(userData);

            cognitoUser.confirmPassword(code, newPassword, {
                onSuccess: function () {
                    resolve();
                },
                onFailure: function (err) {
                    reject(new Error(normalizeAuthError(err, 'Unable to reset password.')));
                }
            });
        });
    },

    /**
     * Authenticates user via SRP and stores session
     */
    async login(emailRaw: string, password?: string): Promise<UserSession> {
        return new Promise((resolve, reject) => {
            const email = emailRaw.toLowerCase().trim();

            if (!password) {
                reject(new Error("Password is required for login."));
                return;
            }

            const authenticationDetails = new AuthenticationDetails({
                Username: email,
                Password: password
            });

            const userData = { Username: email, Pool: userPool };
            const cognitoUser = new CognitoUser(userData);

            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (result) => {
                    // Extract Tokens
                    const accessToken = result.getAccessToken().getJwtToken();
                    const idToken = result.getIdToken().getJwtToken();

                    // Decode IdToken to get attributes
                    const payload = result.getIdToken().payload;
                    const session: UserSession = {
                        email: payload.email,
                        id: payload.sub,
                        name: payload.name || payload.email.split('@')[0]
                    };

                    // Store session in sessionStorage to reduce long-lived token exposure.
                    sessionStorage.setItem('currentUser', JSON.stringify(session));
                    sessionStorage.setItem('auth_token', idToken);
                    sessionStorage.setItem('id_token', idToken);
                    // Clear legacy persistent token storage.
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('id_token');
                    localStorage.removeItem('currentUser');

                    resolve(session);
                },
                onFailure: (err) => {
                    console.error("Login Error:", err);
                    reject(new Error(normalizeAuthError(err, 'Sign in failed.')));
                },
                newPasswordRequired: (userAttributes, requiredAttributes) => {
                    // Handled if admin creates user, usually not needed for self signup
                    reject(new Error("New password required. Flow not implemented."));
                }
            });
        });
    },

    /**
     * Gets token from sessionStorage (with legacy localStorage fallback).
     */
    getToken(): string | null {
        return sessionStorage.getItem('auth_token')
            || localStorage.getItem('auth_token');
    },

    /**
     * Logs the user out locally and cleanly from Cognito
     */
    async logout() {
        const cognitoUser = userPool.getCurrentUser();
        if (cognitoUser != null) {
            cognitoUser.signOut();
        }
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('id_token');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('id_token');
    },

    /**
     * Synchronous check of current local storage session
     */
    async getCurrentUser(): Promise<{ id: string, username: string, email: string, name: string } | null> {
        try {
            const data = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser');
            if (data) {
                const session: UserSession = JSON.parse(data);
                // Migrate any legacy persisted session into sessionStorage only.
                sessionStorage.setItem('currentUser', JSON.stringify(session));
                localStorage.removeItem('currentUser');
                return {
                    id: session.id,
                    username: session.email,
                    email: session.email,
                    name: session.name || session.email.split('@')[0] || 'Architect'
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    }
};
