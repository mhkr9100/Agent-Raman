
import React, { useState } from 'react';

interface BetaLockedWrapperProps {
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const BetaLockedWrapper: React.FC<BetaLockedWrapperProps> = ({ 
  children, 
  position = 'top',
  className = "" 
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div 
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      
      {isHovered && (
        <div className={`absolute ${positionClasses[position]} z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-200`}>
          <div className="bg-[#1A1A1A] border border-white/10 px-3 py-1.5 rounded-lg shadow-2xl backdrop-blur-xl whitespace-nowrap">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-white uppercase tracking-[0.2em]">
                Feature Locked in Beta
              </span>
            </div>
            {/* Tooltip Arrow */}
            <div className={`absolute w-2 h-2 bg-[#1A1A1A] border-r border-b border-white/10 rotate-45 ${
              position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -translate-y-1/2' :
              position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 translate-y-1/2' :
              position === 'left' ? 'left-full top-1/2 -translate-y-1/2 -translate-x-1/2' :
              'right-full top-1/2 -translate-y-1/2 translate-x-1/2'
            }`} />
          </div>
        </div>
      )}
    </div>
  );
};
