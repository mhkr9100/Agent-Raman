
import React, { useState, useCallback } from 'react';
import { SideBar } from './components/SideBar';
import { ChatView } from './components/ChatView';
import { UserProfileModal } from './components/UserProfileModal';
import { CreateEntityModal } from './components/CreateEntityModal';
import { SpectrumView } from './components/SpectrumView';
import { ProfileSidebar } from './components/ProfileSidebar';
import { LoginScreen } from './components/LoginScreen';
import { HomeView } from './components/HomeView';
import { UserMapView } from './components/UserMapView';
import { WelcomeGuideModal } from './components/WelcomeGuideModal';
import { useScatter } from './hooks/useScatter';
import { useTasks } from './hooks/useTasks';
import { useUserMap } from './hooks/useUserMap';
import { useAppStore } from './store/useAppStore';
import { Agent, GlobalTask, Message, UserProfile } from './types';
import { AGENTS } from './constants';
import { ErrorBoundary } from './components/ErrorBoundary';

const App: React.FC = () => {
  const {
    currentUser, isInitializing, login, logout, userProfile, setUserProfile, agents, setAgents, teams, setTeams,
    activeChatId, setActiveChatId, isProcessing, typingAgent, typingAgents, prismStatus, orchestrationWeights, agentModes,
    handleSendMessage, handleExecuteCommand, injectOutputToChat, clearChat, loadChatHistory, recruitAgent, createTeam, deleteAgent, deleteTeam, processSilentDirective,
    rateLimitInfo,
    chatSessions, activeSessionId, startNewSession, resumeSession, getSessionsForEntity
  } = useScatter();

  const { globalTasks, updateTaskStatus, deleteTask, updateTask, handleAddGlobalTask } = useTasks(processSilentDirective);
  const { userMapTree, updateNode, deleteNode, addNode, consolidate, isConsolidating } = useUserMap(currentUser as UserProfile);

  const [activeView, setActiveView] = useState<'home' | 'prism' | 'spectrum' | 'chats' | 'usermap'>('home');
  const [createModalType, setCreateModalType] = useState<'agent' | 'project' | null>(null);
  const [createModalInitialValues, setCreateModalInitialValues] = useState<any>(undefined);

  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [isProfileSidebarOpen, setIsProfileSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (isInitializing) {
    return (
      <div className="h-screen w-screen bg-[#F8F9FA] dark:bg-[#1A1A1A] flex items-center justify-center transition-colors duration-300">
        <div className="text-gray-900 dark:text-white font-bold animate-pulse uppercase tracking-[0.5em] text-xs">
          Initializing RamN AI...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  const activeTeam = teams.find(g => g.id === activeChatId);
  const activeAgent = agents.find(e => e.id === activeChatId);
  const isPrism = activeChatId === 'prism-core';

  const handleHireFromSpectrum = (p: any) => {
    if ('modelId' in p) {
      setCreateModalInitialValues({ profileId: p.id, role: p.tags[0], jd: p.summary, isLiveSpaceEnabled: p.isLiveSpaceEnabled });
    } else {
      setCreateModalInitialValues({ profileId: p.defaultModelId, role: p.role, jd: p.jobDescription, name: p.name, isLiveSpaceEnabled: p.isLiveSpaceEnabled });
    }
    setCreateModalType('agent');
  };

  const handleInjectSystemMessage = (text: string) => {
    const sysMsg: Message = {
      id: `sys-${Date.now()}`,
      agent: AGENTS.PRISM,
      type: 'agent',
      content: { type: 'text', text: `[SYSTEM_SIGNAL]: ${text}` }
    };
    useAppStore.getState().setChatHistory(prev => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), sysMsg]
    }));
  };

  const profileData = isPrism ? { type: 'prism' as const, data: AGENTS.PRISM } : (activeTeam ? { type: 'team' as const, data: activeTeam } : (activeAgent ? { type: 'agent' as const, data: activeAgent } : null));

  const renderContent = () => {
    switch (activeView) {
      case 'home':
        return <HomeView onStartChat={() => { setActiveView('prism'); setActiveChatId('prism-core'); }} onOpenProfile={() => setIsUserProfileOpen(true)} />;
      case 'spectrum':
        return <SpectrumView onHire={handleHireFromSpectrum} onFabricateAgent={() => setCreateModalType('agent')} onInitializeGroup={() => setCreateModalType('project')} onOpenChat={(id) => { setActiveChatId(id); setActiveView('chats'); }} agents={agents} teams={teams} userProfile={userProfile} />;
      case 'usermap':
        return <UserMapView tree={userMapTree} isConsolidating={isConsolidating} onUpdateNode={updateNode} onDeleteNode={deleteNode} onAddNode={addNode} onConsolidate={consolidate} onOpenProfile={() => setIsUserProfileOpen(true)} />;

      default:
        // Automatically deselect Prism if we are supposed to be in 'chats' view and Prism is still active
        const showBlankState = activeView === 'chats' && isPrism;

        if (showBlankState) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center border-r border-gray-200 dark:border-white/5 bg-[#F8F9FA] dark:bg-[#1A1A1A] transition-colors duration-300">
              <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center mb-6 border border-black/10 dark:border-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-8 h-8 text-white/20">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494 3.32 3.32 0 0 0 2.822-3.237V9.72m-3.22 8.4A3.32 3.32 0 0 0 21 14.885V5.115a3.32 3.32 0 0 0-2.822-3.236A48.282 48.282 0 0 0 12 1.535c-2.11 0-4.18.173-6.208.494A3.32 3.32 0 0 0 3 5.115v9.77M12 10.5h.008v.008H12V10.5Z" />
                </svg>
              </div>
              <h3 className="text-white/40 font-black uppercase tracking-[0.2em] text-xs">No Agent Selected</h3>
              <p className="text-white/20 text-[10px] mt-2 font-medium">Select an agent or team from the sidebar to begin.</p>
            </div>
          );
        }

        return (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
              <div className="flex-1 overflow-hidden relative">
                <ChatView
                  isLoading={isProcessing} typingAgent={typingAgent} typingAgents={typingAgents as any}
                  onSubmit={handleSendMessage}
                  onAddAgent={recruitAgent} onCreateTeam={(data) => createTeam({ ...data, type: 'rouge' })}
                  onExecuteCommand={handleExecuteCommand}
                  onSaveToTasks={handleAddGlobalTask}
                  onInjectSystemMessage={handleInjectSystemMessage}
                  mentionCandidates={activeTeam ? activeTeam.agents : []} prismStatus={prismStatus} isGroup={!!activeTeam} orchestrationWeights={orchestrationWeights} agentModes={agentModes}
                  activeChatId={activeChatId}
                  activeAgent={activeAgent}
                  activeTeam={activeTeam}
                  rateLimitInfo={rateLimitInfo}
                  sessions={getSessionsForEntity(activeChatId)}
                  activeSessionId={activeSessionId || ''}
                  onResumeSession={(sessionId) => { const s = chatSessions.find(x => x.id === sessionId); if (s) resumeSession(s); }}
                  onStartNewSession={() => startNewSession(activeChatId)}
                  isProfileSidebarOpen={isProfileSidebarOpen}
                  onToggleProfileSidebar={() => setIsProfileSidebarOpen(!isProfileSidebarOpen)}
                />
              </div>
            </div>
            {profileData && (
              <ProfileSidebar
                isOpen={isProfileSidebarOpen} type={profileData.type} data={profileData.data as any} globalTasks={[]}
                onUpdateUserProfile={(p) => setUserProfile({ ...userProfile, ...p })}
                userProfile={userProfile}
                onClose={() => setIsProfileSidebarOpen(false)} onSaveAgent={(u) => setAgents(prev => prev.map(e => e.id === u.id ? u : e))} onSaveTeam={(u) => setTeams(prev => prev.map(g => g.id === u.id ? u : g))}
              />
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F9FA] text-gray-900 dark:bg-[#1A1A1A] dark:text-white font-sans selection:bg-black/10 dark:selection:bg-white/10 transition-colors duration-300">

      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div className={`fixed inset-y-0 left-0 z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 flex h-full`}>
        <SideBar
          activeView={activeView}
          onViewChange={(view) => {
            setActiveView(view);
            if (view === 'prism') setActiveChatId('prism-core');
            setIsMobileMenuOpen(false);
          }}
          onOpenProfile={() => {
            setIsUserProfileOpen(true);
            setIsMobileMenuOpen(false);
          }}
          agents={agents}
          teams={teams}
          activeChatId={activeChatId}
          onSelectChat={(id) => {
            setActiveChatId(id);
            setActiveView('chats');
            setIsMobileMenuOpen(false);
          }}
          onDeleteTeam={deleteTeam}
          onDeleteAgent={deleteAgent}
          userProfile={userProfile}
        />
      </div>

      <main className="flex-1 flex flex-col relative min-w-0 bg-[#F8F9FA] dark:bg-[#1A1A1A] transition-colors duration-300">
        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden absolute top-4 left-4 z-30 w-10 h-10 bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-xl flex items-center justify-center shadow-sm text-gray-900 dark:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>

        <ErrorBoundary fallback={
          <div className="flex-1 flex items-center justify-center p-8 text-center bg-[#F8F9FA] dark:bg-[#1A1A1A] transition-colors duration-300">
            <div>
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl mx-auto mb-4 flex items-center justify-center border border-red-500/20">⚠️</div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-red-400 to-rose-400 bg-clip-text text-transparent mb-2">Workspace Render Error</h2>
              <p className="text-white/40 max-w-sm mb-6">A component failure occurred while rendering the active view.</p>
              <button onClick={() => window.location.reload()} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 text-sm">Force Reload</button>
            </div>
          </div>
        }>
          {renderContent()}
        </ErrorBoundary>
      </main>

      {createModalType && (
        <CreateEntityModal isOpen={!!createModalType} type={createModalType === 'agent' ? 'employee' : 'project'} employees={agents} initialValues={createModalInitialValues} onClose={() => { setCreateModalType(null); setCreateModalInitialValues(undefined); }} onCreateEmployee={recruitAgent} onCreateGroup={createTeam} />
      )}

      {isUserProfileOpen && (
        <UserProfileModal user={userProfile} isOpen={isUserProfileOpen} onClose={() => setIsUserProfileOpen(false)} onSave={setUserProfile} onLogout={logout} />
      )}

      <WelcomeGuideModal onComplete={() => { }} />
    </div>
  );
};

export default App;
