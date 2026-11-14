import React from "react";

const variantClasses = {
  primary: "bg-text-1 text-bg hover:bg-white font-semibold",
  secondary: "bg-surface-2 text-text-1 hover:bg-surface-3 font-medium",
  ghost: "bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-2 font-medium",
  quiet: "bg-transparent text-text-2 hover:text-text-1 font-medium",
  danger: "bg-transparent text-danger hover:bg-danger/10 font-medium",
  accent: "bg-text-1 text-bg hover:bg-white font-semibold"
};

const sizeClasses = {
  sm: "px-[1.2rem] py-[0.65rem] text-[1.25rem] gap-[0.6rem] rounded-[6px]",
  md: "px-[1.6rem] py-[0.95rem] text-[1.35rem] gap-[0.75rem] rounded-[6px]",
  lg: "px-[2.2rem] py-[1.15rem] text-[1.45rem] gap-[0.9rem] rounded-[6px]"
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  ...props
}) {
  const baseClasses =
    "inline-flex items-center justify-center border-0 whitespace-nowrap [&_svg]:shrink-0 transition-colors duration-150 select-none cursor-pointer active:scale-[0.99] disabled:opacity-45 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
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
        <span
          className="inline-block h-[1.4rem] w-[1.4rem] animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        Icon && iconPosition === "left" && (
          <Icon size={size === "sm" ? 14 : size === "lg" ? 17 : 15} aria-hidden="true" />
        )
      )}
      {typeof children === "string" || typeof children === "number" ? (
        <span>{children}</span>
      ) : (
        children
      )}
      {!loading && Icon && iconPosition === "right" && (
        <Icon size={size === "sm" ? 14 : size === "lg" ? 17 : 15} aria-hidden="true" />
      )}
    </button>
  );
}

export default Button;
