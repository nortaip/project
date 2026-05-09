import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  DollarSign,
  FileText,
  List,
  Trophy,
} from 'lucide-react';

interface TabItem {
  to: string;
  i18nKey: string;
  icon: React.ElementType;
  roles?: string[]; // undefined = visible to all allowed roles
}

const TABS: TabItem[] = [
  { to: '/account/opportunities', i18nKey: 'workspace.tabs.opportunities', icon: Briefcase, roles: ['provider'] },
  { to: '/account/offers',        i18nKey: 'workspace.tabs.offers',        icon: FileText,  roles: ['provider'] },
  { to: '/account/won',           i18nKey: 'workspace.tabs.won',           icon: Trophy,    roles: ['provider'] },
  { to: '/account/services',      i18nKey: 'workspace.tabs.services',      icon: List },
  { to: '/account/balance',       i18nKey: 'workspace.tabs.balance',       icon: DollarSign, roles: ['provider'] },
];

interface Props {
  userRole: string | null;
  children: ReactNode;
}

/**
 * Provider/admin workspace layout — sidebar yox, üstdə yapışıq tab-bar.
 * Tab-bar role-əsaslı filterlənir.
 */
export default function WorkspaceLayout({ userRole, children }: Props) {
  const { t } = useTranslation();
  const visibleTabs = TABS.filter(
    (tab) => !tab.roles || (userRole && tab.roles.includes(userRole)),
  );

  return (
    <div className="min-h-[calc(100vh-64px)] bg-surface-bg">
      {/* Sticky top tabs */}
      <div className="sticky top-16 z-30 bg-white border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 overflow-x-auto py-2 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    `shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold transition-all ${
                      isActive
                        ? 'bg-brand-gradient text-white shadow-brand-soft'
                        : 'text-ink-soft hover:bg-brand-50 hover:text-brand-700'
                    }`
                  }
                >
                  <Icon size={16} />
                  {t(tab.i18nKey)}
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </div>
    </div>
  );
}
