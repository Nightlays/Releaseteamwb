import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsProvider } from './context/SettingsContext';
import { AppProvider, useApp, type ThemeMode } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { SettingsModal } from './components/layout/SettingsModal';
import { LegacyModuleFrame } from './components/layout/LegacyModuleFrame';
import { useSettings } from './context/SettingsContext';
import { checkProxy } from './services/proxy';
import { MODULE_BY_ID, MODULE_BY_LEGACY_ID, MODULE_SECTIONS, type ModuleId } from './config/modules';
import { Dashboard } from './modules/Dashboard';
import { GoalsPortal } from './modules/GoalsPortal';
import { Charts } from './modules/Charts';
import { BiAudience } from './modules/BiAudience';
import { BiUsers } from './modules/BiUsers';
import { Devices } from './modules/Devices';
import { Launch } from './modules/Launch';
import { CreateRun } from './modules/CreateRun';
import { ChpCollect } from './modules/ChpCollect';
import { ChpReleaseRange } from './modules/ChpReleaseRange';
import { ReleaseQuarterAnalysis } from './modules/ReleaseQuarterAnalysis';
import { SwatRelease } from './modules/SwatRelease';
import { Uvu } from './modules/Uvu';
import { Vangovat } from './modules/Vangovat';
import { YtCopy } from './modules/YtCopy';
import { WikiIntelligence } from './modules/WikiIntelligence';
import { AccessPanel } from './modules/AccessPanel';
import { RolloutReport } from './modules/RolloutReport';
import {
  DEFAULT_SERVICE_GATEWAY_ID,
  getServiceGatewayItem,
  ServiceGateway,
  SERVICE_GATEWAY_ITEMS,
  type ServiceGatewayAuthTarget,
  type ServiceGatewayItem,
} from './modules/ServiceGateway';
import {
  buildLegacyModuleUrl,
  canAccessModule,
  clearStoredAuth,
  getFirstAllowedModuleId,
  getRoleLabel,
  loadRbacConfig,
  persistAuth,
  readStoredAuth,
  resolveAllowedLegacyIds,
  type RbacConfig,
} from './services/legacy';
import type { Role } from './types';

const EMPTY_RBAC: RbacConfig = {
  roles: [],
  users: [],
  roleAccess: {},
  userAccess: {},
};

function ModuleContent({
  moduleId,
  refreshKey,
  rbac,
  role,
  onRbacChange,
  onActivateModule,
}: {
  moduleId: ModuleId;
  refreshKey: number;
  rbac: RbacConfig;
  role: Role;
  onRbacChange: (next: RbacConfig) => void;
  onActivateModule: (moduleId: ModuleId) => void;
}) {
  const key = `${moduleId}:${refreshKey}`;

  switch (moduleId) {
    case 'dashboard':
      return <div key={key}><Dashboard /></div>;
    case 'goals':
      return <div key={key} style={{ height: '100%' }}><GoalsPortal /></div>;
    case 'charts':
      return <div key={key}><Charts /></div>;
    case 'biusers':
      return <div key={key}><BiUsers /></div>;
    case 'devices':
      return <div key={key}><Devices /></div>;
    case 'launch':
      return <div key={key}><Launch /></div>;
    case 'createrun':
      return <div key={key}><CreateRun /></div>;
    case 'chp':
      return <div key={key}><ChpCollect /></div>;
    case 'releaseAnalysis':
      return <div key={key}><ReleaseQuarterAnalysis role={role} /></div>;
    case 'chpRange':
      return <div key={key}><ChpReleaseRange /></div>;
    case 'swat':
      return <div key={key}><SwatRelease /></div>;
    case 'uvu':
      return <div key={key}><Uvu /></div>;
    case 'biaudience':
      return <div key={key}><BiAudience /></div>;
    case 'vangovat':
      return <div key={key}><Vangovat /></div>;
    case 'ytcopy':
      return <div key={key}><YtCopy /></div>;
    case 'wiki':
      return <div key={key}><WikiIntelligence /></div>;
    case 'band':
      return <div key={key}><RolloutReport /></div>;
    case 'access':
      return <div key={key} style={{ height: '100%' }}><AccessPanel rbac={rbac} onRbacChange={onRbacChange} /></div>;
    default:
      return <div key={key}><Dashboard /></div>;
  }
}

