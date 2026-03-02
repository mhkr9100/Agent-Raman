
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
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}
            className={`p-1 rounded-md transition-opacity duration-200 ${isMenuOpen ? 'opacity-100 bg-black/10' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <EllipsisVerticalIcon />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-6 w-32 bg-white dark:bg-[#2A2A2A] border border-black/10 dark:border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden">
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(id); setIsMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-[10px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors uppercase tracking-widest font-bold"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function SideBar({
  activeView, onViewChange, onOpenProfile, agents, teams, activeChatId, onSelectChat, onDeleteTeam, onDeleteAgent, userProfile
}: SideBarProps) {
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isChatSubSidebarCollapsed, setIsChatSubSidebarCollapsed] = useState(false);
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('connected');

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim()) return;
    setIsSubmittingFeedback(true);
    try {
      const { dbService, STORES_ENUM } = await import('../services/db');
      await dbService.put(STORES_ENUM.FEEDBACK, {
        id: Date.now().toString(),
        userId: userProfile.id,
        text: feedback,
        createdAt: Date.now()
      });
      setFeedback('');
      setIsFeedbackModalOpen(false);
    } catch (error) {
      console.error("Failed to submit feedback", error);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

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
            title="Prism"
          >
            <PrismIcon size={22} />
            {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Prism</span>}
          </button>

          <button
            onClick={() => onViewChange('spectrum')}
            className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'spectrum' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
            title="Spectrum"
          >
            <SpectrumIcon size={22} />
            {!isRailCollapsed && <span className="text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Spectrum</span>}
          </button>

          <div className="relative">
            <button
              onClick={() => onViewChange('chats')}
              className={`flex flex-col items-center gap-1 group p-2 rounded-xl transition-all ${activeView === 'chats' ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/80'}`}
              title="Chats"
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
            onClick={() => setIsFeedbackModalOpen(true)}
            className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-center hover:border-black/20 dark:hover:border-white/20 transition-all group"
            title="Feedback"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-gray-500 dark:text-white/40 group-hover:text-amber-500 dark:group-hover:text-amber-400 group-hover:scale-110 transition-all"><path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785 0.5 0 00.337.839 7.737 7.737 0 004.388-1.723c.071-.051.147-.094.225-.135A6.07 6.07 0 0112 20.25z" /></svg>
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

      {/* FEEDBACK MODAL */}
      {isFeedbackModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="absolute inset-0"
            onClick={() => !isSubmittingFeedback && setIsFeedbackModalOpen(false)}
          />
          <div className="relative w-full max-w-md bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-6 animate-in slide-in-from-bottom-8 duration-300 text-gray-900 dark:text-white">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-display font-extrabold text-white tracking-tight">Got Feedback?</h2>
              <button
                onClick={() => !isSubmittingFeedback && setIsFeedbackModalOpen(false)}
                className="p-2 text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleFeedbackSubmit} className="flex flex-col gap-4">
              <textarea
                placeholder="Tell us what's on your mind. Bugs, features, or just weird vibes..."
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                disabled={isSubmittingFeedback}
                rows={4}
                className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 focus:border-black/40 dark:focus:border-white/40 rounded-xl p-4 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/30 resize-none outline-none transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!feedback.trim() || isSubmittingFeedback}
                className="w-full py-4 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 dark:hover:bg-slate-200 transition-all active:scale-95 shadow-xl disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmittingFeedback ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  'Send to Dev Team'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
