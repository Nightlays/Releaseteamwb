import React, { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldLabel,
  Input,
  Select,
} from '../../components/ui';
import {
  type RbacConfig,
  type RbacUser,
  type UserAccessConfig,
  persistLocalUsers,
  persistLocalRoleAccess,
  persistLocalUserAccess,
  clearLocalAccessOverrides,
} from '../../services/legacy';
import { MODULES } from '../../config/modules';

type AccessTab = 'users' | 'roles' | 'userAccess';

const ROLE_OPTIONS = [
  { value: 'superadmin', label: 'Суперадмин' },
  { value: 'admin', label: 'Администратор' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'analyst', label: 'Аналитик' },
  { value: 'viewer', label: 'Наблюдатель' },
];

const ROLE_COLOR: Record<string, 'red' | 'purple' | 'blue' | 'yellow' | 'gray'> = {
  superadmin: 'red',
  admin: 'purple',
  manager: 'blue',
  analyst: 'yellow',
  viewer: 'gray',
};

const ALL_MODULES = MODULES.filter(m => m.id !== 'access');

interface AccessPanelProps {
  rbac: RbacConfig;
  onRbacChange: (next: RbacConfig) => void;
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text-3)' }}>{title}</div>
      {action}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const opt = ROLE_OPTIONS.find(r => r.value === role);
  return <Badge color={ROLE_COLOR[role] ?? 'gray'}>{opt?.label ?? role}</Badge>;
}

