import React, { useEffect, useMemo, useState } from 'react';
import type { ModuleDefinition, ModuleId } from '../../config/modules';
import {
  NavigationSidebar,
  type NavigationSidebarConfig,
  type NavigationSidebarItem,
  type NavigationSidebarSection,
} from '../navigation/NavigationSidebar';
import {
  fetchSidebarNavigationConfig,
  hydrateSidebarServices,
  type SidebarNavigationApiDto,
} from '../../navigation/sidebarMockApi';

function buildModuleHref(module: ModuleDefinition) {
  if (typeof window === 'undefined') return `?module=${encodeURIComponent(module.legacyId)}`;
  const url = new URL(window.location.href);
  url.searchParams.set('module', module.legacyId);
  return `${url.pathname}${url.search}${url.hash}`;
}

function moduleToNavigationItem(module: ModuleDefinition): NavigationSidebarItem {
  return {
    id: module.id,
    label: module.label,
    href: buildModuleHref(module),
    icon: module.icon,
    badge: module.badge,
    external: module.openNewTab,
  };
}

function findModuleByNavigationItem(
  item: NavigationSidebarItem,
  modules: ModuleDefinition[],
) {
  const byId = modules.find(module => module.id === item.id);
  if (byId) return byId;

  if (!item.href) return null;
  try {
    const url = new URL(item.href, window.location.origin);
    const moduleParam = url.searchParams.get('module');
    if (!moduleParam) return null;
    return modules.find(module => module.id === moduleParam || module.legacyId === moduleParam) || null;
  } catch {
    return null;
  }
}

const FALLBACK_NAVIGATION_DTO: SidebarNavigationApiDto = {
  brand: {
    title: 'Release Platform',
    mark: 'WB',
    version: 'v4',
  },
  serviceTitle: 'Сервисы',
  services: [],
};

export function Sidebar({
  sections,
  activeModule,
  currentUser,
  roleLabel,
  onActivate,
  onOpenSettings,
  onLogout,
}: {
  sections: Array<{ label: string; items: ModuleDefinition[] }>;
  activeModule: ModuleId;
  currentUser: string;
  roleLabel: string;
  onActivate: (module: ModuleDefinition) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [navigationDto, setNavigationDto] = useState<SidebarNavigationApiDto>(FALLBACK_NAVIGATION_DTO);

  useEffect(() => {
    let alive = true;
    fetchSidebarNavigationConfig()
      .then(dto => {
        if (alive) setNavigationDto(dto);
      })
      .catch(() => {
        if (alive) setNavigationDto(FALLBACK_NAVIGATION_DTO);
      });
    return () => {
      alive = false;
    };
  }, []);

  const flatModules = useMemo(
    () => sections.flatMap(section => section.items),
    [sections],
  );

  const navigationSections: NavigationSidebarSection[] = useMemo(() => sections.map(section => ({
    id: section.label,
    label: section.label,
    items: section.items.map(moduleToNavigationItem),
  })), [sections]);

  const config: NavigationSidebarConfig = useMemo(() => ({
    brand: navigationDto.brand,
    sections: navigationSections,
    activeItemId: activeModule,
    services: hydrateSidebarServices(navigationDto.services),
    serviceTitle: navigationDto.serviceTitle,
    profile: {
      name: currentUser,
      roleLabel,
    },
    profileActions: [
      {
        id: 'settings',
        label: '⚙',
        title: 'Настройки',
        onClick: onOpenSettings,
      },
      {
        id: 'logout',
        label: '↩',
        title: 'Выйти',
        tone: 'danger',
        onClick: onLogout,
      },
    ],
  }), [activeModule, currentUser, navigationDto, navigationSections, onLogout, onOpenSettings, roleLabel]);

  const handleNavigate = (item: NavigationSidebarItem) => {
    const module = findModuleByNavigationItem(item, flatModules);
    if (module) {
      onActivate(module);
      return;
    }
    if (item.href) window.location.assign(item.href);
  };

  return <NavigationSidebar config={config} onNavigate={handleNavigate} />;
}
