import React, { useState, useEffect } from 'react';
import { Agent, Team, GlobalTask } from '../../types';
import { XMarkIcon } from '../icons/XMarkIcon';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    label: string;
    scheduledTime: number;
    isRecurring: boolean;
    recurrenceType?: GlobalTask['recurrenceType'];
    recurrenceValue?: string;
    agentId: string;
    teamId?: string
  }) => void;
  agents: Agent[];
  activeAgent?: Agent;
  activeTeam?: Team;
  initialTask?: GlobalTask;
  isReadOnly?: boolean;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  agents,
  activeAgent,
  activeTeam,
  initialTask,
  isReadOnly = false
}) => {
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(new Date().toTimeString().split(' ')[0].slice(0, 5));
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<GlobalTask['recurrenceType']>('daily');
  const [recurrenceValue, setRecurrenceValue] = useState('');

  const pool = activeTeam ? activeTeam.agents : agents;
  const [selectedAgentId, setSelectedAgentId] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (initialTask) {
        setLabel(initialTask.label);
        const d = new Date(initialTask.scheduledTime || initialTask.createdAt);
        setDate(d.toISOString().split('T')[0]);
        setTime(d.toTimeString().split(' ')[0].slice(0, 5));
        setIsRecurring(initialTask.isRecurring || false);
        setRecurrenceType(initialTask.recurrenceType || 'daily');
        setRecurrenceValue(initialTask.recurrenceValue || '');
        setSelectedAgentId(initialTask.agentId);
      } else {
        setLabel('');
        setDate(new Date().toISOString().split('T')[0]);
        setTime(new Date().toTimeString().split(' ')[0].slice(0, 5));
        setIsRecurring(false);
        setRecurrenceType('daily');
        setRecurrenceValue('');
        setSelectedAgentId(activeAgent?.id || pool[0]?.id || '');
      }
    }
  }, [initialTask, isOpen, pool, activeAgent]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;

    const scheduledTime = new Date(`${date}T${time}`).getTime();

    onSubmit({
      label,
      scheduledTime,
      isRecurring,
      recurrenceType: isRecurring ? recurrenceType : undefined,
      recurrenceValue: isRecurring ? recurrenceValue : undefined,
      agentId: selectedAgentId,
      teamId: activeTeam?.id || initialTask?.teamId
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#050505] w-full max-w-md rounded-2xl shadow-2xl border border-white/20 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-black">
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-slate-300">△</span>
              {isReadOnly ? 'Directive Details' : initialTask ? 'Refine Directive' : 'Assign Directive'}
            </h2>
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest mt-1">Autonomous Mission Parameters</p>
          </div>
          <button onClick={onClose} className="hover:text-white text-slate-400 transition p-1">
            <XMarkIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto custom-scrollbar max-h-[75vh]">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Primary Objective</label>
            <textarea
              value={label}
              onChange={e => setLabel(e.target.value)}
              required
              rows={3}
              disabled={isReadOnly}
              placeholder="Input specialized instructions for the chatbot..."
              className="w-full bg-black border border-white/10 rounded-xl p-4 text-sm focus:border-white/30 outline-none text-white resize-none disabled:opacity-50 transition-all font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Activation Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={isReadOnly}
                className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm focus:border-white/30 outline-none text-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Execution Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                disabled={isReadOnly}
                className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm focus:border-white/30 outline-none text-white disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Executing ChatBot</label>
            <select
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value)}
              disabled={isReadOnly || (!!activeAgent && !activeTeam && !initialTask)}
              className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm focus:border-white/30 outline-none text-white disabled:opacity-50 appearance-none"
            >
              {pool.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
            </select>
            {activeTeam && <p className="text-[9px] text-slate-500 mt-2 italic font-mono uppercase tracking-tight">Routing directive within group spectrum</p>}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-xl">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-200">Autonomous Routine</span>
                <span className="text-[10px] text-slate-500 uppercase">Repeat mission periodically</span>
              </div>
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => setIsRecurring(!isRecurring)}
                className={`w-12 h-6 rounded-full transition-all relative disabled:opacity-50 ${isRecurring ? 'bg-white/20 shadow-[0_0_10px_rgba(255,255,255,0.15)]' : 'bg-slate-800'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm ${isRecurring ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {isRecurring && (
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4 animate-in slide-in-from-top-2 duration-300">
                <div>
                  <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest mb-2">Recurrence Frequency</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['daily', 'weekly', 'monthly', 'custom'] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setRecurrenceType(type)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${recurrenceType === type ? 'bg-white/15 border-white/30 text-white shadow-lg' : 'bg-black border-white/10 text-slate-500 hover:border-white/20'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {recurrenceType === 'custom' && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-300 uppercase tracking-widest mb-2">Custom Rule (e.g. Every 2 days)</label>
                    <input
                      type="text"
                      value={recurrenceValue}
                      onChange={e => setRecurrenceValue(e.target.value)}
                      disabled={isReadOnly}
                      placeholder="Enter interval logic..."
                      className="w-full bg-black border border-white/10 rounded-lg p-2.5 text-sm text-white focus:border-white/30 outline-none"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {!isReadOnly && (
            <button
              type="submit"
              className="w-full py-4 bg-white text-black hover:bg-white/90 font-bold rounded-xl shadow-xl shadow-white/10 transition-all active:scale-95 mt-2"
            >
              {initialTask ? 'Commit Updates' : 'Commit Mission'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
