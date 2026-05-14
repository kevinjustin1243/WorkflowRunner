import type { SVGProps } from 'react'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function makeIcon(path: React.ReactNode, override?: Partial<IconProps>) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        {...override}
        {...rest}
      >
        {path}
      </svg>
    )
  }
}

export const Icons = {
  Dashboard: makeIcon(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>,
  ),
  Workflow: makeIcon(
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <path d="M8.2 6h7.6M18 8.2v7.6M15.8 18H8.2M6 15.8V8.2" />
    </>,
  ),
  History: makeIcon(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Inbox: makeIcon(
    <>
      <path d="M3 13l3-8h12l3 8" />
      <path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </>,
  ),
  Play: makeIcon(<path d="M7 4.5v15l13-7.5z" />),
  Pause: makeIcon(
    <>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </>,
  ),
  Stop: makeIcon(<rect x="5" y="5" width="14" height="14" rx="2" />),
  Plus: makeIcon(<path d="M12 5v14M5 12h14" />),
  Check: makeIcon(<path d="M5 12.5l4.5 4.5L19 7" />),
  X: makeIcon(<path d="M6 6l12 12M18 6L6 18" />),
  Search: makeIcon(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-3.5-3.5" />
    </>,
  ),
  Clock: makeIcon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Calendar: makeIcon(
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
  ),
  User: makeIcon(
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.5-3.5 4.5-5 7-5s5.5 1.5 7 5" />
    </>,
  ),
  Users: makeIcon(
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" />
      <path d="M15 5.5a3.2 3.2 0 0 1 0 6" />
      <path d="M17.5 14c2 .6 3.5 2.3 3.5 5" />
    </>,
  ),
  ChevronRight: makeIcon(<path d="M9 5l7 7-7 7" />),
  ChevronDown: makeIcon(<path d="M5 9l7 7 7-7" />),
  ChevronLeft: makeIcon(<path d="M15 5l-7 7 7 7" />),
  More: makeIcon(
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>,
  ),
  Edit: makeIcon(
    <>
      <path d="M4 20h4l11-11-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </>,
  ),
  Refresh: makeIcon(
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3" />
      <path d="M20 12a8 8 0 0 1-14 5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>,
  ),
  Filter: makeIcon(<path d="M4 5h16l-6 8v6l-4-2v-4z" />),
  Eye: makeIcon(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>,
  ),
  Diff: makeIcon(
    <>
      <path d="M9 3v18M5 7l4-4 4 4" />
      <path d="M15 21V3M19 17l-4 4-4-4" />
    </>,
  ),
  Alert: makeIcon(
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </>,
  ),
  Bell: makeIcon(
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 7 2 7H4s2-2 2-7z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>,
  ),
  GitBranch: makeIcon(
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10M8 9h5a3 3 0 0 1 3 3v-1" />
    </>,
  ),
  Sparkles: makeIcon(
    <>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" />
      <path d="M19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z" />
    </>,
  ),
  Shield: makeIcon(
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  ),
  Settings: makeIcon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>,
  ),
  Logs: makeIcon(<path d="M4 5h16M4 9h12M4 13h16M4 17h10" />),
  Chat: makeIcon(<path d="M21 11.5a7.5 7.5 0 0 1-11 6.6L4 20l1.9-5.6A7.5 7.5 0 1 1 21 11.5z" />),
  Logo: makeIcon(<path d="M5 12h4l3-7 4 14 3-7h-4" />, { strokeWidth: 2 }),
  Trash: makeIcon(
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </>,
  ),
}
