import React from 'react';

const variantClasses = {
  primary: 'bg-text-1 text-bg hover:bg-white font-semibold shadow-sh-1',
  secondary: 'bg-[#242528] text-text-1 hover:bg-[#2d2e33] border border-white/14',
  ghost: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border border-hairline',
  quiet: 'bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 border-0',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
  accent: 'bg-accent text-bg hover:bg-[#f2c968] font-semibold shadow-sh-1'
};

// Scaled for root html { font-size: 62.5% } so button text and hit targets match Modal/Tabs proportions.
const sizeClasses = {
  sm: 'px-[1.2rem] py-[0.65rem] text-[1.25rem] gap-[0.6rem] rounded-control',
  md: 'px-[1.6rem] py-[0.95rem] text-[1.35rem] gap-[0.8rem] rounded-[0.8rem]',
  lg: 'px-[2rem] py-[1.15rem] text-[1.5rem] gap-[1rem] rounded-[0.8rem]'
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
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-150 select-none cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
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
        <span className="inline-block h-[1.5rem] w-[1.5rem] animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
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
