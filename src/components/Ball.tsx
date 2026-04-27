import React from 'react';
import { cn } from '../lib/utils';

interface BallProps {
  number: number;
  category?: 'quentissimas' | 'quentes' | 'mornas' | 'frias' | 'geladas' | 'default';
  className?: string;
  highlighted?: boolean;
}

export const Ball: React.FC<BallProps> = ({ number, category = 'default', className, highlighted }) => {
  const categoryClasses = {
    quentissimas: 'cat-hot',
    quentes: 'cat-warm',
    mornas: 'cat-mild',
    frias: 'cat-cool',
    geladas: 'cat-cold',
    default: 'bg-slate-800 text-white',
  };

  return (
    <div className={cn(
      'ball select-none transition-transform hover:scale-110', 
      categoryClasses[category], 
      highlighted && 'bg-red-500 text-white border-white glow-red',
      className
    )}>
      {number.toString().padStart(2, '0')}
    </div>
  );
};
