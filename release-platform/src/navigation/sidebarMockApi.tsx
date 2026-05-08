import React from 'react';
import type { ServiceLauncherItem } from '../components/layout/ServiceLauncher';

export const SIDEBAR_NAVIGATION_ENDPOINT = '/api/navigation/sidebar';

type SidebarServiceIcon = 'learnhub' | 'project' | 'grid' | 'book' | 'chart' | 'link' | 'text';

export interface SidebarNavigationServiceDto {
  id: string;
  label: string;
  href: string;
  color: string;
  icon?: SidebarServiceIcon;
  iconLabel?: string;
  target?: '_blank' | '_self';
}

export interface SidebarNavigationApiDto {
  brand: {
    title: string;
    mark: string;
    version: string;
  };
  serviceTitle: string;
  services: SidebarNavigationServiceDto[];
}

declare global {
  interface Window {
    __releasePlatformSidebarNavigationMockInstalled?: boolean;
    __releasePlatformOriginalFetch?: typeof fetch;
  }
}

const MOCK_SIDEBAR_NAVIGATION: SidebarNavigationApiDto = {
  brand: {
    title: 'Release Platform',
    mark: 'WB',
    version: 'v4',
  },
  serviceTitle: 'Сервисы',
  services: [
    {
      id: 'learnhub',
      label: 'Learning\nHub',
      href: 'https://releaseteamwb.ru/LearnHub-Portal.html',
      color: 'linear-gradient(135deg,#7C3AED,#9B5CFF)',
      icon: 'learnhub',
    },
    {
      id: 'project',
      label: 'Project',
      href: 'http://10.29.47.57',
      color: 'linear-gradient(135deg,#0EA5E9,#0369A1)',
      icon: 'project',
    },
  ],
};

function graduationIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3.53 1.67 8.47 1.67 12 0v-5" />
    </svg>
  );
}

function gridIcon(size = 22, stroke = '#fff') {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function bookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v12H8.5A3.5 3.5 0 0 1 5 16.5z" />
      <path d="M8.5 4.5A3.5 3.5 0 0 0 5 8v8.5" />
      <path d="M9 9h5M9 12h6" />
    </svg>
  );
}

function chartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <rect x="7" y="11" width="3" height="5" rx="1" />
      <rect x="12" y="7" width="3" height="9" rx="1" />
      <rect x="17" y="9" width="3" height="7" rx="1" />
    </svg>
  );
}

function linkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07" />
    </svg>
  );
}

function textIcon(label: string) {
  return (
    <span style={{ color: '#fff', fontSize: 14, fontWeight: 800, lineHeight: 1 }} aria-hidden="true">
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function serviceIcon(item: SidebarNavigationServiceDto) {
  if (item.iconLabel) return textIcon(item.iconLabel);
  if (item.icon === 'learnhub') return graduationIcon();
  if (item.icon === 'project' || item.icon === 'grid') return gridIcon();
  if (item.icon === 'book') return bookIcon();
  if (item.icon === 'chart') return chartIcon();
  if (item.icon === 'link') return linkIcon();
  if (item.icon === 'text') return textIcon(item.label);
  return gridIcon();
}

export function hydrateSidebarServices(items: SidebarNavigationServiceDto[]): ServiceLauncherItem[] {
  return items.map(item => ({
    id: item.id,
    label: item.label,
    href: item.href,
    color: item.color,
    icon: serviceIcon(item),
    target: item.target,
  }));
}

export function installSidebarNavigationMockApi() {
  if (typeof window === 'undefined' || window.__releasePlatformSidebarNavigationMockInstalled) return;
  if (typeof window.fetch !== 'function') return;

  const originalFetch = window.fetch.bind(window);
  window.__releasePlatformOriginalFetch = window.__releasePlatformOriginalFetch || window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(rawUrl, window.location.origin);

    if (url.pathname === SIDEBAR_NAVIGATION_ENDPOINT) {
      return new Response(JSON.stringify(MOCK_SIDEBAR_NAVIGATION), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Mock-Source': 'release-platform-navigation-kit',
        },
      });
    }

    return originalFetch(input, init);
  };

  window.__releasePlatformSidebarNavigationMockInstalled = true;
}

export async function fetchSidebarNavigationConfig() {
  installSidebarNavigationMockApi();
  const response = await fetch(SIDEBAR_NAVIGATION_ENDPOINT);
  if (!response.ok) throw new Error(`Navigation API HTTP ${response.status}`);
  return response.json() as Promise<SidebarNavigationApiDto>;
}
