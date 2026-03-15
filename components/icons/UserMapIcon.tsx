
import React from 'react';
import { BrainCircuit } from 'lucide-react';

export function UserMapIcon({ size = 24, className = "" }: { size?: number, className?: string }) {
    return <BrainCircuit size={size} strokeWidth={2} className={className} />;
}