export function AccessPanel({ rbac, onRbacChange }: AccessPanelProps) {
  const [activeTab, setActiveTab] = useState<AccessTab>('users');

  // ─── Users state ──────────────────────────────────────────────
  const [users, setUsers] = useState<RbacUser[]>(() => rbac.users.map(u => ({ ...u })));
  const [editingUserIdx, setEditingUserIdx] = useState<number | null>(null);
  const [userDraft, setUserDraft] = useState<RbacUser>({ login: '', pass: '', role: 'viewer' });
  const [showPass, setShowPass] = useState(false);
  const [usersDirty, setUsersDirty] = useState(false);

  // ─── Role access matrix state ──────────────────────────────────
  const [roleAccess, setRoleAccess] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      ROLE_OPTIONS.map(r => [r.value, [...(rbac.roleAccess[r.value] || [])]])
    )
  );
  const [roleDirty, setRoleDirty] = useState(false);

  // ─── User access overrides ─────────────────────────────────────
  const [userAccess, setUserAccess] = useState<Record<string, UserAccessConfig>>(() => ({
    ...rbac.userAccess,
  }));
  const [uaDirty, setUaDirty] = useState(false);

  // ─── Helpers ───────────────────────────────────────────────────
  const moduleHasAccess = (role: string, legacyId: string): boolean => {
    const list = roleAccess[role] || [];
    if (list.includes('*')) return true;
    return list.includes(legacyId);
  };

  const toggleRoleModule = (role: string, legacyId: string) => {
    setRoleAccess(prev => {
      const list = prev[role] || [];
      const hasStar = list.includes('*');
      let next: string[];
      if (hasStar) {
        // Expand wildcard to explicit list, then remove
        const expanded = ALL_MODULES.filter(m => !m.explicitAccess).map(m => m.legacyId);
        next = expanded.filter(id => id !== legacyId);
      } else {
        next = list.includes(legacyId) ? list.filter(id => id !== legacyId) : [...list, legacyId];
      }
      return { ...prev, [role]: next };
    });
    setRoleDirty(true);
  };

  const grantAllModules = (role: string) => {
    setRoleAccess(prev => ({ ...prev, [role]: ['*'] }));
    setRoleDirty(true);
  };

  const revokeAllModules = (role: string) => {
    setRoleAccess(prev => ({ ...prev, [role]: [] }));
    setRoleDirty(true);
  };

  const saveUsers = () => {
    persistLocalUsers(users);
    onRbacChange({ ...rbac, users });
    setUsersDirty(false);
  };

  const saveRoleAccess = () => {
    persistLocalRoleAccess(roleAccess);
    onRbacChange({ ...rbac, roleAccess: { ...rbac.roleAccess, ...roleAccess } });
    setRoleDirty(false);
  };

  const saveUserAccess = () => {
    persistLocalUserAccess(userAccess);
    onRbacChange({ ...rbac, userAccess });
    setUaDirty(false);
  };

  const resetAll = () => {
    clearLocalAccessOverrides();
    setUsers(rbac.users.map(u => ({ ...u })));
    setRoleAccess(Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, [...(rbac.roleAccess[r.value] || [])]])));
    setUserAccess({ ...rbac.userAccess });
    setUsersDirty(false);
    setRoleDirty(false);
    setUaDirty(false);
    window.location.reload();
  };

  const userRoleCount = useMemo(() =>
    Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, users.filter(u => u.role === r.value).length])),
    [users]
  );

  const TABS: { id: AccessTab; label: string }[] = [
    { id: 'users', label: `Пользователи (${users.length})` },
    { id: 'roles', label: 'Матрица доступа' },
    { id: 'userAccess', label: 'Индивидуальные права' },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 20px 32px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.4px' }}>Управление доступом</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
            Пользователи, роли и права на модули платформы
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={resetAll}>Сбросить к конфигу</Button>
      </div>

      {/* Role summary strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {ROLE_OPTIONS.map(r => (
          <div key={r.value} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
            borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-soft)',
          }}>
            <RoleBadge role={r.value} />
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>{userRoleCount[r.value] ?? 0} чел.</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: '10px 10px 0 0',
              background: activeTab === tab.id ? 'var(--card)' : 'transparent',
              color: activeTab === tab.id ? 'var(--text)' : 'var(--text-3)',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: 13, cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* ─── Users tab ─────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
          <SectionHead
            title="Пользователи системы"
            action={
              <Button variant="secondary" size="sm" onClick={() => {
                const newUser: RbacUser = { login: '', pass: '', role: 'viewer' };
                setUsers(prev => [...prev, newUser]);
                setEditingUserIdx(users.length);
                setUserDraft(newUser);
                setUsersDirty(true);
              }}>+ Добавить</Button>
            }
          />

          {users.length === 0 && <EmptyState text="Нет пользователей." />}

          {users.map((user, idx) => (
            <Card key={idx} style={{ overflow: 'hidden' }}>
              {editingUserIdx === idx ? (
                <CardBody style={{ padding: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <FieldLabel>Логин</FieldLabel>
                      <Input
                        value={userDraft.login}
                        onChange={e => setUserDraft(prev => ({ ...prev, login: e.target.value }))}
                        placeholder="Иванов"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <FieldLabel>Пароль</FieldLabel>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                          type={showPass ? 'text' : 'password'}
                          value={userDraft.pass}
                          onChange={e => setUserDraft(prev => ({ ...prev, pass: e.target.value }))}
                          placeholder="••••••••"
                          autoComplete="new-password"
                        />
                        <Button variant="ghost" size="sm" onClick={() => setShowPass(p => !p)}>
                          {showPass ? '🙈' : '👁'}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Роль</FieldLabel>
                      <Select
                        value={userDraft.role}
                        onChange={e => setUserDraft(prev => ({ ...prev, role: e.target.value }))}
                      >
                        {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <Button variant="ghost" size="sm" onClick={() => {
                      if (!userDraft.login.trim()) setUsers(prev => prev.filter((_, i) => i !== idx));
                      setEditingUserIdx(null);
                    }}>Отмена</Button>
                    <Button variant="primary" size="sm" onClick={() => {
                      if (!userDraft.login.trim()) return;
                      setUsers(prev => prev.map((u, i) => i === idx ? { ...userDraft } : u));
                      setEditingUserIdx(null);
                      setUsersDirty(true);
                    }}>Сохранить</Button>
                  </div>
                </CardBody>
              ) : (
                <CardBody style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                    background: ROLE_COLOR[user.role] === 'red' ? '#EF4444' : ROLE_COLOR[user.role] === 'purple' ? '#7C3AED' : ROLE_COLOR[user.role] === 'blue' ? '#3B82F6' : ROLE_COLOR[user.role] === 'yellow' ? '#F59E0B' : 'var(--border-hi)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800,
                  }}>
                    {user.login.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{user.login}</div>
                    <div style={{ marginTop: 4 }}><RoleBadge role={user.role} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingUserIdx(idx); setUserDraft({ ...user }); }}>
                      Изменить
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => {
                      setUsers(prev => prev.filter((_, i) => i !== idx));
                      setEditingUserIdx(null);
                      setUsersDirty(true);
                    }}>✕</Button>
                  </div>
                </CardBody>
              )}
            </Card>
          ))}

          {usersDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setUsers(rbac.users.map(u => ({ ...u }))); setUsersDirty(false); }}>
                Отменить изменения
              </Button>
              <Button variant="primary" onClick={saveUsers}>Сохранить пользователей</Button>
            </div>
          )}
        </div>
      )}

      {/* ─── Role access matrix ───────────────────────────────── */}
      {activeTab === 'roles' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <SectionHead title="Матрица доступа — роль × модуль" />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-3)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', minWidth: 200, borderBottom: '1px solid var(--border)' }}>
                    Модуль
                  </th>
                  {ROLE_OPTIONS.map(r => (
                    <th key={r.value} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', minWidth: 110 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <RoleBadge role={r.value} />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" onClick={() => grantAllModules(r.value)}
                            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-3)', cursor: 'pointer' }}>
                            все
                          </button>
                          <button type="button" onClick={() => revokeAllModules(r.value)}
                            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface-soft)', color: 'var(--text-3)', cursor: 'pointer' }}>
                            нет
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_MODULES.map((mod, idx) => (
                  <tr key={mod.id} style={{ background: idx % 2 === 0 ? 'var(--card)' : 'var(--surface-soft)' }}>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{mod.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{mod.sub}</div>
                      {mod.explicitAccess && <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 700 }}>explicit</span>}
                      {mod.superadminOnly && <span style={{ fontSize: 9, color: '#EF4444', fontWeight: 700 }}> superadmin</span>}
                    </td>
                    {ROLE_OPTIONS.map(r => {
                      const allowed = moduleHasAccess(r.value, mod.legacyId);
                      const isSuperadminOnly = mod.superadminOnly && r.value !== 'superadmin';
                      return (
                        <td key={r.value} style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                          {isSuperadminOnly ? (
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={allowed}
                              onChange={() => toggleRoleModule(r.value, mod.legacyId)}
                              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {roleDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => {
                setRoleAccess(Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, [...(rbac.roleAccess[r.value] || [])]])));
                setRoleDirty(false);
              }}>Отменить</Button>
              <Button variant="primary" onClick={saveRoleAccess}>Применить матрицу доступа</Button>
            </div>
          )}
        </div>
      )}

      {/* ─── User access overrides ────────────────────────────── */}
      {activeTab === 'userAccess' && (
        <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
          <SectionHead
            title="Индивидуальные переопределения"
            action={
              <Button variant="secondary" size="sm" onClick={() => {
                const login = prompt('Логин пользователя:');
                if (!login?.trim()) return;
                setUserAccess(prev => ({ ...prev, [login.trim()]: { useRole: true, access: [] } }));
                setUaDirty(true);
              }}>+ Добавить переопределение</Button>
            }
          />

          {Object.keys(userAccess).length === 0 && (
            <EmptyState text="Индивидуальных переопределений нет. Все пользователи используют доступ своей роли." />
          )}

          {Object.entries(userAccess).map(([login, config]) => (
            <Card key={login}>
              <CardHeader>
                <CardTitle>{login}</CardTitle>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Badge color={config.useRole === false ? 'red' : 'green'}>
                    {config.useRole === false ? 'Игнорировать роль' : 'Использовать роль'}
                  </Badge>
                  <Button variant="danger" size="sm" onClick={() => {
                    setUserAccess(prev => { const next = { ...prev }; delete next[login]; return next; });
                    setUaDirty(true);
                  }}>✕</Button>
                </div>
              </CardHeader>
              <CardBody style={{ padding: '8px 16px 14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.useRole !== false}
                    onChange={e => {
                      setUserAccess(prev => ({ ...prev, [login]: { ...config, useRole: e.target.checked } }));
                      setUaDirty(true);
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Применять права роли (если снято — только явный список ниже)</span>
                </label>

                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                  Дополнительные модули
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                  {ALL_MODULES.map(mod => {
                    const checked = (config.access || []).includes(mod.legacyId);
                    return (
                      <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 8, background: checked ? 'color-mix(in srgb, var(--surface-soft) 80%, var(--accent) 20%)' : 'var(--surface-soft)', border: '1px solid var(--border)' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...(config.access || []), mod.legacyId]
                              : (config.access || []).filter(id => id !== mod.legacyId);
                            setUserAccess(prev => ({ ...prev, [login]: { ...config, access: next } }));
                            setUaDirty(true);
                          }}
                        />
                        <span style={{ color: 'var(--text-2)' }}>{mod.label}</span>
                      </label>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ))}

          {uaDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setUserAccess({ ...rbac.userAccess }); setUaDirty(false); }}>Отменить</Button>
              <Button variant="primary" onClick={saveUserAccess}>Сохранить переопределения</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
