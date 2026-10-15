import React from 'react';

export function SeerLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="none"
      className={className}
      aria-label="Seer Eye of Providence Logo"
    >
      <rect width="256" height="256" rx="44" fill="#F5EDE0" />
      <path
        d="M128 26 L232 214 L24 214 Z"
        stroke="#213A24"
        strokeWidth="6"
        strokeLinejoin="round"
        fill="#F5EDE0"
      />
      <path
        d="M128 38 L220 206 L36 206 Z"
        stroke="#213A24"
        strokeWidth="2.2"
        strokeDasharray="6 4"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M114 58 Q128 55 142 58" stroke="#213A24" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M106 70 Q128 66 150 70" stroke="#213A24" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M98 82 Q128 77 158 82" stroke="#213A24" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M90 94 Q128 87 166 94" stroke="#213A24" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M84 108 Q106 96 128 102 Q150 96 172 108"
        stroke="#213A24"
        strokeWidth="4.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M78 115 Q104 103 128 108 Q152 103 178 115"
        stroke="#213A24"
        strokeWidth="2.5"
        strokeDasharray="8 3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M62 140 L84 118 M54 156 L78 130 M46 172 L74 144 M40 190 L72 158"
        stroke="#213A24"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M194 140 L172 118 M202 156 L178 130 M210 172 L182 144 M216 190 L184 158"
        stroke="#213A24"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M52 204 L76 176 M68 204 L88 180 M84 204 L98 184 M102 204 L110 188 M120 204 L123 190 M136 204 L133 190 M154 204 L146 188 M172 204 L158 184 M188 204 L168 180 M204 204 L180 176"
        stroke="#213A24"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M68 148 Q128 102 188 148 Q128 194 68 148 Z"
        fill="#F5EDE0"
        stroke="#213A24"
        strokeWidth="6.2"
        strokeLinejoin="round"
      />
      <path
        d="M75 148 Q128 110 181 148 Q128 186 75 148 Z"
        stroke="#213A24"
        strokeWidth="2"
        strokeDasharray="5 3"
        fill="none"
      />
      <circle cx="128" cy="146" r="28" fill="#213A24" />
      <circle
        cx="128"
        cy="146"
        r="23"
        stroke="#F5EDE0"
        strokeWidth="2.2"
        strokeDasharray="14 6"
        fill="none"
      />
      <circle
        cx="128"
        cy="146"
        r="18"
        stroke="#F5EDE0"
        strokeWidth="2"
        strokeDasharray="10 5"
        fill="none"
      />
      <circle
        cx="128"
        cy="146"
        r="13"
        stroke="#F5EDE0"
        strokeWidth="1.8"
        strokeDasharray="8 4"
        fill="none"
      />
      <circle cx="116" cy="138" r="5" fill="#F5EDE0" />
      <circle cx="138" cy="135" r="2.5" fill="#F5EDE0" />
      <path
        d="M78 164 Q128 198 178 164"
        stroke="#213A24"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
