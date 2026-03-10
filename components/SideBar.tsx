
import React, { useState, useRef, useEffect } from 'react';
import { RamanIcon } from './icons/RamanIcon';
import { PrismIcon } from './icons/PrismIcon';
import { SpectrumIcon } from './icons/SpectrumIcon';
import { ChatIcon } from './icons/ChatIcon';
import { UserMapIcon } from './icons/UserMapIcon';
import { Agent, Team, UserProfile } from '../types';
import { EllipsisVerticalIcon } from './icons/EllipsisVerticalIcon';
import { BetaLockedWrapper } from './BetaLockedWrapper';
import { authService } from '../services/auth';

interface SideBarProps {
  activeView: 'home' | 'prism' | 'spectrum' | 'chats' | 'usermap';
  onViewChange: (view: 'home' | 'prism' | 'spectrum' | 'chats' | 'usermap') => void;
  onOpenProfile: () => void;
  agents: Agent[];
  teams: Team[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onDeleteTeam: (id: string) => void;
  onDeleteAgent?: (id: string) => void;
  onOpenFeedback: () => void;
  userProfile: UserProfile;
}

const ChatListItem: React.FC<{
  id: string;
  name: string;
  icon?: React.ReactNode;
  isActive: boolean;
  isSystem?: boolean;
  onClick: (id: string) => void;
  onDelete?: (id: string) => void;
}> = ({ id, name, icon, isActive, isSystem, onClick, onDelete }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`group relative flex items-center gap-2.5 w-full text-left p-2 rounded-lg text-sm transition-all duration-200 cursor-pointer border border-transparent ${isActive ? "bg-gray-800 dark:bg-white text-white dark:text-black font-bold" : "text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"}`}
      onClick={() => onClick(id)}
    >
      <div className={`flex-shrink-0 grayscale contrast-200 opacity-80 ${isActive ? 'text-white dark:text-black' : 'text-gray-400 dark:text-white/40 group-hover:text-gray-700 dark:group-hover:text-white/80'}`}>
        {icon || <span className="text-xs font-bold tracking-tighter uppercase">ID</span>}
      </div>
      <div className="flex-1 truncate font-medium uppercase tracking-widest text-[10px]">{name}</div>
      {!isSystem && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(id); }}
          className="p-1.5 rounded-md transition-all duration-200 opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-500/10 ml-auto"
          title="Delete"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
};