function AuthScreen({
  error,
  theme,
  onToggleTheme,
  onSubmit,
}: {
  error: string;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSubmit: (login: string, pass: string, target?: ServiceGatewayAuthTarget) => void;
}) {
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState(DEFAULT_SERVICE_GATEWAY_ID);
  const formRef = useRef<HTMLFormElement>(null);
  const selectedService = getServiceGatewayItem(selectedServiceId);

  const selectService = (item: ServiceGatewayItem) => {
    setSelectedServiceId(item.id);
    requestAnimationFrame(() => {
      if (item.authTarget.type === 'module') {
        formRef.current?.querySelector<HTMLInputElement>('input[name="login"]')?.focus();
      }
    });
  };

  const authCard = (
    <form
      ref={formRef}
      onSubmit={e => { e.preventDefault(); onSubmit(login, pass, selectedService.authTarget); }}
      style={{
        minHeight: 382,
        padding: '26px 26px 22px',
        borderRadius: 22,
        background: 'var(--card)',
        border: '1px solid var(--border-hi)',
        boxShadow: 'var(--shadow-hard)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        boxSizing: 'border-box',
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div style={{ minHeight: 96, marginBottom: 14, padding: '0 44px' }}>
        <button
          type="button"
          onClick={onToggleTheme}
          style={{
            position: 'absolute',
            top: 24,
            right: 24,
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid var(--border-hi)',
            background: 'var(--surface-soft-4)',
            color: 'var(--text-2)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {theme === 'dark' ? 'Тёмная' : 'Светлая'}
        </button>
        <div>
          <div style={{ fontSize: 21, fontWeight: 850, color: 'var(--text)', lineHeight: 1.15 }}>
            {selectedService.title}
          </div>
          <div style={{ marginTop: 7, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
            {selectedService.description}
          </div>
        </div>
      </div>

      <div style={{ minHeight: 44, marginBottom: 12 }}>
        {selectedService.authTarget.type === 'external' ? (
          <a
            href={selectedService.authTarget.href}
            target={selectedService.authTarget.target || '_self'}
            rel={selectedService.authTarget.target === '_blank' ? 'noopener noreferrer' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              minHeight: 42,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--surface-soft-4)',
              border: '1px solid var(--border-hi)',
              color: 'var(--text)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 750,
              boxSizing: 'border-box',
            }}
          >
            Открыть {selectedService.label}
          </a>
        ) : (
          <div style={{
            minHeight: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '9px 14px',
            borderRadius: 12,
            background: 'rgba(155,92,255,.10)',
            border: '1px solid rgba(155,92,255,.24)',
            color: 'var(--text-2)',
            fontSize: 12.5,
            fontWeight: 700,
            boxSizing: 'border-box',
          }}>
            После входа откроется выбранный раздел
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '.2px' }}>ЛОГИН</span>
          <input
            name="login"
            value={login}
            onChange={e => setLogin(e.target.value)}
            autoComplete="username"
            placeholder="Ваш логин"
            style={{ padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-hi)', background: 'var(--surface-soft-2)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '.2px' }}>ПАРОЛЬ</span>
          <input
            type="password"
            value={pass}
            onChange={e => setPass(e.target.value)}
            autoComplete="current-password"
            placeholder="Пароль"
            style={{ padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--border-hi)', background: 'var(--surface-soft-2)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.22)', color: '#EF4444', fontSize: 12.5 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        style={{ width: '100%', marginTop: 16, padding: '12px 16px', borderRadius: 12, background: 'var(--grad)', color: '#fff', fontWeight: 750, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 10px 32px rgba(155,92,255,.28)' }}
      >
        {selectedService.authTarget.type === 'module'
          ? `Войти и открыть ${selectedService.label}`
          : `Войти и перейти в ${selectedService.label}`}
      </button>
    </form>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--main-bg)' }}>
      <ServiceGateway
        items={SERVICE_GATEWAY_ITEMS}
        authPanel={authCard}
        selectedServiceId={selectedService.id}
        onSelect={selectService}
      />
    </div>
  );
}

function Layout() {
  const { settings } = useSettings();
  const { activeModule, setActiveModule, settingsOpen, setSettingsOpen, theme, setTheme, toggleTheme } = useApp();
  const [proxyOnline, setProxyOnline] = useState(false);
  const [mlReady, setMlReady] = useState(true);
  const [rbac, setRbac] = useState<RbacConfig>(EMPTY_RBAC);
  const [auth, setAuth] = useState(() => readStoredAuth());
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setAuthLoading(true);
    loadRbacConfig()
      .then(config => {
        if (!alive) return;
        setRbac(config);
        setAuthLoading(false);
      })
      .catch(error => {
        if (!alive) return;
        setAuthLoading(false);
        setAuthError((error as Error).message || 'Не удалось загрузить RBAC-конфиг');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!settings.proxyBase.trim()) {
      setProxyOnline(false);
      return;
    }
    checkProxy(settings.proxyBase).then(setProxyOnline).catch(() => setProxyOnline(false));
  }, [settings.proxyBase]);

  useEffect(() => {
    setMlReady(Boolean(settings.mlHelperBase || settings.glmBase));
  }, [settings.glmBase, settings.mlHelperBase]);

  const allowedLegacyIds = useMemo(() => {
    if (!auth.login) return new Set<string>();
    return resolveAllowedLegacyIds(auth.login, auth.role, rbac.roleAccess, rbac.userAccess);
  }, [auth.login, auth.role, rbac.roleAccess, rbac.userAccess]);

  const visibleSections = useMemo(() => MODULE_SECTIONS.map(section => ({
    label: section.label,
    items: section.items.filter(module => canAccessModule(module, auth.role, allowedLegacyIds)),
  })).filter(section => section.items.length > 0), [allowedLegacyIds, auth.role]);

  const currentModule = MODULE_BY_ID[activeModule];
  const didHydrateModuleRef = useRef(false);

  const syncModuleUrl = useCallback((moduleId: ModuleId, historyMode: 'replace' | 'push' = 'replace') => {
    const module = MODULE_BY_ID[moduleId];
    if (!module) return;

    const url = new URL(window.location.href);
    url.searchParams.set('module', module.legacyId);
    const method = historyMode === 'push' ? 'pushState' : 'replaceState';
    window.history[method]({ module: module.id }, '', url.toString());
  }, []);

  const resolveModuleFromLocation = useCallback((): ModuleId => {
    const fallback = getFirstAllowedModuleId(auth.login, auth.role, rbac.roleAccess, rbac.userAccess);
    const moduleParam = new URLSearchParams(window.location.search).get('module');
    if (!moduleParam) return fallback;

    const byInternal = MODULE_BY_ID[moduleParam as ModuleId];
    const byLegacy = MODULE_BY_LEGACY_ID[moduleParam];
    const candidate = byInternal || byLegacy;

    if (candidate && canAccessModule(candidate, auth.role, allowedLegacyIds) && !candidate.openNewTab) {
      return candidate.id;
    }

    return fallback;
  }, [allowedLegacyIds, auth.login, auth.role, rbac.roleAccess, rbac.userAccess]);

  useEffect(() => {
    if (!auth.authed) {
      didHydrateModuleRef.current = false;
    }
  }, [auth.authed]);

  useEffect(() => {
    if (!rbac.roles.length || !auth.authed || !auth.login || didHydrateModuleRef.current) return;
    didHydrateModuleRef.current = true;
    const nextModule = resolveModuleFromLocation();
    if (nextModule !== activeModule) {
      setActiveModule(nextModule);
      return;
    }
    syncModuleUrl(nextModule);
  }, [activeModule, auth.authed, auth.login, rbac.roles.length, resolveModuleFromLocation, setActiveModule, syncModuleUrl]);

  useEffect(() => {
    if (!rbac.roles.length || !auth.authed || !auth.login) return;
    if (canAccessModule(currentModule, auth.role, allowedLegacyIds) && !currentModule.openNewTab) return;

    const fallback = getFirstAllowedModuleId(auth.login, auth.role, rbac.roleAccess, rbac.userAccess);
    if (fallback !== activeModule) {
      setActiveModule(fallback);
      return;
    }
    syncModuleUrl(fallback);
  }, [activeModule, allowedLegacyIds, auth.authed, auth.login, auth.role, currentModule, rbac.roleAccess, rbac.roles.length, rbac.userAccess, setActiveModule, syncModuleUrl]);

  useEffect(() => {
    if (!rbac.roles.length || !auth.authed || !auth.login) return undefined;

    const onPopState = () => {
      const nextModule = resolveModuleFromLocation();
      setActiveModule(nextModule);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [auth.authed, auth.login, rbac.roles.length, resolveModuleFromLocation, setActiveModule]);

  useEffect(() => {
    if (!auth.authed || !didHydrateModuleRef.current) return;
    syncModuleUrl(currentModule.id);
  }, [auth.authed, currentModule.id, syncModuleUrl]);

  useEffect(() => {
    setRefreshKey(prev => prev + 1);
  }, [settings]);

  const handleLogin = (login: string, pass: string, target?: ServiceGatewayAuthTarget) => {
    if (!rbac.users.length) {
      setAuthError('RBAC-конфиг ещё не загружен');
      return;
    }

    const normalizedLogin = login.trim();
    const normalizedPass = pass.trim();
    const found = rbac.users.find(user => user.login === normalizedLogin && user.pass === normalizedPass);

    if (!found) {
      setAuthError('Неверный логин или пароль');
      return;
    }

    const nextRole = normalizedLogin === 'Nightlays'
      ? 'superadmin'
      : (found.role === 'superadmin' ? 'admin' : found.role || 'viewer');

    const nextAllowedLegacyIds = resolveAllowedLegacyIds(found.login, nextRole, rbac.roleAccess, rbac.userAccess);
    const requestedModule = target?.type === 'module' ? MODULE_BY_ID[target.moduleId] : null;
    const nextModule = requestedModule
      && canAccessModule(requestedModule, nextRole, nextAllowedLegacyIds)
      && !requestedModule.openNewTab
        ? requestedModule.id
        : getFirstAllowedModuleId(found.login, nextRole, rbac.roleAccess, rbac.userAccess);

    persistAuth(found.login, nextRole);
    didHydrateModuleRef.current = Boolean(target);
    setAuth({ authed: true, login: found.login, role: nextRole as Role });
    setActiveModule(nextModule);
    setAuthError('');

    if (target?.type === 'external') {
      window.location.assign(target.href);
    }
  };

  const handleLogout = () => {
    clearStoredAuth();
    didHydrateModuleRef.current = false;
    setAuth({ authed: false, login: '', role: 'viewer' });
    setSettingsOpen(false);
  };

  const handleActivate = (moduleId: ModuleId) => {
    const module = MODULE_BY_ID[moduleId];
    if (!module || !canAccessModule(module, auth.role, allowedLegacyIds)) return;

    if (module.openNewTab) {
      window.open(buildLegacyModuleUrl(module, settings), '_blank', 'noopener');
      return;
    }

    if (module.id === activeModule) return;

    didHydrateModuleRef.current = true;
    setActiveModule(module.id);
    syncModuleUrl(module.id, 'push');
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--text-2)' }}>
        Инициализация платформы…
      </div>
    );
  }

  if (!auth.authed) {
    return <AuthScreen error={authError} theme={theme} onToggleTheme={toggleTheme} onSubmit={handleLogin} />;
  }

  const isWideModule = true;
  const mainPadding = currentModule.id === 'releaseAnalysis' || currentModule.id === 'swat'
    ? '10px 12px 18px 12px'
    : currentModule.id === 'dashboard'
      ? '12px 14px 18px'
      : (currentModule.id === 'charts' || currentModule.id === 'goals') ? '0' : '10px 12px 18px 12px';

  return (
    <div className="app-shell" style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: "'Inter', 'Onest', system-ui, sans-serif",
    }}>
      <Sidebar
        sections={visibleSections}
        activeModule={activeModule}
        currentUser={auth.login}
        roleLabel={getRoleLabel(auth.role, rbac.roles)}
        onActivate={module => handleActivate(module.id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={handleLogout}
      />

      <div className="app-main-column" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar
          module={currentModule}
          proxyOnline={proxyOnline}
          mlReady={mlReady}
          theme={theme}
          onRefresh={() => setRefreshKey(prev => prev + 1)}
          onOpenLegacy={() => window.open(buildLegacyModuleUrl(currentModule, settings), '_blank', 'noopener')}
          onSetTheme={setTheme}
          showLegacyButton={currentModule.showLegacyButton !== false}
        />

        <main className="app-main-content" style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: mainPadding,
          background: 'var(--main-bg)',
        }}>
          <div style={{ maxWidth: isWideModule ? undefined : 1440, margin: '0 auto', width: '100%', height: '100%' }}>
            <ModuleContent
              moduleId={currentModule.id}
              refreshKey={refreshKey}
              rbac={rbac}
              role={auth.role}
              onRbacChange={setRbac}
              onActivateModule={handleActivate}
            />
          </div>
        </main>
      </div>

      {settingsOpen && <SettingsModal />}
      {authError && (
        <div style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          maxWidth: 360,
          padding: '12px 14px',
          borderRadius: 16,
          background: 'rgba(239,68,68,.12)',
          border: '1px solid rgba(239,68,68,.18)',
          color: '#FCA5A5',
          fontSize: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,.32)',
        }}>
          {authError}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AppProvider>
        <Layout />
      </AppProvider>
    </SettingsProvider>
  );
}
