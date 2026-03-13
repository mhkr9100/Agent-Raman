
import { Agent } from '../types';
import React, { useEffect, useState, useRef } from 'react';

interface ScatterBottleVisualProps {
    isRolling: boolean;
    activeAgents: Agent[];
    selectedIds: string[];
    weights?: Record<string, number>;
    agentModes?: Record<string, 'CHAT' | 'SOLUTION' | 'TASK' | 'VOID'>;
}

/**
 * THE SPECTRAL SENTINEL (v4.5)
 * ARCHIVED: Automatic clock routing logic.
 * NEW: Reactive sentinel system highlighting mentioned agents in a fixed spectrum.
 */
export const ScatterBottleVisual: React.FC<ScatterBottleVisualProps> = ({
    isRolling,
    activeAgents,
    selectedIds,
    weights = {},
}) => {
    // Filter out Prism from the orbital ring
    const specialists = activeAgents.filter(a => a.id !== 'prism-core' && a.id !== 'prism-core-member');

    const [rotations, setRotations] = useState<Record<string, number>>({});

    useEffect(() => {
        const initialRots: Record<string, number> = {};
        specialists.forEach((agent, i) => {
            initialRots[agent.id] = (i / specialists.length) * 360;
        });
        setRotations(initialRots);
    }, [specialists.length]);

    if (!isRolling && selectedIds.length === 0 && Object.keys(weights).length === 0) return null;

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden bg-black/5">
            {/* The 3D Ambient Core */}
            <div className={`absolute w-[1200px] h-[1200px] bg-emerald-500/[0.015] rounded-full blur-[180px] transition-opacity duration-1000 ${isRolling ? 'opacity-50' : 'opacity-10'}`} />

            <div className="relative w-[800px] h-[800px] flex items-center justify-center">

                {/* THE PRISM AXIS */}
                <div className="relative z-40 flex flex-col items-center">
                    <div className="absolute -top-64 -bottom-64 w-px bg-gradient-to-b from-transparent via-emerald-500/20 to-transparent" />

                    <div className={`w-24 h-24 bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[2rem] flex items-center justify-center shadow-[0_0_80px_rgba(16,185,129,0.08)] transition-all duration-1000 ${isRolling ? 'rotate-90 scale-105 border-emerald-500/20' : 'rotate-45'}`}>
                        <div className="w-4 h-4 rounded-full bg-emerald-400 opacity-20 blur-xl animate-pulse" />
                    </div>
                </div>

                {/* THE SENTINEL HANDS - Now strictly for Mention selection */}
                {specialists.map((agent, i) => {
                    const isSelected = selectedIds.includes(agent.id);
                    const currentRotation = rotations[agent.id] || 0;
                    const verticalOffset = (i - specialists.length / 2) * 12;

                    return (
                        <div
                            key={`hand-${agent.id}`}
                            className="absolute inset-0 transition-transform duration-[1200ms] cubic-bezier(0.19, 1, 0.22, 1)"
                            style={{
                                transform: `rotate(${currentRotation}deg)`,
                                zIndex: 10 + i
                            }}
                        >
                            {/* The Light Filaments */}
                            <div
                                className={`absolute top-0 left-1/2 -translate-x-1/2 origin-bottom transition-all duration-1000 ${isSelected ? 'opacity-40 h-[300px]' : 'opacity-0 h-[0px]'}`}
                                style={{
                                    width: '1px',
                                    background: 'linear-gradient(to top, #10b981, transparent)',
                                    transform: `translateY(${-verticalOffset}px)`
                                }}
                            />

                            {/* The Mentioned Sentinel Node */}
                            <div
                                className={`absolute left-1/2 -translate-x-1/2 transition-all duration-1000 ${isSelected ? 'opacity-100 scale-110 translate-y-[-320px]' : 'opacity-0 scale-50 translate-y-[0px]'}`}
                                style={{ transform: `rotate(${-currentRotation}deg)` }}
                            >
                                <div className="w-14 h-14 rounded-2xl border border-emerald-500/40 flex flex-col items-center justify-center bg-black/90 shadow-[0_0_30px_rgba(16,185,129,0.25)] backdrop-blur-2xl">
                                    <span className="text-xl">{agent.icon}</span>
                                    <div className="absolute -top-8 w-max">
                                        <span className="text-[7px] font-black uppercase text-emerald-300 tracking-[0.2em] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 animate-pulse">Mentioned</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* THE ORBITAL RIM (Static placeholders) */}
                {specialists.map((agent, i) => {
                    const angle = (i / specialists.length) * 360;
                    const radius = 340;
                    const x = Math.cos((angle - 90) * (Math.PI / 180)) * radius;
                    const y = Math.sin((angle - 90) * (Math.PI / 180)) * radius;

                    const isSelected = selectedIds.includes(agent.id);

                    return (
                        <div
                            key={`spectrum-${agent.id}`}
                            className={`absolute w-12 h-12 rounded-2xl border flex flex-col items-center justify-center transition-all duration-700 z-50 ${isSelected ? 'bg-white border-white text-black scale-100 opacity-100' : 'bg-transparent border-white/5 text-white/5 scale-90 opacity-20 hover:opacity-40'}`}
                            style={{ transform: `translate(${x}px, ${y}px)` }}
                        >
                            <span className="text-lg">{agent.icon}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
