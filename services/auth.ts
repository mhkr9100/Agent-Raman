import {
    CognitoUserPool,
    CognitoUser,
    AuthenticationDetails,
    CognitoUserAttribute
} from 'amazon-cognito-identity-js';

// Load from environment, fallback to known deployment values for safety
const POOL_DATA = {
    UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_R2j2oAqLJ',
    ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '77205lmtu8fg6t1s3sgcidf7p9'
};

const userPool = new CognitoUserPool(POOL_DATA);

export interface UserSession {
    email: string;
    id: string; // The sub claim
    name?: string;
}

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
                    reject(new Error(err.message || JSON.stringify(err)));
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
                    reject(new Error(err.message || JSON.stringify(err)));
                    return;
                }
                resolve();
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

                    // Securely store for apiV2
                    localStorage.setItem('currentUser', JSON.stringify(session));
                    // We use ID Token for authorization in API Gateway / Lambda
                    localStorage.setItem('auth_token', idToken);

                    resolve(session);
                },
                onFailure: (err) => {
                    console.error("Login Error:", err);
                    reject(new Error(err.message || JSON.stringify(err)));
                },
                newPasswordRequired: (userAttributes, requiredAttributes) => {
                    // Handled if admin creates user, usually not needed for self signup
                    reject(new Error("New password required. Flow not implemented."));
                }
            });
        });
    },

    /**
     * Gets token directly from localStorage for apiV2.ts
     */
    getToken(): string | null {
        return localStorage.getItem('auth_token');
    },

    /**
     * Logs the user out locally and cleanly from Cognito
     */
    async logout() {
        const cognitoUser = userPool.getCurrentUser();
        if (cognitoUser != null) {
            cognitoUser.signOut();
        }
        localStorage.removeItem('currentUser');
        localStorage.removeItem('auth_token');
    },

    /**
     * Synchronous check of current local storage session
     */
    async getCurrentUser(): Promise<{ id: string, username: string, email: string, name: string } | null> {
        try {
            const data = localStorage.getItem('currentUser');
            if (data) {
                const session: UserSession = JSON.parse(data);
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
