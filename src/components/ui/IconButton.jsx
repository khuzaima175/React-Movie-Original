import React from 'react';

const variantClasses = {
  primary: 'bg-text-1 text-bg hover:bg-white shadow-sh-1',
  secondary: 'bg-surface-2 text-text-1 hover:bg-surface-3 border border-hairline',
  ghost: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border border-hairline',
  quiet: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border-0',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30'
};

const sizeClasses = {
  sm: 'w-7 h-7 p-1 rounded-control',
  md: 'w-9 h-9 p-2 rounded-control',
  lg: 'w-10 h-10 p-2.5 rounded-control'
};

const iconSizes = {
  sm: 14,
  md: 18,
  lg: 20
};

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center transition-all duration-150 select-none active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const variantStyle = variantClasses[variant] || variantClasses.ghost;
  const sizeStyle = sizeClasses[size] || sizeClasses.md;
  const iconSize = iconSizes[size] || 18;

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${baseClasses} ${variantStyle} ${sizeStyle} ${className}`}
      {...props}
    >
      {Icon && <Icon size={iconSize} aria-hidden="true" />}
    </button>
  );
}

export default IconButton;
