/**
 * session-detail/TabBar.tsx — Tab navigation component.
 */

import { motion } from 'framer-motion';
import type { TabId } from './types';
import { useT } from '../../i18n/context';

interface TabConfig {
  id: TabId;
  label: string;
}

interface TabBarProps {
  tabs: TabConfig[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  const t = useT();
  return (
    <div className="relative flex gap-2 py-1 overflow-x-auto scrollbar-none" role="tablist" aria-label={t('aria.sessionDetailTabs')}>
      {tabs.map((tab) => (
        <button type="button"
          key={tab.id}
          id={`tab-${tab.id}`}
          onClick={() => onTabChange(tab.id)}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className={`relative z-10 min-h-[36px] rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? 'text-[var(--color-void)] dark:text-[var(--color-text-primary)]'
              : 'border border-[var(--color-void-lighter)] bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTabIndicator"
              className="absolute inset-0 bg-[var(--color-cta-bg)] rounded-full shadow-sm"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ zIndex: -1 }}
            />
          )}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
