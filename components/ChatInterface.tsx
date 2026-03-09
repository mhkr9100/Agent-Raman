
import React, { useRef, useEffect } from 'react';
import { Message as MessageType, Agent as AgentType, CustomGroupSuggestion, ToolCall } from '../types';
import { Message } from './Message';
import { LoadingSpinner } from './LoadingSpinner';
import { PrismIcon } from './icons/PrismIcon';

interface ChatInterfaceProps {
  messages: MessageType[];
  isLoading: boolean;
  typingAgent?: AgentType | null;
  typingAgents?: { agent: AgentType; tasks: any[] }[];
  onAddEmployee: (employeeData: Omit<AgentType, 'id' | 'type'>) => void;
  onCreateGroup: (groupData: { name: string, agentIds: string[] }) => void;
  onConfigureNewAgent?: (profileId?: string, role?: string, jd?: string) => void;
  onDeployCustomGroup?: (suggestion: CustomGroupSuggestion) => void;
  onExecuteCommand?: (messageId: string, toolCall: ToolCall) => void;
  isPrism?: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  isLoading,
  typingAgent,
  typingAgents = [],
  onAddEmployee,
  onCreateGroup,
  onConfigureNewAgent,
  onDeployCustomGroup,
  onExecuteCommand,
  isPrism
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chatContainerRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;

    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, typingAgent, typingAgents]);

  const activeTypers = typingAgents.length > 0 ? typingAgents : (typingAgent ? [{ agent: typingAgent, tasks: [] }] : []);

  return (
    <div ref={chatContainerRef} className="flex-1 overflow-y-auto custom-scrollbar relative">
      {/* Static Background Brand Logo for Prism */}
      {isPrism && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] overflow-hidden">
          <PrismIcon size={500} className="grayscale brightness-200" />
        </div>
      )}

      <div className="mx-auto max-w-2xl lg:max-w-[48rem] xl:max-w-4xl space-y-6 px-4 py-8 relative z-10">
        {messages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            onAddEmployee={onAddEmployee}
            onCreateGroup={onCreateGroup}
            onConfigureNewAgent={onConfigureNewAgent}
            onDeployCustomGroup={onDeployCustomGroup}
            onExecuteCommand={onExecuteCommand}
          />
        ))}

        {/* Simultaneous Typing Indicators */}
        {isLoading && activeTypers.map((typerState, idx) => {
          const isTaskMode = typingAgents.length > 0;
          return (
            <div key={`${typerState.agent.id}-${idx}`} className="flex items-start gap-3 justify-start animate-fade-in mb-6">
              <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-xl flex-shrink-0 border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.08)]">
                {typerState.agent.icon}
              </div>
              <div className="flex flex-col gap-2 max-w-[80%]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-white/60 font-bold ml-1">{typerState.agent.name}</span>
                  {isTaskMode && (
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-gray-500/70 dark:bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                      <div className="w-1 h-1 bg-gray-500/70 dark:bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="w-1 h-1 bg-gray-500/70 dark:bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  )}
                </div>

                <div className={`p-3 px-4 rounded-2xl w-fit bg-slate-900 border border-white/10 rounded-bl-none shadow-md flex items-center min-h-[44px]`}>
                  {isTaskMode ? (
                    <div className="flex items-center gap-2">
                      <LoadingSpinner width={24} height={12} />
                      <span className="text-xs text-slate-500 italic">Thinking...</span>
                    </div>
                  ) : (
                    <div className="flex gap-1 py-1">
                      <div className="w-1.5 h-1.5 bg-gray-500/50 dark:bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                      <div className="w-1.5 h-1.5 bg-gray-500/50 dark:bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="w-1.5 h-1.5 bg-gray-500/50 dark:bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
    </div>
  );
};
