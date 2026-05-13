import React from 'react';
import type { ModuleId } from '../../config/modules';

export type ServiceGatewayAuthTarget =
  | { type: 'module'; moduleId: ModuleId }
  | { type: 'external'; href: string; target?: React.HTMLAttributeAnchorTarget };

export interface ServiceGatewayItem {
  id: string;
  label: string;
  href: string;
  color: string;
  icon: React.ReactNode;
  cardDescription: string;
  title: string;
  headline: string;
  accent: string;
  headlineSuffix: string;
  subtitle: string;
  description: string;
  authTarget: ServiceGatewayAuthTarget;
}

export const DEFAULT_SERVICE_GATEWAY_ID = 'dashboard';

function dashboardIcon() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="15" width="4" height="8" rx="1.3" fill="currentColor" fillOpacity=".85" stroke="none" />
      <rect x="11" y="9" width="4" height="14" rx="1.3" fill="currentColor" fillOpacity=".85" stroke="none" />
      <rect x="18" y="12" width="4" height="11" rx="1.3" fill="currentColor" fillOpacity=".85" stroke="none" />
      <path d="M3 11h4l3-5 4 7 3-4h8" />
    </svg>
  );
}

function learnHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3.53 1.67 8.47 1.67 12 0v-5" />
    </svg>
  );
}

function projectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function arrowIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h9v9" />
      <path d="M16 4 4 16" />
    </svg>
  );
}

function serviceLabel(label: string) {
  return label.replace(/\n/g, ' ');
}

export const SERVICE_GATEWAY_ITEMS: ServiceGatewayItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '?module=dashboard_run_module.html',
    color: 'linear-gradient(135deg,#22C55E,#0EA5E9)',
    icon: dashboardIcon(),
    cardDescription: 'Готовность релиза, Allure, прогресс, прогноз и launch-риски.',
    title: 'Дашборд релиза',
    headline: 'Управляй',
    accent: 'релизами',
    headlineSuffix: 'уверенно',
    subtitle: 'Единая точка входа в дашборд, обучение и проектные сервисы release-команды.',
    description: 'Собирает готовность релиза, Allure-прогресс, launch-риски, историю снепшотов и прогноз к дедлайну.',
    authTarget: { type: 'module', moduleId: 'dashboard' },
  },
  {
    id: 'learnhub',
    label: 'Learning Hub',
    href: 'http://wii-front-ingress-controller.wii-front.k8s.stage-dm/frontend',
    color: 'linear-gradient(135deg,#7C3AED,#9B5CFF)',
    icon: learnHubIcon(),
    cardDescription: 'Обучение, внутренние материалы и единый доступ в Learning Hub.',
    title: 'Learning Hub',
    headline: 'Обучай',
    accent: 'команду',
    headlineSuffix: 'системно',
    subtitle: 'Портал помогает собирать программы обучения, материалы, инструкции и треки развития команды.',
    description: 'Learning Hub позволяет обучать сотрудников, хранить внутренние материалы, вести базу знаний и подключать людей к процессам по единому стандарту.',
    authTarget: { type: 'external', href: 'http://wii-front-ingress-controller.wii-front.k8s.stage-dm/frontend' },
  },
  {
    id: 'project',
    label: 'Project',
    href: 'http://10.29.47.57',
    color: 'linear-gradient(135deg,#0EA5E9,#0369A1)',
    icon: projectIcon(),
    cardDescription: 'Планирование, ретро, kanban-доска и управление командной работой.',
    title: 'Project',
    headline: 'Планируй',
    accent: 'работу',
    headlineSuffix: 'прозрачно',
    subtitle: 'Project помогает вести планирование, ретро, kanban-доску и командную синхронизацию.',
    description: 'Project нужен для планирования задач, проведения ретро, ведения kanban-доски и контроля рабочих потоков команды.',
    authTarget: { type: 'external', href: 'http://10.29.47.57' },
  },
];

export function getServiceGatewayItem(id: string | null | undefined) {
  return SERVICE_GATEWAY_ITEMS.find(item => item.id === id) || SERVICE_GATEWAY_ITEMS[0];
}

