import React from "react";

const variantClasses = {
  primary: "bg-text-1 text-bg hover:bg-white",
  secondary: "bg-surface-2 text-text-1 hover:bg-surface-3",
  ghost: "bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2",
  quiet: "bg-transparent text-text-2 hover:text-text-1",
  danger: "bg-transparent text-danger hover:bg-danger/10"
};

const sizeClasses = {
  sm: "w-[3rem] h-[3rem] rounded-[6px]",
  md: "w-[3.6rem] h-[3.6rem] rounded-[6px]",
  lg: "w-[4rem] h-[4rem] rounded-[6px]"
};

const iconSizes = {
  sm: 14,
  md: 17,
  lg: 19
};

export function IconButton({
  icon: Icon,
  label,
  variant = "ghost",
  size = "md",
  disabled = false,
  className = "",
  type = "button",
  ...props
}) {
  const baseClasses =
    "inline-flex items-center justify-center border-0 transition-colors duration-150 select-none cursor-pointer active:scale-[0.96] disabled:opacity-45 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const variantStyle = variantClasses[variant] || variantClasses.ghost;
  const sizeStyle = sizeClasses[size] || sizeClasses.md;
  const iconSize = iconSizes[size] || 17;

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
