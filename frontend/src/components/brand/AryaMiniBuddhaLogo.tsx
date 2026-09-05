import type { SVGProps } from "react";

interface AryaMiniBuddhaLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export function AryaMiniBuddhaLogo({ size = 34, className, ...props }: AryaMiniBuddhaLogoProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="arya-buddha-gradient" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7bc3ff" />
          <stop offset="1" stopColor="#2f80ed" />
        </linearGradient>
      </defs>

      <path
        d="M24 9.5c2.95 0 5.35 2.37 5.35 5.29 0 2.92-2.4 5.29-5.35 5.29-2.95 0-5.35-2.37-5.35-5.29 0-2.92 2.4-5.29 5.35-5.29Z"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.3 24.1c1.47-2.39 3.92-3.83 6.7-3.83 2.77 0 5.22 1.44 6.7 3.83"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M15.4 30.1c2.12-2.17 5.05-3.41 8.6-3.41 3.55 0 6.48 1.24 8.6 3.41"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M12.7 34.55c2.92-1.97 6.65-3.02 11.3-3.02 4.65 0 8.38 1.05 11.3 3.02"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M14.5 39.1c1.76-2.18 3.62-3.27 5.57-3.27 1.78 0 3.08.74 3.93 2.22 0.85-1.48 2.16-2.22 3.92-2.22 1.97 0 3.83 1.09 5.58 3.27"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 6.2c.84 0 1.52.67 1.52 1.5S24.84 9.2 24 9.2s-1.52-.67-1.52-1.5.68-1.5 1.52-1.5Z"
        fill="url(#arya-buddha-gradient)"
      />
      <path
        d="M9.1 18.75c1.12 1.7 2.7 2.56 4.74 2.56 1.31 0 2.5-.42 3.58-1.26"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity=".88"
      />
      <path
        d="M38.9 18.75c-1.12 1.7-2.7 2.56-4.74 2.56-1.31 0-2.5-.42-3.58-1.26"
        stroke="url(#arya-buddha-gradient)"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity=".88"
      />
    </svg>
  );
}
