
import React, { useState, useEffect } from 'react';
import { ChatInterface } from './ChatInterface';
import { InputBar } from './InputBar';
import { ScatterBottleVisual } from './ScatterBottleVisual';
import { Message, Agent as AgentType, CustomGroupSuggestion, ToolCall, Team, GlobalTask } from '../types';
import { RateLimitInfo } from '../hooks/useScatter';
import { useAppStore } from '../store/useAppStore';
import { PrismIcon } from './icons/PrismIcon';

interface ChatViewProps {
  isLoading: boolean;
  typingAgent?: AgentType | null;
  typingAgents?: { agent: AgentType; tasks: any[] }[];
  onSubmit: (
    prompt: string,
    steps: number,
    attachments?: File[],
    searchEnabled?: boolean,
    createEnabled?: boolean,
    prismMode?: 'ask' | 'create',
    requestedCapability?: 'auto' | 'web-search' | 'thinking'
  ) => void;
  onAddAgent: (agentData: Omit<AgentType, 'id' | 'type'>) => void;
  onCreateTeam: (teamData: { name: string, agentIds: string[] }) => void;
  onExecuteCommand?: (messageId: string, toolCall: ToolCall) => void;

  onSaveToTasks?: (task: Omit<GlobalTask, 'id' | 'createdAt'>) => void;
  onInjectSystemMessage?: (text: string) => void;
  mentionCandidates: AgentType[];
  onConfigureNewAgent?: (profileId?: string, role?: string, jd?: string) => void;
  onDeployCustomTeam?: (suggestion: CustomGroupSuggestion) => void;
  prismStatus: string;
  isGroup?: boolean;
  orchestrationWeights?: Record<string, number>;
  agentModes?: Record<string, 'CHAT' | 'SOLUTION' | 'TASK' | 'VOID'>;
  activeChatId?: string;
  activeAgent?: AgentType;
  activeTeam?: Team;
  rateLimitInfo?: RateLimitInfo;
  // Profile sidebar controls
  isProfileSidebarOpen?: boolean;
  onToggleProfileSidebar?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  isLoading, typingAgent, typingAgents = [], onSubmit, onAddAgent, onCreateTeam, onExecuteCommand, onSaveToTasks, onInjectSystemMessage, mentionCandidates, onConfigureNewAgent, onDeployCustomTeam, prismStatus, isGroup = false, orchestrationWeights = {}, agentModes = {}, activeChatId, activeAgent, activeTeam,
  rateLimitInfo,
  isProfileSidebarOpen, onToggleProfileSidebar
}) => {
  const isDispatching = prismStatus !== "";
  const activatedIds = typingAgents.length > 0 ? typingAgents.map(a => a.agent.id) : (typingAgent ? [typingAgent.id] : []);

  const messages = useAppStore(state => activeChatId ? (state.chatHistory[activeChatId] || []) : []);

  const canOpenLiveSpace = (activeAgent?.isLiveSpaceEnabled) || (activeTeam?.isLiveSpaceEnabled);
  const isPrism = activeChatId === 'prism-core';
  const isRateLimited = rateLimitInfo?.blocked ?? false;

  return (
    <div className="flex flex-col h-full w-full relative">
      {/* HEADER: Moved session controls and + button here */}
      <div className="h-16 flex items-center justify-between pl-16 pr-6 md:pl-6 border-b border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#141619]/90 backdrop-blur-xl z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-sm">
            {isPrism ? <PrismIcon size={18} className="text-gray-900 dark:text-white" /> : (activeAgent?.icon || (activeTeam ? '👥' : '🤖'))}
          </div>
          <div className="flex flex-col">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-900 dark:text-white">
              {isPrism ? 'Prism Core' : activeAgent?.name || activeTeam?.name || 'Active Session'}
            </h2>
            <span className="text-[8px] font-bold text-gray-500 dark:text-white/30 uppercase tracking-widest mt-0.5">
              {isPrism ? 'Meta Architect' : activeAgent?.role || 'Group'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Info Button */}
          <button
            onClick={onToggleProfileSidebar}
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all cursor-help ${isProfileSidebarOpen
              ? 'bg-gray-900 dark:bg-white border-transparent text-white dark:text-black'
              : 'border-black/10 dark:border-white/10 text-gray-500 dark:text-white/20 hover:text-gray-900 dark:hover:text-white hover:border-black/20 dark:hover:border-white/20 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            title={isPrism ? 'Prism Profile' : activeTeam ? 'Group Profile' : 'ChatBot Profile'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative bg-[#F8F9FA] dark:bg-[#111315]">
        <ChatInterface
          messages={messages}
          isLoading={isLoading}
          typingAgent={typingAgent}
          typingAgents={typingAgents}
          onAddEmployee={onAddAgent}
          onCreateGroup={onCreateTeam}
          onConfigureNewAgent={onConfigureNewAgent}
          onDeployCustomGroup={onDeployCustomTeam}
          onExecuteCommand={onExecuteCommand}
          isPrism={isPrism}
        />
      </div>

      {/* Rate Limit Banner */}
      {isRateLimited && rateLimitInfo && (
        <div className="mx-4 mb-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
          <span className="text-lg">⏳</span>
          <div className="flex-1">
            <p className="text-[11px] font-bold text-amber-300/90 uppercase tracking-wider">
              Rate Limit Reached — {rateLimitInfo.limit - rateLimitInfo.remaining}/{rateLimitInfo.limit} Requests Used
            </p>
            <p className="text-[10px] text-amber-200/50 mt-0.5">
              {rateLimitInfo.resetTimeFormatted
                ? `Your limit resets at ${rateLimitInfo.resetTimeFormatted}. Check back then.`
                : 'Your limit will reset in about an hour.'}
            </p>
          </div>
        </div>
      )}



      <div className="relative w-full">
        <InputBar
          onSubmit={onSubmit}
          isLoading={isLoading || isRateLimited}
          mentionCandidates={mentionCandidates}
          isGroup={isGroup}
          isPrism={isPrism}
        />
      </div>
    </div>
  );
};