function ServiceCard({
  item,
  active,
  centered = false,
  onSelect,
}: {
  item: ServiceGatewayItem;
  active?: boolean;
  centered?: boolean;
  onSelect: (item: ServiceGatewayItem) => void;
}) {
  const content = (
    <>
      <div style={{
        width: centered ? 58 : 62,
        height: centered ? 58 : 62,
        borderRadius: centered ? 17 : 18,
        background: item.color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 16px 34px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.24)',
        flexShrink: 0,
      }}>
        {item.icon}
      </div>
      <div style={{ minWidth: 0, flex: centered ? undefined : 1, textAlign: centered ? 'center' : undefined }}>
        <div style={{ fontSize: centered ? 18 : 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>
          {serviceLabel(item.label)}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--text-2)', maxWidth: centered ? 260 : undefined }}>
          {item.cardDescription}
        </div>
      </div>
      <div style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        border: '1px solid var(--border-hi)',
        color: 'var(--text-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: centered ? 'absolute' : undefined,
        top: centered ? 14 : undefined,
        right: centered ? 14 : undefined,
      }}>
        {arrowIcon()}
      </div>
    </>
  );

  const style: React.CSSProperties = {
    minHeight: centered ? 194 : 150,
    display: 'flex',
    flexDirection: centered ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: centered ? 'center' : undefined,
    gap: 18,
    padding: centered ? '24px 20px 22px' : 22,
    borderRadius: 18,
    background: active ? 'var(--card-hi)' : 'var(--card)',
    border: `1px solid ${active ? 'rgba(155,92,255,.55)' : 'var(--border)'}`,
    boxShadow: 'var(--shadow-soft)',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'border-color .14s ease, background .14s ease, box-shadow .14s ease',
    position: 'relative',
    width: '100%',
    textAlign: centered ? 'center' : 'left',
    font: 'inherit',
  };

  const hoverIn = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.style.borderColor = 'rgba(155,92,255,.36)';
    event.currentTarget.style.background = 'var(--card-hi)';
    event.currentTarget.style.boxShadow = '0 20px 48px rgba(0,0,0,.32)';
  };

  const hoverOut = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.style.borderColor = active ? 'rgba(155,92,255,.55)' : 'var(--border)';
    event.currentTarget.style.background = active ? 'var(--card-hi)' : 'var(--card)';
    event.currentTarget.style.boxShadow = 'var(--shadow-soft)';
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      style={style}
    >
      {content}
    </button>
  );
}

export function ServiceGateway({
  items = SERVICE_GATEWAY_ITEMS,
  selectedServiceId = DEFAULT_SERVICE_GATEWAY_ID,
  authPanel,
  onSelect,
}: {
  items?: ServiceGatewayItem[];
  selectedServiceId?: string;
  authPanel?: React.ReactNode;
  onSelect: (item: ServiceGatewayItem) => void;
}) {
  const resolvedItems = items.length ? items : SERVICE_GATEWAY_ITEMS;
  const selected = resolvedItems.find(item => item.id === selectedServiceId) || resolvedItems[0];
  const authMode = Boolean(authPanel);

  return (
    <section style={{
      minHeight: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: authMode ? '38px 28px 44px' : '34px 28px',
      background: 'var(--main-bg)',
    }}>
      <div style={{ width: '100%', maxWidth: authMode ? 1160 : 1180 }}>
        <div style={{
          marginBottom: authMode ? 24 : 26,
          textAlign: authMode ? 'center' : undefined,
          display: 'flex',
          flexDirection: 'column',
          alignItems: authMode ? 'center' : undefined,
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'var(--surface-soft-4)',
            border: '1px solid var(--border-hi)',
            color: 'var(--text-2)',
            fontSize: 12,
            fontWeight: 700,
          }}>
            Release Platform
          </div>
          <h1 style={{
            margin: '16px 0 8px',
            fontSize: authMode ? 'clamp(38px,5vw,58px)' : 42,
            lineHeight: authMode ? .98 : 1.05,
            letterSpacing: 0,
            fontWeight: 900,
            color: 'var(--text)',
            maxWidth: authMode ? 760 : undefined,
          }}>
            {selected.headline}{' '}
            <span style={{ background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {selected.accent}
            </span>
            {' '}{selected.headlineSuffix}
          </h1>
          <p style={{ margin: 0, maxWidth: authMode ? 680 : 720, fontSize: 15, lineHeight: 1.55, color: 'var(--text-2)' }}>
            {selected.subtitle}
          </p>
        </div>

        {authPanel && (
          <div style={{ width: '100%', maxWidth: 560, margin: '0 auto 22px' }}>
            {authPanel}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: authMode ? 'repeat(auto-fit, minmax(260px, 1fr))' : 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'stretch',
        }}>
          {resolvedItems.map(item => (
            <ServiceCard
              key={item.id}
              item={item}
              active={selected.id === item.id}
              centered={authMode}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
