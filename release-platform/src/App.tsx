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

function ModuleContent({ moduleId, refreshKey, rbac, role, onRbacChange }: { moduleId: ModuleId; refreshKey: number; rbac: RbacConfig; role: Role; onRbacChange: (next: RbacConfig) => void }) {
  if (moduleId === 'band') {
    return <LegacyModuleFrame module={MODULE_BY_ID[moduleId]} refreshKey={refreshKey} />;
  }

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
    case 'vangovat':
      return <div key={key}><Vangovat /></div>;
    case 'ytcopy':
      return <div key={key}><YtCopy /></div>;
    case 'wiki':
      return <div key={key}><WikiIntelligence /></div>;
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
  onSubmit: (login: string, pass: string) => void;
}) {
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');

  const statCard: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '14px 16px',
    borderRadius: 16,
    background: 'var(--card)',
    border: '1px solid var(--border-hi)',
    boxShadow: 'var(--sh-sm)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  };

  const iconBox = (color: string): React.CSSProperties => ({
    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
    background: `rgba(${color},.15)`,
    border: `1px solid rgba(${color},.28)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--hero-bg)',
    }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px clamp(24px,5vw,64px)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:'var(--grad)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'#fff', boxShadow:'0 4px 16px rgba(155,92,255,.4)', flexShrink:0 }}>WB</div>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--text-3)' }}>Release Platform</span>
        </div>
        <button type="button" onClick={onToggleTheme} style={{ padding:'6px 14px', borderRadius:999, border:'1px solid var(--border-hi)', background:'var(--surface-soft-4)', color:'var(--text-2)', fontSize:11, fontWeight:700, cursor:'pointer' }}>
          {theme === 'dark' ? '☾ Тёмная' : '☀ Светлая'}
        </button>
      </header>

      {/* ── Main: centered column ────────────────────────────────────────── */}
      <main style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px clamp(16px,5vw,32px) 40px' }}>
        <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', gap:24 }}>

          {/* Hero text */}
          <div style={{ textAlign:'center' }}>
            <h1 style={{ fontSize:'clamp(38px,5vw,58px)', lineHeight:.92, letterSpacing:'-2px', fontWeight:900, color:'var(--text)', margin:'0 0 14px' }}>
              Управляй{' '}
              <span style={{ background:'var(--grad)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>релизами</span>
              {' '}уверенно
            </h1>
            <p style={{ fontSize:14, lineHeight:1.6, color:'var(--text-3)', margin:0 }}>
              Единый центр запуска, аналитики, SWAT-дежурств<br/>и AI-базы знаний для мобильных релизов WB.
            </p>
          </div>

          {/* Auth card */}
          <form
            onSubmit={e => { e.preventDefault(); onSubmit(login, pass); }}
            style={{ padding:'28px 28px 24px', borderRadius:24, background:'var(--card)', border:'1px solid var(--border-hi)', boxShadow:'var(--shadow-hard)' }}
          >
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--text-2)', letterSpacing:'.2px' }}>ЛОГИН</span>
                <input
                  value={login}
                  onChange={e => setLogin(e.target.value)}
                  autoComplete="username"
                  placeholder="Ваш логин"
                  style={{ padding:'11px 14px', borderRadius:12, border:'1.5px solid var(--border-hi)', background:'var(--surface-soft-2)', color:'var(--text)', fontSize:14, outline:'none', width:'100%' }}
                />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--text-2)', letterSpacing:'.2px' }}>ПАРОЛЬ</span>
                <input
                  type="password"
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  style={{ padding:'11px 14px', borderRadius:12, border:'1.5px solid var(--border-hi)', background:'var(--surface-soft-2)', color:'var(--text)', fontSize:14, outline:'none', width:'100%' }}
                />
              </label>
            </div>

            {error && (
              <div style={{ marginTop:12, padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.22)', color:'#EF4444', fontSize:12.5 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              style={{ width:'100%', marginTop:16, padding:'12px 16px', borderRadius:12, background:'var(--grad)', color:'#fff', fontWeight:700, fontSize:14, border:'none', cursor:'pointer', boxShadow:'0 10px 32px rgba(155,92,255,.28)', letterSpacing:'-.1px' }}
            >
              Войти
            </button>
          </form>

          {/* Stat cards row */}
          <div style={{ display:'flex', gap:10 }}>

            {/* Release — full-width progress bar */}
            <div style={{ ...statCard, flex:1.5, flexDirection:'column', alignItems:'stretch', gap:9 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={iconBox('245,158,11')}>
                  <svg viewBox="0 0 22 22" width="15" height="15" fill="none" stroke="#F59E0B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {/* rocket body */}
                    <path d="M11 2C9.2 4 8 7 8 10v2.5h6V10c0-3-1.2-6-3-8z" fill="rgba(245,158,11,.18)"/>
                    {/* left fin */}
                    <path d="M8 10.5L5.5 14H8.5" strokeWidth="1.4"/>
                    {/* right fin */}
                    <path d="M14 10.5L16.5 14H13.5" strokeWidth="1.4"/>
                    {/* exhaust */}
                    <path d="M10 13c0 0 .5 2.2 1 2.2s1-2.2 1-2.2" strokeWidth="1.3"/>
                    {/* porthole */}
                    <circle cx="11" cy="8" r="1.3" fill="#F59E0B" stroke="none"/>
                  </svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11.5, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>Релиз v25.5 Мажорный</div>
                  <div style={{ fontSize:10, color:'var(--text-3)', marginTop:1 }}>Готовность тест-кейсов</div>
                </div>
                <span style={{ fontSize:12, fontWeight:800, color:'var(--yellow)', flexShrink:0 }}>68%</span>
              </div>
              <div style={{ height:4, borderRadius:999, background:'var(--border-hi)', overflow:'hidden' }}>
                <div style={{ width:'68%', height:'100%', borderRadius:999, background:'linear-gradient(90deg,#F59E0B,#FCD34D)', boxShadow:'0 0 8px rgba(245,158,11,.35)' }}/>
              </div>
            </div>

            {/* SWAT */}
            <div style={statCard}>
              <div style={iconBox('34,197,94')}>
                <svg viewBox="0 0 22 22" width="15" height="15" fill="none" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 2L4 5v6c0 4.42 2.96 8.56 7 9.93C15.04 19.56 18 15.42 18 11V5L11 2z" fill="rgba(34,197,94,.18)"/>
                  <path d="M8 11l2.5 2.5 4-4" strokeWidth="2"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:11.5, fontWeight:700, color:'var(--text)' }}>SWAT онлайн</div>
                <div style={{ fontSize:10.5, color:'var(--text-3)', marginTop:1 }}>5 дежурных</div>
              </div>
            </div>

            {/* ML */}
            <div style={statCard}>
              <div style={iconBox('99,102,241')}>
                <svg viewBox="0 0 22 22" width="15" height="15" fill="none" stroke="#818CF8" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2 13c0-5 4-9 9-9s9 4 9 9" strokeOpacity=".3"/>
                  <path d="M5 13c0-3.31 2.69-6 6-6s6 2.69 6 6" strokeOpacity=".65"/>
                  <path d="M8 13c0-1.66 1.34-3 3-3s3 1.34 3 3"/>
                  <circle cx="11" cy="13" r="2" fill="#818CF8" stroke="none"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:11.5, fontWeight:700, color:'var(--text)' }}>ML-прогноз</div>
                <div style={{ fontSize:10.5, color:'var(--green)', fontWeight:700, marginTop:1 }}>Риск ↓ низкий</div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ── Feature pills ─────────────────────────────────────────────────── */}
      <footer style={{ display:'flex', justifyContent:'center', flexWrap:'wrap', gap:8, padding:'0 24px 28px' }}>
        {['Запуск релизов','SWAT','ЧП','ML-прогноз','Wiki AI','Графики','Ванговатор','Устройства'].map(f => (
          <span key={f} style={{ padding:'5px 12px', borderRadius:999, background:'var(--surface-soft-4)', border:'1px solid var(--border)', color:'var(--text-3)', fontSize:11.5, fontWeight:600 }}>{f}</span>
        ))}
      </footer>
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

  const handleLogin = (login: string, pass: string) => {
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

    persistAuth(found.login, nextRole);
    didHydrateModuleRef.current = false;
    setAuth({ authed: true, login: found.login, role: nextRole as Role });
    setActiveModule(getFirstAllowedModuleId(found.login, nextRole, rbac.roleAccess, rbac.userAccess));
    setAuthError('');
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

  const isWideModule = currentModule.id === 'charts' || currentModule.id === 'goals' || currentModule.id === 'releaseAnalysis';
  const mainPadding = currentModule.id === 'releaseAnalysis'
    ? '10px 12px 18px 12px'
    : (currentModule.id === 'charts' || currentModule.id === 'goals') ? '0' : 16;

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
            <ModuleContent moduleId={currentModule.id} refreshKey={refreshKey} rbac={rbac} role={auth.role} onRbacChange={setRbac} />
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
