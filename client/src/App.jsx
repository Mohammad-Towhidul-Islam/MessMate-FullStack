import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Wallet, Users, LogOut, RefreshCw, Menu,
  Sun, Moon, Download, ChevronLeft, ChevronRight,
  Home, Utensils, ShoppingBasket, Receipt, ArrowUpRight, Clock, Pencil, Check, X
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const money = n =>
  `৳${Number(n || 0).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const ymd = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const dateKey = value => {
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

async function request(path, token, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const details = data.details
      ? (typeof data.details === 'string'
          ? data.details
          : JSON.stringify(data.details, null, 2))
      : '';

    const code = data.code ? `Code: ${data.code}` : '';

    throw new Error(
      [data.error || 'Request failed', details, code]
        .filter(Boolean)
        .join('\\n')
    );
  }

  return data;
}

export default function App() {
  const now = new Date();

  const [token, setToken] = useState(localStorage.getItem('mm_token') || '');
  const [user, setUser] = useState(null);

  const [page, setPage] = useState('Home');
  const [dark, setDark] = useState(localStorage.getItem('mm_theme') !== 'light');

  const [members, setMembers] = useState([]);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [editMemberForm, setEditMemberForm] = useState({ name: '', phone: '' });
  const [savingMember, setSavingMember] = useState(false);
  const [meals, setMeals] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);

  // Accounting year starts in November 2026
  const [month, setMonth] = useState(10);
  const [year, setYear] = useState(2026);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [registerMode, setRegisterMode] = useState(false);
  const [regName, setRegName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [market, setMarket] = useState({
    date: ymd(now.getFullYear(), now.getMonth(), now.getDate()),
    amount: '',
    description: ''
  });

  const [deposit, setDeposit] = useState({
    memberId: '',
    amount: '',
    date: ymd(now.getFullYear(), now.getMonth(), now.getDate()),
    description: 'Member deposit'
  });

  const [utility, setUtility] = useState({
    amount: '',
    date: ymd(now.getFullYear(), now.getMonth(), now.getDate()),
    description: 'Wifi',
    splitCount: '6'
  });

  const monthStart = ymd(year, month, 1);
  const monthEnd = ymd(year, month, new Date(year, month + 1, 0).getDate());
  const days = new Date(year, month + 1, 0).getDate();

  const isAdmin = user?.role === 'ADMIN';
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('mm_theme', dark ? 'dark' : 'light');
  }, [dark]);

  function logout() {
    localStorage.removeItem('mm_token');
    setToken('');
    setUser(null);
    setMembers([]);
    setMeals([]);
    setTransactions([]);
  }

  async function load(currentToken = token) {
    if (!currentToken) return;

    setBusy(true);
    setError('');

    try {
      const [me, memberData, mealData, transactionData] = await Promise.all([
        request('/auth/me', currentToken),
        request('/members', currentToken),
        request(`/meals?from=${monthStart}&to=${monthEnd}`, currentToken),
        request('/transactions', currentToken)
      ]);

      setUser({
        ...me.user,
        memberId: me.user.member?.id || null
      });
      setMembers(memberData);
      setMeals(mealData);
      setTransactions(transactionData);

      if (!deposit.memberId && memberData.length) {
        setDeposit(v => ({ ...v, memberId: memberData[0].id }));
      }
    } catch (e) {
      setError(e.message);

      if (
        e.message.toLowerCase().includes('authentication') ||
        e.message.toLowerCase().includes('token')
      ) {
        logout();
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (token) load(token);
  }, [token, month, year]);

  async function login(e) {
    e.preventDefault();
    setError('');

    try {
      const result = await request('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      localStorage.setItem('mm_token', result.token);
      setToken(result.token);
      setUser(result.user);
    } catch (e) {
      setError(e.message);
    }
  }

  async function registerStudent(e) {
    e.preventDefault();
    setError('');

    try {
      const result = await request('/auth/register', null, {
        method: 'POST',
        body: JSON.stringify({
          name: regName,
          email,
          password,
          joinCode
        })
      });

      localStorage.setItem('mm_token', result.token);
      setToken(result.token);
      setUser(result.user);
    } catch (e) {
      setError(e.message);
    }
  }

  const monthTransactions = useMemo(() => {
    return transactions.filter(t => {
      const d = new Date(t.transactionDate);
      return d.getUTCFullYear() === year &&
        d.getUTCMonth() === month;
    });
  }, [transactions, year, month]);

  const mealMap = useMemo(() => {
    const map = {};

    meals.forEach(meal => {
      map[
        `${meal.memberId}|${dateKey(meal.date)}|${meal.type}`
      ] = Number(meal.quantity);
    });

    return map;
  }, [meals]);

  const marketByDay = useMemo(() => {
    const result = {};

    monthTransactions
      .filter(t => t.type === 'EXPENSE' && t.category === 'MARKET')
      .forEach(t => {
        const day = new Date(t.transactionDate).getUTCDate();
        result[day] = (result[day] || 0) + Number(t.amount);
      });

    return result;
  }, [monthTransactions]);

  const totalMeals = meals.reduce(
    (sum, meal) => sum + Number(meal.quantity),
    0
  );

  const totalMarket = monthTransactions
    .filter(t => t.type === 'EXPENSE' && t.category === 'MARKET')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalDeposits = monthTransactions
    .filter(t => t.type === 'DEPOSIT')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const utilityTransactions = monthTransactions.filter(
    t => t.type === 'EXPENSE' && t.category === 'UTILITIES'
  );

  const utilityTotal = utilityTransactions.reduce(
    (sum, t) => sum + Number(t.amount),
    0
  );

  const otherExpenses = monthTransactions
    .filter(t =>
      t.type === 'EXPENSE' &&
      t.category !== 'MARKET' &&
      t.category !== 'UTILITIES'
    )
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalExpenses = totalMarket + utilityTotal + otherExpenses;

  const cashPosition = totalDeposits - totalExpenses;

  const mealRate = totalMeals > 0
    ? totalMarket / totalMeals
    : 0;

  const memberStats = members.map(member => {
    const quantity = meals
      .filter(m => m.memberId === member.id)
      .reduce((sum, m) => sum + Number(m.quantity), 0);

    const memberDeposit = monthTransactions
      .filter(t => t.type === 'DEPOSIT' && t.memberId === member.id)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const mealCost = quantity * mealRate;

    return {
      ...member,
      quantity,
      deposit: memberDeposit,
      mealCost,
      balance: memberDeposit - mealCost
    };
  });

  const utilityShare = members.length
    ? utilityTotal / members.length
    : 0;

  function startEditMember(member) {
    setEditingMemberId(member.id);
    setEditMemberForm({
      name: member.name || '',
      phone: member.phone || ''
    });
    setError('');
    setNotice('');
  }

  function cancelEditMember() {
    setEditingMemberId(null);
    setEditMemberForm({ name: '', phone: '' });
  }

  async function saveMemberEdit(memberId) {
    const name = editMemberForm.name.trim();
    const phone = editMemberForm.phone.trim();

    if (name.length < 2 || name.length > 80) {
      setError('Member name must be between 2 and 80 characters.');
      return;
    }

    if (phone.length > 30) {
      setError('Phone number cannot exceed 30 characters.');
      return;
    }

    setSavingMember(true);
    setError('');
    setNotice('');

    try {
      await request(`/members/${memberId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name, phone })
      });

      setMembers(current => current.map(member =>
        member.id === memberId ? { ...member, name, phone } : member
      ));
      cancelEditMember();
      setNotice('Member name updated successfully. Meal history has been preserved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingMember(false);
    }
  }

  async function saveMeal(memberId, date, type, value) {
    const quantity = Number(value || 0);

    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 10) {
      setError('Meal quantity must be between 0 and 10.');
      return;
    }

    try {
      await request('/meals', token, {
        method: 'POST',
        body: JSON.stringify({
          memberId,
          date,
          type,
          quantity
        })
      });

      await load();
      setNotice('Meal entry saved successfully');
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveMarket(date, amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) return;

    const existing = monthTransactions.find(t =>
      t.type === 'EXPENSE' &&
      t.category === 'MARKET' &&
      dateKey(t.transactionDate) === date &&
      t.description === 'Daily market'
    );

    try {
      if (existing) {
        await request(`/transactions/${existing.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ amount: value })
        });
      } else {
        await request('/transactions', token, {
          method: 'POST',
          body: JSON.stringify({
            type: 'EXPENSE',
            category: 'MARKET',
            amount: value,
            description: 'Daily market',
            transactionDate: date
          })
        });
      }

      await load();
      setNotice('Daily market cost saved');
    } catch (e) {
      setError(e.message);
    }
  }

  async function addMarket(e) {
    e.preventDefault();

    try {
      await request('/transactions', token, {
        method: 'POST',
        body: JSON.stringify({
          type: 'EXPENSE',
          category: 'MARKET',
          amount: Number(market.amount),
          description: market.description || 'Market purchase',
          transactionDate: market.date
        })
      });

      setMarket({
        date: ymd(year, month, 1),
        amount: '',
        description: ''
      });

      await load();
      setNotice('Market expense added');
    } catch (e) {
      setError(e.message);
    }
  }

  async function addDeposit(e) {
    e.preventDefault();

    try {
      await request('/transactions', token, {
        method: 'POST',
        body: JSON.stringify({
          type: 'DEPOSIT',
          memberId: deposit.memberId,
          amount: Number(deposit.amount),
          description: deposit.description,
          transactionDate: deposit.date
        })
      });

      setDeposit(v => ({ ...v, amount: '' }));
      await load();
      setNotice('Member deposit added');
    } catch (e) {
      setError(e.message);
    }
  }

  async function addUtility(e) {
    e.preventDefault();

    try {
      await request('/transactions', token, {
        method: 'POST',
        body: JSON.stringify({
          type: 'EXPENSE',
          category: 'UTILITIES',
          amount: Number(utility.amount),
          description: utility.description,
          transactionDate: utility.date
        })
      });

      setUtility(v => ({ ...v, amount: '' }));
      await load();
      setNotice('Utility bill saved separately');
    } catch (e) {
      setError(e.message);
    }
  }

  function exportCSV() {
    const rows = [
      ['Member', 'Total meals', 'Meal cost', 'Deposit', 'Due / Return'],
      ...memberStats.map(m => [
        m.name,
        m.quantity.toFixed(2),
        m.mealCost.toFixed(2),
        m.deposit.toFixed(2),
        m.balance.toFixed(2)
      ])
    ];

    const csv = rows
      .map(row =>
        row.map(value =>
          `"${String(value).replaceAll('"', '""')}"`
        ).join(',')
      )
      .join('\n');

    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    link.download = `MessMate-${year}-${String(month + 1).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (!token) {
    return (
      <main className="login-wrap">
        <section className="login-split">
          <div className="login-left">
            <div className="login-brand">
              <div className="login-brand-icon">M</div>
              <div>
                <h2 className="login-brand-name">
                  Mess<span>Mate</span>
                </h2>
                <p className="login-brand-tagline">
                  Mess Management Platform
                </p>
              </div>
            </div>

            <p className="login-left-caption">
              Manage daily meals, market costs and member accounts in one place.
            </p>
          </div>

          <div className="login-right">
            <form
              className="login-card"
              onSubmit={registerMode ? registerStudent : login}
            >
              <h1>
                {registerMode ? (
                  <>Create <span>Account</span></>
                ) : (
                  <>Welcome <span>Back</span></>
                )}
              </h1>

              <p className="muted">
                {registerMode
                  ? 'Create your student account to join your mess.'
                  : 'Sign in to manage your mess.'}
              </p>

              {registerMode && (
                <label>
                  Full name
                  <input
                    type="text"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                    minLength="2"
                  />
                </label>
              )}

              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete={registerMode ? 'new-password' : 'current-password'}
                  required
                  minLength="8"
                />
              </label>

              {registerMode && (
                <label>
                  Mess invite code
                  <input
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    placeholder="Enter your mess invite code"
                    required
                  />
                </label>
              )}

              {error && <p className="error">{error}</p>}

              <button className="primary full" type="submit">
                {registerMode ? 'Create account' : 'Sign in'}
              </button>

              {!registerMode && (
                <div className="login-divider">
                  Don’t have an account?
                </div>
              )}

              <button
                type="button"
                className="secondary-btn full"
                onClick={() => {
                  setRegisterMode(!registerMode);
                  setError('');
                }}
              >
                {registerMode
                  ? 'Already have an account? Sign in'
                  : 'Create an account'}
              </button>

              {!registerMode && (
                <small className="muted">
                  Demo admin: admin@messmate.local / ChangeMe123!
                </small>
              )}
            </form>
          </div>
        </section>
      </main>
    );
  }

  const navigation = [
    ['Home', Home],
    ['Monthly Sheet', CalendarDays],
    ...(canManage ? [['Deposits & Market', Wallet], ['Members', Users]] : [])
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <div className="brand">
          <img
            src="/messmate-logo.png"
            alt="MessMate logo"
            className="brandmark-image"
          />
          <div>
            <b>MessMate</b>
            <small>MANAGEMENT</small>
          </div>
        </div>

        <div className="mess-label">WORKSPACE</div>
        

        {navigation.map(([name, Icon]) => (
          <button
            key={name}
            className={`nav-item ${page === name ? 'active' : ''}`}
            onClick={() => {
              setPage(name);
              setMobile(false);
            }}
          >
            <Icon size={18} />
            {name}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{user?.name?.[0] || 'A'}</div>
            <div>
              <b>{user?.name}</b>
              <small>{user?.role}</small>
            </div>
          </div>

          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>

          <div>
            <span className="muted">Workspace / </span>
            <b>{page}</b>
          </div>

          <div className="top-actions">
            <button className="icon-btn" onClick={() => setDark(!dark)}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button className="icon-btn" onClick={() => load()}>
              <RefreshCw size={17} />
            </button>

            <div className="avatar">{user?.name?.[0] || 'A'}</div>
          </div>
        </header>

        <section className="content">
          <div className="page-head">
            <div>
              <p className="eyebrow">MESS ACCOUNTING WORKSPACE</p>
              <h1>{page}</h1>
              <p className="muted">
                Monthly meals, deposits, market expenses and separate utilities.
              </p>
            </div>

            <div className="head-actions">
              <button className="secondary-btn" onClick={exportCSV}>
                <Download size={15} />
                Export CSV
              </button>

              <span className="date-chip">
                <CalendarDays size={15} />
                {new Date(year, month, 1).toLocaleDateString('en-GB', {
                  month: 'long',
                  year: 'numeric'
                })}
              </span>
            </div>
          </div>

          {error && <div className="alert">{error}</div>}

          {notice && (
            <div className="success" onClick={() => setNotice('')}>
              {notice} ×
            </div>
          )}

          {page === 'Home' && (
            <div className="home-dashboard">
              <div className="home-welcome home-welcome-banner">
                <div className="home-welcome-footer">
                  <div>
                    <p className="eyebrow">MESSMATE OVERVIEW</p>
                    <h2>Welcome back, {user?.name || 'there'}!</h2>
                    <p className="muted">
                      Your mess summary for {new Date(year, month, 1).toLocaleDateString('en', {
                        month: 'long',
                        year: 'numeric'
                      })}.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => setPage('Monthly Sheet')}
                  >
                    <CalendarDays size={16} /> Open monthly sheet
                  </button>
                </div>
              </div>

              <div className="home-stats-grid">
                <div className="home-stat-card stat-members">
                  <span className="home-stat-icon"><Users size={20} /></span>
                  <small>Total members</small>
                  <strong>{members.length}</strong>
                  <span className="home-stat-note">Registered in your mess</span>
                </div>
                <div className="home-stat-card stat-meals">
                  <span className="home-stat-icon"><Utensils size={20} /></span>
                  <small>Total meals</small>
                  <strong>{totalMeals.toFixed(2)}</strong>
                  <span className="home-stat-note">Meals recorded this month</span>
                </div>
                <div className="home-stat-card stat-market">
                  <span className="home-stat-icon"><ShoppingBasket size={20} /></span>
                  <small>Market expense</small>
                  <strong>{money(totalMarket)}</strong>
                  <span className="home-stat-note">Food and grocery spending</span>
                </div>
                <div className="home-stat-card stat-rate">
                  <span className="home-stat-icon"><Receipt size={20} /></span>
                  <small>One meal rate</small>
                  <strong>{money(mealRate)}</strong>
                  <span className="home-stat-note">Market cost per meal</span>
                </div>
                <div className="home-stat-card stat-deposit">
                  <span className="home-stat-icon"><Wallet size={20} /></span>
                  <small>Total deposits</small>
                  <strong>{money(totalDeposits)}</strong>
                  <span className="home-stat-note">Member deposits this month</span>
                </div>
                <div className="home-stat-card stat-cash">
                  <span className="home-stat-icon"><ArrowUpRight size={20} /></span>
                  <small>Cash after expenses</small>
                  <strong>{money(cashPosition)}</strong>
                  <span className="home-stat-note">Deposits minus all expenses</span>
                </div>
              </div>

              <div className="home-lower-grid">
                <div className="panel home-quick-panel">
                  <div className="home-panel-heading">
                    <div>
                      <h3>Quick actions</h3>
                      <p className="muted">Go directly to your daily tasks</p>
                    </div>
                  </div>
                  <div className="home-quick-actions">
                    <button className="home-action" onClick={() => setPage('Monthly Sheet')}>
                      <CalendarDays size={19} />
                      <span><b>Monthly Sheet</b><small>Enter daily meals and costs</small></span>
                      <ChevronRight size={17} />
                    </button>
                    {canManage && (
                      <>
                        <button className="home-action" onClick={() => setPage('Deposits & Market')}>
                          <Wallet size={19} />
                          <span><b>Deposits & Market</b><small>Add deposits and expenses</small></span>
                          <ChevronRight size={17} />
                        </button>
                        <button className="home-action" onClick={() => setPage('Members')}>
                          <Users size={19} />
                          <span><b>Members</b><small>View your mess members</small></span>
                          <ChevronRight size={17} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="panel home-recent-panel">
                  <div className="home-panel-heading">
                    <div>
                      <h3>Recent transactions</h3>
                      <p className="muted">Latest activity for this month</p>
                    </div>
                    {canManage && (
                      <button className="secondary-btn" onClick={() => setPage('Deposits & Market')}>
                        View all
                      </button>
                    )}
                  </div>
                  {monthTransactions.length ? (
                    <div className="home-recent-list">
                      {[...monthTransactions]
                        .sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
                        .slice(0, 5)
                        .map(t => (
                          <div className="home-recent-item" key={t.id}>
                            <span className={`home-transaction-icon ${t.type === 'DEPOSIT' ? 'is-deposit' : 'is-expense'}`}>
                              {t.type === 'DEPOSIT' ? <Wallet size={16} /> : <Receipt size={16} />}
                            </span>
                            <span className="home-transaction-details">
                              <b>{t.description || t.category || t.type}</b>
                              <small>
                                {new Date(t.transactionDate).toLocaleDateString('en-GB')}
                                {t.member?.name ? ` · ${t.member.name}` : ''}
                              </small>
                            </span>
                            <strong className={t.type === 'DEPOSIT' ? 'positive' : 'negative'}>
                              {t.type === 'DEPOSIT' ? '+' : '−'}{money(t.amount)}
                            </strong>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="home-empty">
                      <Clock size={22} />
                      <p>No transactions recorded for this month yet.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {page === 'Monthly Sheet' && (
            <>
              <div className="month-toolbar">
                <button
                  className="icon-btn"
                  onClick={() => {
                    if (month === 0) {
                      setMonth(11);
                      setYear(year - 1);
                    } else {
                      setMonth(month - 1);
                    }
                  }}
                >
                  <ChevronLeft />
                </button>

                <select
                  value={month}
                  onChange={e => setMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option value={i} key={i}>
                      {new Date(2000, i, 1).toLocaleString('en', {
                        month: 'long'
                      })}
                    </option>
                  ))}
                </select>

                <select
                  value={year}
                  onChange={e => setYear(Number(e.target.value))}
                >
                  {[year - 2, year - 1, year, year + 1].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>

                <button
                  className="icon-btn"
                  onClick={() => {
                    if (month === 11) {
                      setMonth(0);
                      setYear(year + 1);
                    } else {
                      setMonth(month + 1);
                    }
                  }}
                >
                  <ChevronRight />
                </button>

                <span className="muted">
                  {busy ? 'Syncing…' : `${days} days · ${members.length} members`}
                </span>
              </div>

              <div className="sheet-summary">
                <div>
                  <small>Total market expense</small>
                  <b>{money(totalMarket)}</b>
                </div>
                <div>
                  <small>Total meals</small>
                  <b>{totalMeals.toFixed(2)}</b>
                </div>
                <div>
                  <small>One meal rate</small>
                  <b>{money(mealRate)}</b>
                </div>
                <div>
                  <small>Total deposits</small>
                  <b>{money(totalDeposits)}</b>
                </div>
                <div>
                  <small>Cash after expenses</small>
                  <b>{money(cashPosition)}</b>
                </div>
              </div>

              <div className="sheet-card">
                <div className="sheet-title">
                  <div>
                    <h3>
                      {new Date(year, month, 1).toLocaleString('en', {
                        month: 'long'
                      })} {year} — Daily Meal Register
                    </h3>
                    <p>
                      Enter meal quantity and press Enter or click outside to save.
                    </p>
                  </div>

                  <span className="sheet-hint">
                    Day = yellow · Night = green
                  </span>
                </div>

                <div className="sheet-scroll">
                  <table className="excel-sheet">
                    <thead>
                      <tr>
                        <th className="sticky-name">Member</th>
                        <th className="sticky-session">Session</th>

                        {Array.from({ length: days }, (_, i) => (
                          <th key={i}>{i + 1}</th>
                        ))}

                        <th className="total-col">Total</th>
                        <th className="cost-col">Meal cost</th>
                        <th className="deposit-col">Deposit</th>
                        <th className="balance-col">Due / Return</th>
                      </tr>
                    </thead>

                    <tbody>
                      {members.map(member => {
                        const stats = memberStats.find(
                          m => m.id === member.id
                        );

                        return ['DAY', 'NIGHT'].map((session, index) => (
                          <tr
                            key={member.id + session}
                            className={session === 'DAY' ? 'day-row' : 'night-row'}
                          >
                            {index === 0 && (
                              <td
                                className="sticky-name member-name"
                                rowSpan="2"
                              >
                                {member.name}
                              </td>
                            )}

                            <td className="sticky-session session-name">
                              {session === 'DAY' ? 'Day' : 'Night'}
                            </td>

                            {Array.from({ length: days }, (_, i) => {
                              const date = ymd(year, month, i + 1);
                              const value =
                                mealMap[`${member.id}|${date}|${session}`] ?? 0;

                              return (
                                <td key={i}>
                                  <input
                                    aria-label={`${member.name} ${session} ${date}`}
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.25"
                                    defaultValue={value}
                                    key={`${member.id}-${session}-${date}-${value}`}
                                    disabled={
                                      user?.role === 'MEMBER' &&
                                      user?.memberId !== member.id
                                    }
                                    onBlur={e => {
                                      if (Number(e.target.value) !== value) {
                                        saveMeal(
                                          member.id,
                                          date,
                                          session,
                                          e.target.value
                                        );
                                      }
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </td>
                              );
                            })}

                            {index === 0 && (
                              <>
                                <td className="total-col" rowSpan="2">
                                  {stats.quantity.toFixed(2)}
                                </td>

                                <td className="cost-col" rowSpan="2">
                                  {money(stats.mealCost)}
                                </td>

                                <td className="deposit-col" rowSpan="2">
                                  {money(stats.deposit)}
                                </td>

                                <td
                                  className={`balance-col ${
                                    stats.balance < 0 ? 'negative' : 'positive'
                                  }`}
                                  rowSpan="2"
                                >
                                  {money(stats.balance)}
                                </td>
                              </>
                            )}
                          </tr>
                        ));
                      })}

                      {canManage && (
                        <tr className="daily-cost-row">
                          <td className="sticky-name" colSpan="2">
                            Daily Cost (৳)
                          </td>

                          {Array.from({ length: days }, (_, i) => {
                            const date = ymd(year, month, i + 1);
                            const value = marketByDay[i + 1] || 0;

                            return (
                              <td key={i}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  defaultValue={value || ''}
                                  key={`${date}-${value}`}
                                  placeholder="—"
                                  onBlur={e => {
                                    const amount = Number(e.target.value);
                                    if (amount > 0 && amount !== value) {
                                      saveMarket(date, amount);
                                    }
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              </td>
                            );
                          })}

                          <td className="total-col">{money(totalMarket)}</td>
                          <td colSpan="3" className="muted">
                            Daily market cost
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="sheet-foot">
                  <span><span className="dot yellow" /> Day meal</span>
                  <span><span className="dot green" /> Night meal</span>
                  <span><span className="dot pink" /> Daily market cost</span>
                  <span className="muted">Saved in PostgreSQL</span>
                </div>
              </div>

              <div className="panel compact-panel">
                <h3>Monthly member settlement</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Total meals</th>
                        <th>Meal cost</th>
                        <th>Deposit</th>
                        <th>Due / Return</th>
                        <th>Utility share (reference)</th>
                      </tr>
                    </thead>

                    <tbody>
                      {memberStats.map(member => (
                        <tr key={member.id}>
                          <td><b>{member.name}</b></td>
                          <td>{member.quantity.toFixed(2)}</td>
                          <td>{money(member.mealCost)}</td>
                          <td>{money(member.deposit)}</td>
                          <td className={
                            member.balance < 0 ? 'negative' : 'positive'
                          }>
                            {money(member.balance)}
                          </td>
                          <td>{money(utilityShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {page === 'Deposits & Market' && canManage && (
            <div className="grid-two deposits-market-layout">
              <div className="panel deposits-entry-panel">
                <h3>Record market expense</h3>

                <form className="entry-form" onSubmit={addMarket}>
                  <label>
                    Date
                    <input
                      type="date"
                      value={market.date}
                      onChange={e => setMarket({
                        ...market,
                        date: e.target.value
                      })}
                      required
                    />
                  </label>

                  <label
                    className="full-width-field"
                    style={{
                      gridColumn: '1 / -1',
                      flex: '1 1 100%',
                      width: '100%',
                      minWidth: 0
                    }}
                  >
                    Amount (BDT)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={market.amount}
                      onChange={e => setMarket({
                        ...market,
                        amount: e.target.value
                      })}
                      style={{
                        display: 'block',
                        width: '100%',
                        maxWidth: '100%',
                        minWidth: 0,
                        boxSizing: 'border-box'
                      }}
                      required
                    />
                  </label>

                  <label>
                    Details
                    <input
                      value={market.description}
                      onChange={e => setMarket({
                        ...market,
                        description: e.target.value
                      })}
                      placeholder="Rice, vegetables, fish..."
                    />
                  </label>

                  <button className="primary">Save market expense</button>
                </form>

                <hr />

                <h3>Record member deposit</h3>

                <form className="entry-form" onSubmit={addDeposit}>
                  <label>
                    Member
                    <select
                      value={deposit.memberId}
                      onChange={e => setDeposit({
                        ...deposit,
                        memberId: e.target.value
                      })}
                      required
                    >
                      {members.filter(m => m.active).map(m => (
                        <option value={m.id} key={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={deposit.date}
                      onChange={e => setDeposit({
                        ...deposit,
                        date: e.target.value
                      })}
                    />
                  </label>

                  <label>
                    Amount (BDT)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={deposit.amount}
                      onChange={e => setDeposit({
                        ...deposit,
                        amount: e.target.value
                      })}
                      required
                    />
                  </label>

                  <label>
                    Note
                    <input
                      value={deposit.description}
                      onChange={e => setDeposit({
                        ...deposit,
                        description: e.target.value
                      })}
                    />
                  </label>

                  <button className="primary">Add deposit</button>
                </form>

                <hr />

                <h3>Record utility bill</h3>

                <form className="entry-form" onSubmit={addUtility}>
                  <label>
                    Utility type
                    <input
                      value={utility.description}
                      onChange={e => setUtility({
                        ...utility,
                        description: e.target.value
                      })}
                      placeholder="Wifi, electricity, gas..."
                      required
                    />
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={utility.date}
                      onChange={e => setUtility({
                        ...utility,
                        date: e.target.value
                      })}
                    />
                  </label>

                  <label>
                    Total bill (BDT)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={utility.amount}
                      onChange={e => setUtility({
                        ...utility,
                        amount: e.target.value
                      })}
                      required
                    />
                  </label>

                  <label>
                    Split among members (reference)
                    <input
                      type="number"
                      min="1"
                      value={utility.splitCount}
                      onChange={e => setUtility({
                        ...utility,
                        splitCount: e.target.value
                      })}
                    />
                  </label>

                  <p className="muted">
                    Reference share: {
                      money(
                        Number(utility.amount || 0) /
                        Math.max(1, Number(utility.splitCount || 1))
                      )
                    } per person. Utility is not deducted from meal balance.
                  </p>

                  <button className="primary">Save utility bill</button>
                </form>
              </div>

              <div className="panel deposits-history-panel">
                <h3>Transaction history</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Details</th>
                        <th>Amount</th>
                      </tr>
                    </thead>

                    <tbody>
                      {monthTransactions.map(t => (
                        <tr key={t.id}>
                          <td>
                            {new Date(t.transactionDate).toLocaleDateString()}
                          </td>
                          <td>{t.type}</td>
                          <td>{t.category || '—'}</td>
                          <td>
                            {t.description}
                            {t.member?.name ? ` · ${t.member.name}` : ''}
                          </td>
                          <td>{money(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {page === 'Members' && canManage && (
            <div className="panel">
              <h3>Members ({members.length})</h3>
              <p className="muted">Edit a member's name or phone number. Existing meal records will remain unchanged.</p>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Joined</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {members.map(member => (
                      <tr key={member.id}>
                        <td>
                          {editingMemberId === member.id ? (
                            <input
                              type="text"
                              value={editMemberForm.name}
                              onChange={e => setEditMemberForm(v => ({ ...v, name: e.target.value }))}
                              minLength="2"
                              maxLength="80"
                              autoFocus
                              aria-label="Member name"
                            />
                          ) : (
                            <b>{member.name}</b>
                          )}
                        </td>
                        <td>
                          {editingMemberId === member.id ? (
                            <input
                              type="tel"
                              value={editMemberForm.phone}
                              onChange={e => setEditMemberForm(v => ({ ...v, phone: e.target.value }))}
                              maxLength="30"
                              placeholder="Phone number"
                              aria-label="Member phone"
                            />
                          ) : (
                            member.phone || '—'
                          )}
                        </td>
                        <td>{member.active ? 'Active' : 'Inactive'}</td>
                        <td>
                          {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          {editingMemberId === member.id ? (
                            <div className="member-edit-actions" style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                className="primary"
                                disabled={savingMember}
                                onClick={() => saveMemberEdit(member.id)}
                              >
                                <Check size={15} /> {savingMember ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="secondary-btn"
                                disabled={savingMember}
                                onClick={cancelEditMember}
                              >
                                <X size={15} /> Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => startEditMember(member)}
                            >
                              <Pencil size={15} /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {members.length === 0 && (
                      <tr>
                        <td colSpan="5" className="muted">No members found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <footer>
            MessMate · {busy ? 'Syncing…' : 'Connected to server'} · Monthly accounting
          </footer>
        </section>
      </main>
    </div>
  );
}