export function SideBar({
  activeView, onViewChange, onOpenProfile, agents, teams, activeChatId, onSelectChat, onDeleteTeam, onDeleteAgent, onOpenFeedback, userProfile
}: SideBarProps) {
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isChatSubSidebarCollapsed, setIsChatSubSidebarCollapsed] = useState(false);
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('connected');

  useEffect(() => {
    // AWS DynamoDB Active
    setDbStatus('connected');
  }, []);

  const toggleSubSidebar = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsChatSubSidebarCollapsed(!isChatSubSidebarCollapsed);
  };

  return (
    <div className="flex h-full z-30 transition-all duration-300 relative">
      {/* Navigation Rail */}
      <div className={`${isRailCollapsed ? 'w-14' : 'w-20'} bg-[#F8F9FA] dark:bg-[#1A1A1A] border-r border-black/10 dark:border-white/5 flex flex-col items-center py-6 space-y-8 flex-shrink-0 transition-all duration-300`}>
        <button onClick={() => onViewChange('home')} title="Home" className="p-2 text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-all transform hover:scale-110 flex flex-col items-center gap-2">
          <div className="relative">
            <RamanIcon size={32} />
            <span className="absolute -top-1 -right-3 text-[5px] font-black uppercase tracking-widest text-slate-500 border border-slate-600 rounded px-1 backdrop-blur-md">Beta</span>
          </div>
          {!isRailCollapsed && <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-900 dark:text-white">RamN AI</span>}
        </button>

        <nav className="flex flex-col items-center space-y-6 flex-1">
          <button
            onClick={() => onViewChange('prism')}
            className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'prism' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
            title="Prism Core"
          >
            <PrismIcon size={22} />
            {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Prism</span>}
          </button>

          <button
            onClick={() => onViewChange('spectrum')}
            className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'spectrum' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
            title="Spectrum Analysis"
          >
            <SpectrumIcon size={22} />
            {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Spectrum</span>}
          </button>

          <div className="relative">
            <button
              onClick={() => onViewChange('chats')}
              className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'chats' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
              title="Agent Chats"
            >
              <ChatIcon />
              {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Chats</span>}
            </button>

            {/* Toggle button circling around the chat icon area */}
            <button
              onClick={toggleSubSidebar}
              className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-all z-50 ${activeView === 'chats' ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none'}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`w-4 h-4 transition-transform duration-300 ${isChatSubSidebarCollapsed ? '' : 'rotate-180'}`}
              >
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </nav>

        <div className="flex flex-col items-center space-y-4 pb-4">

          <button
            onClick={onOpenFeedback}
            className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-center hover:border-black/20 dark:hover:border-white/20 transition-all group"
            title="Feedback"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-gray-500 dark:text-white/40 group-hover:text-amber-500 dark:group-hover:text-amber-400 group-hover:scale-110 transition-all"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12h9m-9 3h5.25m5.86 3.12A9 9 0 1 0 6.34 18.12L3 21l3.54-.89c.62-.15 1.27-.15 1.88 0Z" /></svg>
          </button>

          <button
            onClick={() => onViewChange('usermap')}
            className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'usermap' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
            title="Context UserMap"
          >
            <UserMapIcon size={22} />
            {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1">UserMap</span>}
          </button>

          <button
            onClick={onOpenProfile}
            className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center overflow-hidden hover:border-black dark:hover:border-white transition-all mt-2"
          >
            {userProfile.avatar ? <img src={userProfile.avatar} alt="Profile" className="w-full h-full object-cover" /> : <span className="text-[8px] font-bold">👤</span>}
          </button>
        </div>
      </div>

      {activeView === 'chats' && (
        <div className={`bg-[#F8F9FA] dark:bg-[#1A1A1A] border-r border-black/10 dark:border-white/5 flex flex-col transition-all duration-300 ${isChatSubSidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-64'}`}>
          <div className="h-16 flex items-center justify-between px-4 border-b border-black/5 dark:border-white/5 flex-shrink-0">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/80">Active Chats</h2>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6">
            {agents.filter(a => a.id !== 'prism-core').length === 0 && teams.length === 0 && (
              <div className="flex flex-col items-center text-center p-6 bg-white dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-2xl mx-2 shadow-sm dark:shadow-none">
                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 rounded-xl flex items-center justify-center mb-4">
                  <ChatIcon size={20} />
                </div>
                <h4 className="text-gray-900 dark:text-white font-black text-[10px] uppercase tracking-widest mb-2">No Conversations</h4>
                <p className="text-gray-500 dark:text-white/40 text-[9px] leading-relaxed mb-4">
                  Your communication matrix is clear. Instantiate an agent from the Spectrum to begin an operation.
                </p>
                <button
                  onClick={() => onViewChange('spectrum')}
                  className="w-full py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 dark:hover:bg-indigo-400 transition-colors shadow-md shadow-indigo-500/20"
                >
                  Open Spectrum
                </button>
              </div>
            )}

            {agents.length > 0 && (
              <div>
                <h3 className="text-[8px] font-black text-gray-400 dark:text-white/20 uppercase tracking-[0.3em] mb-3 px-2">Agents</h3>
                <div className="space-y-0.5">
                  {agents.filter(a => a.id !== 'prism-core').map(agent => (
                    <ChatListItem key={agent.id} id={agent.id} name={agent.name} isSystem={agent.isSystem} isActive={activeChatId === agent.id} onClick={onSelectChat} onDelete={onDeleteAgent} />
                  ))}
                </div>
              </div>
            )}

            {teams.length > 0 && (
              <div>
                <h3 className="text-[8px] font-black text-gray-400 dark:text-white/20 uppercase tracking-[0.3em] mb-3 px-2">Teams</h3>
                <div className="space-y-0.5">
                  {teams.map(team => (
                    <ChatListItem key={team.id} id={team.id} name={team.name} isSystem={team.isSystem} isActive={activeChatId === team.id} onClick={onSelectChat} onDelete={onDeleteTeam} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
