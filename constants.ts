import { Agent, AIModelProfile, AgentTemplate, Team } from './types';

export const VAULT = {
    AWS: {
        REGION: import.meta.env.VITE_AWS_REGION || 'us-east-1',
        COGNITO_USER_POOL_ID: import.meta.env.VITE_AWS_USER_POOL_ID || '',
        COGNITO_CLIENT_ID: import.meta.env.VITE_AWS_CLIENT_ID || '',
        COGNITO_IDENTITY_POOL_ID: import.meta.env.VITE_AWS_IDENTITY_POOL_ID || '',
        S3_BUCKET_NAME: import.meta.env.VITE_AWS_S3_BUCKET_NAME || ''
    }
};

// Runtime registries are backend-driven (/api/v2/models, /api/v2/tools, /api/v2/special-agents).
// Keep local arrays empty to avoid static/template fallback behavior.
export const AI_RESUMES: AIModelProfile[] = [];
export const AGENT_TEMPLATES: AgentTemplate[] = [];

export const AGENTS: Record<string, Agent> = {
    PRISM: {
        id: 'prism-core',
        name: 'Prism',
        type: 'HR',
        role: 'Meta Agent',
        jobDescription: 'Prism is the platform meta agent. Use Ask, Create, Route, and Council modes from the backend runtime.',
        icon: '△',
        provider: 'google',
        model: 'gemini-2.5-flash',
        isDeletable: false,
        isSystem: true,
        capabilities: ['thinking', 'web-search', 'fabricateAgent', 'fabricateTeam']
    }
};

export const SPECIAL_AGENT_TEMPLATES: any[] = [];
export const SYSTEM_TEAMS: Team[] = [];
