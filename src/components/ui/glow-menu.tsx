import * as React from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

type GlowMenuCSSProperties = React.CSSProperties & {
  '--menu-accent': string;
  '--menu-glow': string;
  '--menu-soft': string;
  '--menu-border': string;
  '--menu-rgb': string;
  '--menu-hover': string;
};

export type GlowMenuAccent = {
  accent: string;
  hover: string;
  glow: string;
  soft: string;
  border: string;
  rgb: string;
};

export type GlowMenuItem<T extends string = string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  href?: string;
  description?: string;
  accent?: Partial<GlowMenuAccent>;
  disabled?: boolean;
};

export type MenuBarProps<T extends string = string> = Omit<React.HTMLAttributes<HTMLElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> & {
  items: GlowMenuItem<T>[];
  activeItem?: T;
  onItemClick?: (id: T) => void;
};

const itemVariants = {
  initial: { rotateX: 0, opacity: 1 },
  hover: {
    rotateX: -90,
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
  },
};

const backVariants = {
  initial: { rotateX: 90, opacity: 0 },
  hover: {
    rotateX: 0,
    opacity: 1,
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  },
};

const glowVariants = {
  initial: { opacity: 0, scale: 0.72 },
  hover: {
    opacity: 1,
    scale: 1.4,
    transition: {
      opacity: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
      scale: { duration: 0.42, type: 'spring', stiffness: 300, damping: 24 },
    },
  },
  active: {
    opacity: 0.82,
    scale: 1.12,
    transition: { duration: 0.34, ease: [0.4, 0, 0.2, 1] },
  },
};

const sharedTransition = {
  type: 'spring' as const,
  stiffness: 170,
  damping: 22,
};

const defaultAccent: GlowMenuAccent = {
  accent: 'var(--accent)',
  hover: 'var(--accent-hover)',
  glow: 'var(--accent-glow)',
  soft: 'var(--accent-soft)',
  border: 'var(--accent-border)',
  rgb: 'var(--accent-rgb)',
};

export function MenuBar<T extends string>({
  className,
  items,
  activeItem,
  onItemClick,
  ...props
}: MenuBarProps<T>) {
  const menuRef = React.useRef<HTMLElement | null>(null);

  const moveFocus = (index: number, select = false) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-glow-menu-item]');
    if (!buttons?.length) return;
    const nextIndex = (index + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
    if (select) onItemClick?.(items[nextIndex].id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') moveFocus(0, true);
    if (event.key === 'End') moveFocus(items.length - 1, true);
    if (event.key === 'ArrowLeft') moveFocus(index - 1, true);
    if (event.key === 'ArrowRight') moveFocus(index + 1, true);
  };

  return (
    <motion.nav
      ref={menuRef}
      className={['glow-menu', className].filter(Boolean).join(' ')}
      style={{ '--menu-count': items.length } as React.CSSProperties}
      initial="initial"
      aria-label={props['aria-label'] ?? '文件操作'}
      {...props}
    >
      <span className="glow-menu-sheen" aria-hidden="true" />
      <ul className="glow-menu-list" role="tablist">
        {items.map((item, index) => {
          const Icon = item.icon;
          const isActive = item.id === activeItem;
          const accent = { ...defaultAccent, ...item.accent };
          const itemStyle = {
            '--menu-accent': accent.accent,
            '--menu-hover': accent.hover,
            '--menu-glow': accent.glow,
            '--menu-soft': accent.soft,
            '--menu-border': accent.border,
            '--menu-rgb': accent.rgb,
          } as GlowMenuCSSProperties;

          return (
            <li className="glow-menu-item" key={item.id}>
              <motion.div
                className={`glow-menu-item-shell ${isActive ? 'is-active' : ''}`}
                style={itemStyle}
                initial="initial"
                whileHover={item.disabled ? undefined : 'hover'}
                whileFocus={item.disabled ? undefined : 'hover'}
              >
                <motion.span className="glow-menu-item-glow" variants={glowVariants} animate={isActive ? 'active' : 'initial'} aria-hidden="true" />
                <motion.span className="glow-menu-item-outline" aria-hidden="true" />
                <button
                  type="button"
                  className="glow-menu-item-button"
                  data-glow-menu-item="true"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={item.description ? `${item.label}：${item.description}` : item.label}
                  disabled={item.disabled}
                  onClick={() => onItemClick?.(item.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <motion.span
                    className="glow-menu-face glow-menu-face-front"
                    variants={itemVariants}
                    transition={sharedTransition}
                  >
                    <Icon aria-hidden="true" strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </motion.span>
                  <motion.span
                    className="glow-menu-face glow-menu-face-back"
                    variants={backVariants}
                    transition={sharedTransition}
                    aria-hidden="true"
                  >
                    <Icon aria-hidden="true" strokeWidth={2.1} />
                    <span>{item.label}</span>
                  </motion.span>
                </button>
              </motion.div>
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}
