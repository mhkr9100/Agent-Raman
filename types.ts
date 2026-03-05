
export type AgentType = 'agent' | 'HR' | 'user' | 'custom';

export type AgentCapability =
  | 'googleSearch'
  | 'googleMaps'
  | 'imageGeneration'
  | 'imageEditing'
  | 'videoGeneration'
  | 'speechGeneration'
  | 'transcription'
  | 'thinking'
  | 'vision'
  | 'videoUnderstanding'
  | 'liveAudio'
  | 'fileManipulation'
  | 'fabricateAgent'
  | 'fabricateTeam';


export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  bio?: string;
  // API keys are platform-managed (not user-provided)
}

export interface ChatSession {
  id: string;
  entityId: string; // agent or team ID
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isActive: boolean;
}

export interface GlobalTask {
  id: string;
  agentId: string;
  teamId?: string;
  label: string;
  status: 'scheduled' | 'processing' | 'done' | 'not-done';
  createdAt: number;
  scheduledTime?: number;
  isRecurring?: boolean;
  recurrenceType?: 'daily' | 'weekly' | 'monthly' | 'custom';
  recurrenceValue?: string;
  output?: string;
}

export interface Agent {
  id: string;
  userId?: string;
  name: string;
  type: AgentType;
  role: string;
  jobDescription?: string;
  icon: string;
  provider: 'google' | 'openai' | 'anthropic' | 'aws' | 'auto';
  model: string;
  profileImage?: string;
  apiKey?: string;
  capabilities?: AgentCapability[];
  config?: {
    thinkingBudget?: number;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';
    imageSize?: '1K' | '2K' | '4K';
    voiceName?: string;
    videoResolution?: '720p' | '1080p';
  };
  isDeletable?: boolean;
  isSystem?: boolean;
  isGroupMemberOnly?: boolean;
  isPM?: boolean;
  isLiveSpaceEnabled?: boolean;
  knowledgeBase?: {
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
    uploadedAt: number;
  }[];
  tools?: {
    toolId: string;
    endpoints: string[];
  }[];
  // Backend-sourced fields
  systemPrompt?: string;
  blueprint?: any;
  status?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: any;
  safetyType?: 'READ_ONLY' | 'ACTION';
}

export interface Message {
  id: string;
  userId?: string;
  agent: Agent;
  content: MessageContent;
  type: 'user' | 'agent';
  searchEnabled?: boolean;
}

export interface Task {
  id: string;
  label: string;
  status: 'pending' | 'working' | 'completed';
}

export interface GroundingChunk {
  web?: { uri?: string; title?: string };
  maps?: { uri?: string; title?: string };
}

export type MessageContent =
  | {
    type: 'text';
    text: string;
    solution?: string;
    isExpanding?: boolean;
    tasks?: Task[];
    groundingChunks?: GroundingChunk[];
    toolCall?: ToolCall;
    isExecuting?: boolean;
    mode?: 'CHAT' | 'SOLUTION' | 'TASK_PROPOSAL';
  }
  | {
    type: 'image';
    imageUrl: string;
    mimeType: string;
    text?: string;
    solution?: string;
    isExpanding?: boolean;
    tasks?: Task[];
    groundingChunks?: GroundingChunk[];
    toolCall?: ToolCall;
    isExecuting?: boolean;
  }
  | {
    type: 'video';
    videoUrl: string;
    text?: string;
    solution?: string;
    isExpanding?: boolean;
    tasks?: Task[];
    toolCall?: ToolCall;
    isExecuting?: boolean;
  }
  | {
    type: 'audio';
    audioUrl: string;
    text?: string;
    solution?: string;
    isExpanding?: boolean;
    tasks?: Task[];
    toolCall?: ToolCall;
    isExecuting?: boolean;
  };

export type TeamType = 'project' | 'rouge';

export interface Team {
  id: string;
  userId?: string;
  name: string;
  type: TeamType;
  description?: string;
  agents: Agent[];
  isSystem?: boolean;
  isLiveSpaceEnabled?: boolean;
}

export interface AIModelProfile {
  id: string;
  name: string;
  version: string;
  provider: 'google' | 'openai' | 'anthropic' | 'meta' | 'aws' | 'auto';
  modelId: string;
  icon: string;
  tagline: string;
  tags: string[];
  summary: string;
  strengths: string[];
  pros: string[];
  cons: string[];
  bestFor: string[];
  bestWhen: string[];
  defaultApiKey?: string;
  primaryUse: string;
  tone: string;
  performance: string;
  accessibility: string;
  supportedCapabilities: AgentCapability[];
}

export interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  category: string;
  tagline: string;
  icon: string;
  defaultModelId: string;
  defaultCapabilities: AgentCapability[];
  jobDescription: string;
  isLiveSpaceEnabled?: boolean;
}

export interface CustomGroupSuggestion {
  name: string;
  objective: string;
  specialists: Array<{
    name: string;
    role: string;
    jobDescription: string;
    icon: string;
    modelId?: string;
    suggestedModel?: string;
    capabilities?: AgentCapability[];
  }>;
}

export interface PostContent {
  caption: string;
  imageUrl: string;
  hashtags: string[];
}
