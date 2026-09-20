import React from 'react';

const variantClasses = {
  primary: 'bg-text-1 text-bg hover:bg-white font-semibold shadow-sh-1',
  secondary: 'bg-surface-2 text-text-1 hover:bg-surface-3 border border-hairline',
  ghost: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border border-hairline',
  quiet: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border-0',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
  accent: 'bg-accent text-bg hover:bg-[#f2c968] font-semibold shadow-sh-1'
};

const sizeClasses = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-control',
  md: 'px-3.5 py-2 text-sm gap-2 rounded-control',
  lg: 'px-4.5 py-2.5 text-base gap-2.5 rounded-control'
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-150 select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const variantStyle = variantClasses[variant] || variantClasses.primary;
  const sizeStyle = sizeClasses[size] || sizeClasses.md;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantStyle} ${sizeStyle} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        Icon && iconPosition === 'left' && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} aria-hidden="true" />
      )}
      <span>{children}</span>
      {!loading && Icon && iconPosition === 'right' && (
        <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} aria-hidden="true" />
      )}
    </button>
  );
}

export default Button;
