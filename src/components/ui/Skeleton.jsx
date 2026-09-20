import React from 'react';

export function Skeleton({ className = '', ...props }) {
  return (
    <div
      className={`relative overflow-hidden bg-surface-2 rounded-control before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmerSweep_1.8s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.06] before:to-transparent ${className}`}
      aria-hidden="true"
      {...props}
    />
  );
}

Skeleton.Poster = function SkeletonPoster({ className = '', aspectRatio = 'aspect-[2/3]' }) {
  return (
    <Skeleton className={`w-full ${aspectRatio} rounded-poster ${className}`} />
  );
};

Skeleton.Text = function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 rounded-control ${i === lines - 1 ? 'w-3/5' : 'w-full'}`}
        />
      ))}
    </div>
  );
};

Skeleton.Card = function SkeletonCard({ className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      <Skeleton.Poster />
      <Skeleton className="h-4 w-4/5 rounded-control" />
      <Skeleton className="h-3 w-2/5 rounded-control" />
    </div>
  );
};

export default Skeleton;
