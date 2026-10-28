/** Rocketing rocket mark (green tile), used on the public pages. */
export function RocketIcon({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect width="100" height="100" rx="22" fill="url(#rocketingGreenGrad)" />
      <g transform="translate(50, 50) scale(1.5) translate(-26, -28)">
        <path d="M26 5 L36 24 L26 20 L16 24 Z" fill="#080808" />
        <path d="M16 24 L11 35 L20 30 Z" fill="#1A1A1A" />
        <path d="M36 24 L41 35 L32 30 Z" fill="#1A1A1A" />
        <path d="M20 30 L26 20 L32 30 L26 46 Z" fill="#242424" />
        <path d="M23 43 L26 50 L29 43 L26 40 Z" fill="#080808" opacity="0.7" />
        <circle cx="26" cy="19" r="3" fill="#16A34A" />
        <circle cx="26" cy="19" r="1.5" fill="#15803D" />
      </g>
      <defs>
        <linearGradient id="rocketingGreenGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
    </svg>
  );
}
