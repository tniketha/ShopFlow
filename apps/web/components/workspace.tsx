'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProductPhoto, PhotoPicker } from './product-photo';
import {
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from 'lucide-react';
type User = {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER';
  active: boolean;
};
type Product = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  priceMinor: number;
  costMinor?: number;
  reorderLevel: number;
  categoryId?: string | null;
  category?: { name: string };
  photoKey?: string | null;
  photoVersion?: string | null;
};
type Sale = {
  id: string;
  invoiceNo: number;
  totalMinor: number;
  paidMinor: number;
  createdAt: string;
  refunds: { totalMinor: number }[];
  lines: {
    id: string;
    name: string;
    quantity: number;
    returnedQuantity: number;
    priceMinor: number;
  }[];
};
type Named = { id: string; name: string; contact?: string | null };
type Movement = {
  id: string;
  createdAt: string;
  kind: string;
  delta: number;
  product: { name: string; sku: string };
};
type Purchase = {
  id: string;
  createdAt: string;
  totalMinor: number;
  supplier: Named;
  lines: unknown[];
};
type Audit = { id: string; action: string; entityId: string; createdAt: string };
type Dashboard = {
  today: string;
  netMinor: number;
  grossMinor: number;
  refundMinor: number;
  saleCount: number;
  productCount: number;
  lowStock: Product[];
};
type Report = { columns: string[]; rows: (string | number)[][]; summary: Record<string, number> };
type Pending = { path: string; body: Record<string, unknown> };
const currency = (minor: number) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(minor / 100);
const reportLabels: Record<string, string> = {
  grossMinor: 'Gross sales',
  refundMinor: 'Refunds',
  netMinor: 'Net sales',
  sales: 'Transactions',
  products: 'Products',
  valueMinor: 'Stock value',
};
const date = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function minor(value: string) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value))
    throw new Error('Use an LKR amount with up to two decimal places');
  const [a, b = ''] = value.split('.');
  return Number(a) * 100 + Number(b.padEnd(2, '0'));
}
const links = [
  ['/', 'Overview', LayoutDashboard],
  ['/pos', 'Point of sale', ShoppingCart],
  ['/inventory', 'Inventory', Boxes],
  ['/purchases', 'Purchases', PackagePlus],
  ['/sales', 'Sales & refunds', ClipboardList],
  ['/reports', 'Reports', BarChart3],
  ['/team', 'Team', Users],
  ['/audit', 'Activity', ShieldCheck],
] as const;
const sectionCopy: Record<string, { label: string; description: string }> = {
  overview: {
    label: 'TODAY AT YOUR STORE',
    description: 'Sales, stock and the next step for your store.',
  },
  inventory: {
    label: 'PRODUCTS & STOCK',
    description: 'Your products, prices and stock levels in one place.',
  },
  pos: {
    label: 'THE CHECKOUT COUNTER',
    description: 'Find a product. Build a basket. Keep your queue moving.',
  },
  purchases: {
    label: 'KEEP THE SHELVES READY',
    description: 'Receive deliveries and track the stock coming into your store.',
  },
  sales: {
    label: 'SALES & RETURNS',
    description: 'Find invoices, review purchases and manage customer returns.',
  },
  reports: {
    label: 'YOUR STORE IN NUMBERS',
    description: 'Understand sales and stock with clear, exportable reports.',
  },
  team: {
    label: 'THE PEOPLE BEHIND YOUR STORE',
    description: 'Manage your team and the access each person needs.',
  },
  audit: {
    label: 'A RECORD OF EVERY CHANGE',
    description: 'Review the activity behind your products and transactions.',
  },
};
export default function Workspace() {
  const pathname = usePathname();
  const section = pathname.split('/')[1] || 'overview';
  const [me, setMe] = useState<User | null>(null);
  const [business, setBusiness] = useState('ShopFlow');
  const [csrf, setCsrf] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [team, setTeam] = useState<User[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [paid, setPaid] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [refunding, setRefunding] = useState<Sale | null>(null);
  const [purchaseLines, setPurchaseLines] = useState<
    { productId: string; quantity: number; cost: string }[]
  >([{ productId: '', quantity: 1, cost: '0.00' }]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [editingNamed, setEditingNamed] = useState<{
    kind: 'categories' | 'suppliers';
    value: Named;
  } | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reportKind, setReportKind] = useState('sales');
  const [report, setReport] = useState<Report | null>(null);
  const managed = me?.role === 'OWNER' || me?.role === 'MANAGER';
  const api = useCallback(
    async <T,>(path: string, body?: unknown, method = 'POST'): Promise<T> => {
      const response = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : method,
        headers:
          body === undefined
            ? undefined
            : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setMe(null);
        throw Object.assign(
          new Error(data.error + (data.details ? ': ' + data.details.join('; ') : '')),
          { status: response.status },
        );
      }
      return data;
    },
    [csrf],
  );
  const refresh = useCallback(async () => {
    if (!me) return;
    if (section === 'overview') setDashboard(await api<Dashboard>('/dashboard'));
    if (['inventory', 'pos', 'purchases'].includes(section)) {
      const data = await api<{ items: Product[]; count: number }>(
        `/products?page=${page}&search=${encodeURIComponent(search)}`,
      );
      setProducts(data.items);
      setCount(data.count);
    }
    if (section === 'inventory') {
      setCategories(await api<Named[]>('/categories'));
      if (managed) setMovements(await api<Movement[]>('/movements'));
    }
    if (section === 'purchases' && managed) {
      setSuppliers(await api<Named[]>('/suppliers'));
      setPurchases(await api<Purchase[]>('/purchases'));
    }
    if (section === 'sales') setSales(await api<Sale[]>(`/sales?page=${page}`));
    if (section === 'team' && me.role === 'OWNER') setTeam(await api<User[]>('/users'));
    if (section === 'audit' && managed) setAudit(await api<Audit[]>(`/audit?page=${page}`));
  }, [api, me, section, page, search, managed]);
  useEffect(() => {
    api<{ user: User; csrf: string; business: { name: string } }>('/auth/me')
      .then((data) => {
        setMe(data.user);
        setCsrf(data.csrf);
        setBusiness(data.business.name);
        const saved = sessionStorage.getItem('shopflow-pending:' + data.user.id);
        if (saved) setPending(JSON.parse(saved));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // Initial session discovery only.
  useEffect(() => {
    setPage(1);
    setSearch('');
    setError('');
    setNotice('');
  }, [section]);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        refresh()
          .catch((e) => {
            if (alive) setError(e.message);
          })
          .finally(() => {
            if (alive) setLoading(false);
          }),
      search ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh, search]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  }
  async function submitOnce(request: Pending) {
    if (!me) return;
    if (pending && JSON.stringify(pending) !== JSON.stringify(request))
      throw new Error('Resolve the pending request before starting a different transaction.');
    const storageKey = 'shopflow-pending:' + me.id;
    sessionStorage.setItem(storageKey, JSON.stringify(request));
    setPending(request);
    try {
      const result = await api<Sale>(request.path, request.body);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      if (request.path === '/sales') {
        setReceipt(result);
        setCart([]);
        setPaid('');
      }
      if (request.path === '/purchases')
        setPurchaseLines([{ productId: '', quantity: 1, cost: '0.00' }]);
      setRefunding(null);
      setNotice('Transaction saved.');
      await refresh();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && [400, 403, 404, 409].includes(status)) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      throw e;
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await action(async () => {
      const result = await api<{ user: User; csrf: string }>('/auth/login', {
        email: data.get('email'),
        password: data.get('password'),
      });
      setMe(result.user);
      setCsrf(result.csrf);
      window.location.assign('/');
    });
  }
  if (loading && !me)
    return (
      <main className="splash">
        <div className="brand-icon">
          <ShoppingBag />
        </div>
        <p>Opening your workspace…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <div className="brand-icon">
              <ShoppingBag />
            </div>
            ShopFlow
          </div>
          <div>
            <p className="eyebrow">LESS ADMIN. MORE SHOP.</p>
            <h1>
              A clear view of
              <br />
              your everyday.
            </h1>
            <p>
              Stock on the shelf. Sales at the counter.
              <br />
              Everything your store needs, together.
            </p>
            <div className="story-cards">
              <span>
                <Boxes /> Keep stock in check
              </span>
              <span>
                <ShieldCheck /> A place for every role
              </span>
            </div>
          </div>
          <small>Built for your store · Currency LKR · Sri Lanka time</small>
        </section>
        <section className="login-form">
          <p className="eyebrow">YOUR STORE WORKSPACE</p>
          <h2>Welcome back.</h2>
          <p>Sign in to pick up where you left off.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@yourstore.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in to ShopFlow'} <ChevronRight size={16} />
            </button>
          </form>
          <p className="hint">
            First time here? Run the setup instructions in the project README to create your owner
            account.
          </p>
          <small>© {new Date().getFullYear()} ShopFlow. All rights reserved.</small>
        </section>
      </main>
    );
  const title = links.find((l) => l[0] === pathname)?.[1] ?? 'Page not found';
  const total = cart.reduce((n, l) => n + l.product.priceMinor * l.quantity, 0);
  const productSearch = (
    <div className="toolbar">
      <div className="search">
        <Search size={18} />
        <input
          aria-label="Search products"
          placeholder="Search products or SKU…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <span className="muted">{count} products</span>
      <button
        className="icon-button"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
        aria-label="Previous products"
      >
        <ChevronLeft size={18} />
      </button>
      <span>{page}</span>
      <button
        className="icon-button"
        disabled={page * 50 >= count}
        onClick={() => setPage(page + 1)}
        aria-label="Next products"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
  function modal(titleText: string, children: React.ReactNode, close: () => void) {
    return (
      <div className="overlay">
        <section className="modal" role="dialog" aria-modal="true" aria-label={titleText}>
          <div className="panel-heading">
            <h2>{titleText}</h2>
            <button className="icon-button" onClick={close} aria-label="Close">
              <X />
            </button>
          </div>
          {children}
        </section>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <ShoppingBag size={21} />
          </span>
          ShopFlow<span className="brand-dot">.</span>
        </Link>
        <div className="store-card">
          <div className="store-avatar">{business.slice(0, 1)}</div>
          <div>
            <strong>{business}</strong>
            <small>Retail workspace</small>
          </div>
          <span className="live-dot" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {links
            .filter(
              ([path]) =>
                (managed || !['/purchases', '/reports', '/audit'].includes(path)) &&
                (me.role === 'OWNER' || path !== '/team'),
            )
            .map(([path, label, Icon]) => (
              <Link key={path} href={path} className={pathname === path ? 'active' : ''}>
                <Icon size={19} />
                {label}
                {path === '/pos' && <span className="nav-key">POS</span>}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={19} />
            <span>
              Every change accounted for.<small>Secure access by role.</small>
            </span>
          </div>
          <div className="profile">
            <button
              className="avatar"
              aria-label="Your account"
              onClick={() => setAccountOpen(true)}
            >
              {me.name.slice(0, 1)}
            </button>
            <div>
              <strong>{me.name}</strong>
              <small>{me.role.toLowerCase()}</small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={() =>
                action(async () => {
                  await api('/auth/logout', {});
                  setMe(null);
                  setCsrf('');
                })
              }
            >
              <LogOut size={18} />
            </button>
          </div>
          <small className="credit">ShopFlow · Store workspace</small>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            Retail workspace <ChevronRight size={14} /> <strong>{title}</strong>
          </span>
          <span className="top-date">
            {new Date().toLocaleDateString('en-GB', {
              timeZone: 'Asia/Colombo',
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}{' '}
            <span className="badge">LKR</span>
          </span>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{sectionCopy[section]?.label ?? 'YOUR STORE WORKSPACE'}</p>
              <h1>
                {section === 'overview' ? 'Good to see you, ' + me.name.split(' ')[0] + '.' : title}
              </h1>
              <p>{sectionCopy[section]?.description ?? 'Everything your store needs, together.'}</p>
            </div>
            {section === 'overview' && (
              <Link href="/pos" className="button primary">
                <Plus size={18} /> New sale
              </Link>
            )}
            {section === 'inventory' && managed && (
              <button className="primary" onClick={() => setEditing('new')}>
                <Plus size={18} />
                Add product
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {pending && (
            <div className="alert pending">
              <span>
                A transaction is pending. Retry it with the same reference to check whether it was
                saved.
              </span>
              <button disabled={busy} onClick={() => action(() => submitOnce(pending))}>
                Retry pending request
              </button>
            </div>
          )}
          {loading && (
            <p className="muted" role="status">
              Loading workspace…
            </p>
          )}
          {section === 'overview' && dashboard && (
            <>
              <div className="stats">
                <Stat
                  label="Net sales today"
                  value={currency(dashboard.netMinor)}
                  icon={<CircleDollarSign />}
                  note="Sales less today’s refunds"
                />
                <Stat
                  label="Transactions"
                  value={String(dashboard.saleCount)}
                  icon={<ShoppingCart />}
                  note="Completed sales today"
                />
                <Stat
                  label="Active products"
                  value={String(dashboard.productCount)}
                  icon={<Boxes />}
                  note="Products in your catalogue"
                />
                <Stat
                  label="Refunds today"
                  value={currency(dashboard.refundMinor)}
                  icon={<ClipboardList />}
                  note="Recorded on today’s date"
                />
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Stock that needs attention</h2>
                      <p>At or below the reorder level · up to 20 items</p>
                    </div>
                    <span className="badge amber">{dashboard.lowStock.length} to review</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>On hand</th>
                        <th>Reorder at</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.lowStock.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="product-identity">
                              <ProductPhoto product={p} />
                              <div>
                                <strong>{p.name}</strong>
                                <small>{p.sku}</small>
                              </div>
                            </div>
                          </td>
                          <td>{p.stock}</td>
                          <td>{p.reorderLevel}</td>
                          <td>
                            <span className={'badge ' + (p.stock === 0 ? 'red' : 'amber')}>
                              {p.stock === 0 ? 'Out of stock' : 'Low stock'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!dashboard.lowStock.length && <Empty text="Your stock is looking healthy." />}
                </section>
                <section className="counter-card">
                  <div
                    className="counter-photo"
                    role="img"
                    aria-label="Fresh vegetables on a shop shelf"
                  />
                  <p className="eyebrow">READY WHEN YOU ARE</p>
                  <h2>
                    Your next sale
                    <br />
                    starts here.
                  </h2>
                  <p>Find a product, build a basket, and keep the queue moving.</p>
                  <Link href="/pos" className="button">
                    Open checkout <ChevronRight size={18} />
                  </Link>
                  <div className="counter-footer">
                    <span className="live-dot" /> Cash checkout · LKR
                  </div>
                </section>
              </div>
              <section className="panel day-summary">
                <h2>A quick look at today</h2>
                <span>
                  Gross sales <strong>{currency(dashboard.grossMinor)}</strong>
                </span>
                <span>
                  Refunds <strong>{currency(dashboard.refundMinor)}</strong>
                </span>
                <span>
                  Net sales <strong>{currency(dashboard.netMinor)}</strong>
                </span>
                <small>Business day: {dashboard.today} · Asia/Colombo</small>
              </section>
            </>
          )}
          {section === 'pos' && (
            <div className="pos-layout">
              <section className="panel">
                <div className="catalogue-heading">
                  <div>
                    <p className="eyebrow">PRODUCT CATALOGUE</p>
                    <h2>Ready for the next sale.</h2>
                  </div>
                  <span className="badge green">Cash · LKR</span>
                </div>
                {productSearch}
                <div className="product-grid">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      className={
                        'product-card' +
                        (cart.some((line) => line.product.id === p.id) ? ' in-basket' : '')
                      }
                      disabled={p.stock === 0 || busy || !!pending}
                      onClick={() =>
                        setCart((current) => {
                          const found = current.find((l) => l.product.id === p.id);
                          return found
                            ? current.map((l) =>
                                l.product.id === p.id
                                  ? { ...l, quantity: Math.min(p.stock, l.quantity + 1) }
                                  : l,
                              )
                            : [...current, { product: p, quantity: 1 }];
                        })
                      }
                    >
                      <ProductPhoto product={p} large />
                      {cart.some((line) => line.product.id === p.id) && (
                        <span className="basket-count">
                          {cart.find((line) => line.product.id === p.id)!.quantity} in basket
                        </span>
                      )}
                      <span className="product-meta">
                        <span className="product-sku">{p.sku}</span>
                        <span
                          className={
                            'stock-indicator ' +
                            (p.stock === 0
                              ? 'sold-out'
                              : p.stock <= p.reorderLevel
                                ? 'stock-low'
                                : '')
                          }
                        >
                          {p.stock === 0
                            ? 'Sold out'
                            : p.stock <= p.reorderLevel
                              ? 'Low stock'
                              : 'In stock'}
                        </span>
                      </span>
                      <strong>{p.name}</strong>
                      <span className="product-category">{p.category?.name ?? 'General'}</span>
                      <span className="product-card-footer">
                        <span className="product-price">{currency(p.priceMinor)}</span>
                        <span className="add-product-icon" aria-hidden="true">
                          <Plus size={16} />
                        </span>
                      </span>
                      <small>{p.stock} available</small>
                    </button>
                  ))}
                </div>
                {!products.length && (
                  <Empty text="Add products and receive stock to start selling." />
                )}
              </section>
              <section className="panel basket">
                <div className="panel-heading">
                  <h2>Current sale</h2>
                  <span className="badge">{cart.reduce((n, l) => n + l.quantity, 0)} items</span>
                </div>
                {cart.map((l) => (
                  <div className="cart-line" key={l.product.id}>
                    <ProductPhoto product={l.product} />
                    <div>
                      <strong>{l.product.name}</strong>
                      <small>{currency(l.product.priceMinor)} each</small>
                    </div>
                    <input
                      aria-label={'Quantity for ' + l.product.name}
                      type="number"
                      min={1}
                      max={l.product.stock}
                      disabled={busy || !!pending}
                      value={l.quantity}
                      onChange={(e) =>
                        setCart(
                          cart.map((c) =>
                            c.product.id === l.product.id
                              ? {
                                  ...c,
                                  quantity: Math.max(
                                    1,
                                    Math.min(l.product.stock, Number(e.target.value)),
                                  ),
                                }
                              : c,
                          ),
                        )
                      }
                    />
                    <button
                      className="icon-button"
                      disabled={busy || !!pending}
                      aria-label="Remove item"
                      onClick={() => setCart(cart.filter((c) => c.product.id !== l.product.id))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!cart.length && <Empty text="Your basket is ready for its first item." />}
                <div className="checkout-total">
                  <span>Total</span>
                  <strong>{currency(total)}</strong>
                </div>
                <label>
                  Cash received (LKR)
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={paid}
                    onChange={(e) => setPaid(e.target.value)}
                    disabled={busy || !!pending}
                  />
                </label>
                <p className="hint">
                  The server confirms current prices and stock at checkout. Cash payments only.
                </p>
                <button
                  className="primary full"
                  disabled={busy || !!pending || !cart.length || !paid}
                  onClick={() =>
                    action(async () =>
                      submitOnce({
                        path: '/sales',
                        body: {
                          requestKey: crypto.randomUUID(),
                          lines: cart.map((l) => ({
                            productId: l.product.id,
                            quantity: l.quantity,
                          })),
                          paidMinor: minor(paid),
                        },
                      }),
                    )
                  }
                >
                  {busy ? 'Saving sale…' : 'Complete sale'}
                  <ChevronRight size={18} />
                </button>
                {receipt && (
                  <div className="receipt-success">
                    <strong>SF-{String(receipt.invoiceNo).padStart(8, '0')} saved</strong>
                    <p>
                      Total {currency(receipt.totalMinor)} · Change{' '}
                      {currency(receipt.paidMinor - receipt.totalMinor)}
                    </p>
                    <a className="button" href={`/api/sales/${receipt.id}/invoice.pdf`}>
                      <Download size={16} />
                      Download invoice
                    </a>
                  </div>
                )}
              </section>
            </div>
          )}
          {section === 'inventory' && (
            <>
              <section className="panel">
                {productSearch}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product / SKU</th>
                        <th>Category</th>
                        <th>Selling price</th>
                        {managed && <th>Unit cost</th>}
                        <th>Stock</th>
                        <th>Status</th>
                        {managed && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="product-identity">
                              <ProductPhoto product={p} />
                              <div>
                                <strong>{p.name}</strong>
                                <small>{p.sku}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="category-tag">
                              {p.category?.name ?? 'Uncategorized'}
                            </span>
                          </td>
                          <td>{currency(p.priceMinor)}</td>
                          {managed && <td>{currency(p.costMinor ?? 0)}</td>}
                          <td>{p.stock}</td>
                          <td>
                            <span
                              className={'badge ' + (p.stock <= p.reorderLevel ? 'amber' : 'green')}
                            >
                              {p.stock <= p.reorderLevel ? 'Reorder' : 'In stock'}
                            </span>
                          </td>
                          {managed && (
                            <td>
                              <button onClick={() => setEditing(p)}>Edit</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!products.length && (
                  <Empty text="Your product catalogue starts here. Add your first product." />
                )}
              </section>
              {managed && (
                <div className="two-col">
                  <section className="panel pad">
                    <h2>Categories</h2>
                    <div className="tag-list">
                      {categories.map((c) => (
                        <button
                          key={c.id}
                          className="badge"
                          onClick={() => setEditingNamed({ kind: 'categories', value: c })}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const data = new FormData(form);
                        action(async () => {
                          await api('/categories', { name: data.get('name') });
                          form.reset();
                          await refresh();
                        });
                      }}
                    >
                      <input
                        name="name"
                        placeholder="New category"
                        aria-label="Category name"
                        maxLength={100}
                        required
                      />
                      <button disabled={busy}>
                        <Plus size={16} />
                        Add
                      </button>
                    </form>
                  </section>
                  <section className="panel pad">
                    <h2>Recent stock movements</h2>
                    <p className="hint">Stock changes only through purchases, sales and refunds.</p>
                    <div className="movement-list">
                      {movements.slice(0, 20).map((m) => (
                        <div key={m.id}>
                          <span>
                            <strong>{m.product.name}</strong>
                            <small>
                              {m.kind} · {date(m.createdAt)}
                            </small>
                          </span>
                          <b className={m.delta > 0 ? 'positive' : ''}>
                            {m.delta > 0 ? '+' : ''}
                            {m.delta}
                          </b>
                        </div>
                      ))}
                    </div>
                    {!movements.length && <Empty text="Stock movements will appear here." />}
                  </section>
                </div>
              )}
            </>
          )}
          {section === 'purchases' && managed && (
            <>
              <div className="two-col">
                <section className="panel pad">
                  <h2>Receive a purchase</h2>
                  <p>Receiving stock updates your inventory immediately.</p>
                  {productSearch}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      action(() =>
                        submitOnce({
                          path: '/purchases',
                          body: {
                            requestKey: crypto.randomUUID(),
                            supplierId: data.get('supplierId'),
                            lines: purchaseLines.map((l) => ({
                              productId: l.productId,
                              quantity: l.quantity,
                              costMinor: minor(l.cost),
                            })),
                          },
                        }),
                      );
                    }}
                  >
                    <label>
                      Supplier
                      <select name="supplierId" required>
                        <option value="">Choose supplier</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {purchaseLines.map((line, index) => (
                      <div className="purchase-line" key={index}>
                        <label>
                          Product
                          <select
                            required
                            value={line.productId}
                            onChange={(e) =>
                              setPurchaseLines(
                                purchaseLines.map((l, i) =>
                                  i === index ? { ...l, productId: e.target.value } : l,
                                ),
                              )
                            }
                          >
                            <option value="">Choose product</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.sku})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Quantity
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            required
                            value={line.quantity}
                            onChange={(e) =>
                              setPurchaseLines(
                                purchaseLines.map((l, i) =>
                                  i === index ? { ...l, quantity: Number(e.target.value) } : l,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Unit cost LKR
                          <input
                            inputMode="decimal"
                            required
                            value={line.cost}
                            onChange={(e) =>
                              setPurchaseLines(
                                purchaseLines.map((l, i) =>
                                  i === index ? { ...l, cost: e.target.value } : l,
                                ),
                              )
                            }
                          />
                        </label>
                        {purchaseLines.length > 1 && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Remove purchase line"
                            onClick={() =>
                              setPurchaseLines(purchaseLines.filter((_, i) => i !== index))
                            }
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="form-actions">
                      <button
                        type="button"
                        disabled={purchaseLines.length >= 100}
                        onClick={() =>
                          setPurchaseLines([
                            ...purchaseLines,
                            { productId: '', quantity: 1, cost: '0.00' },
                          ])
                        }
                      >
                        <Plus size={16} />
                        Add line
                      </button>
                      <button className="primary" disabled={busy || !!pending}>
                        Receive stock
                      </button>
                    </div>
                  </form>
                </section>
                <section className="panel pad">
                  <h2>Suppliers</h2>
                  <div className="tag-list">
                    {suppliers.map((s) => (
                      <button
                        className="badge"
                        key={s.id}
                        onClick={() => setEditingNamed({ kind: 'suppliers', value: s })}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const data = new FormData(form);
                      action(async () => {
                        await api('/suppliers', {
                          name: data.get('name'),
                          contact: data.get('contact'),
                        });
                        form.reset();
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Supplier name
                      <input name="name" maxLength={100} required />
                    </label>
                    <label>
                      Contact details
                      <input name="contact" maxLength={200} />
                    </label>
                    <button disabled={busy}>
                      <Plus size={16} />
                      Add supplier
                    </button>
                  </form>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Recent purchases</h2>
                  <small>Latest 100</small>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Supplier</th>
                      <th>Lines</th>
                      <th>Total cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.createdAt)}</td>
                        <td>{p.supplier.name}</td>
                        <td>{p.lines.length}</td>
                        <td>{currency(p.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!purchases.length && <Empty text="No purchases received yet." />}
              </section>
            </>
          )}
          {section === 'sales' && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Sales history</h2>
                <Pager page={page} setPage={setPage} hasNext={sales.length === 50} />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Total</th>
                      <th>Refunded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>SF-{String(s.invoiceNo).padStart(8, '0')}</strong>
                        </td>
                        <td>{date(s.createdAt)}</td>
                        <td>{currency(s.totalMinor)}</td>
                        <td>{currency(s.refunds.reduce((n, r) => n + r.totalMinor, 0))}</td>
                        <td className="row-actions">
                          <a href={`/api/sales/${s.id}/invoice.pdf`} className="button">
                            <Download size={14} />
                            Invoice
                          </a>
                          {managed && (
                            <button
                              disabled={
                                busy ||
                                !!pending ||
                                s.lines.every((l) => l.returnedQuantity === l.quantity)
                              }
                              onClick={() => setRefunding(s)}
                            >
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!sales.length && <Empty text="Completed sales will appear here." />}
            </section>
          )}
          {section === 'reports' && managed && (
            <>
              <section className="panel pad">
                <h2>See the bigger picture</h2>
                <p>Dates follow Sri Lanka business days. Stock reports show current stock.</p>
                <form
                  className="report-filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(async () =>
                      setReport(
                        await api<Report>(`/reports?from=${from}&to=${to}&kind=${reportKind}`),
                      ),
                    );
                  }}
                >
                  <label>
                    Report
                    <select
                      value={reportKind}
                      onChange={(e) => {
                        setReportKind(e.target.value);
                        setReport(null);
                      }}
                    >
                      <option value="sales">Sales & refunds</option>
                      <option value="stock">Current stock</option>
                    </select>
                  </label>
                  <label>
                    From
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        setReport(null);
                      }}
                      required
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => {
                        setTo(e.target.value);
                        setReport(null);
                      }}
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    View report
                  </button>
                </form>
              </section>
              {report && (
                <>
                  <div className="stats">
                    {Object.entries(report.summary).map(([name, value]) => (
                      <Stat
                        key={name}
                        label={reportLabels[name] ?? name}
                        value={name.endsWith('Minor') ? currency(value) : String(value)}
                        icon={<BarChart3 />}
                        note="Selected report"
                      />
                    ))}
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Report details</h2>
                      <div className="row-actions">
                        {['csv', 'pdf'].map((format) => (
                          <a
                            className="button"
                            key={format}
                            href={`/api/reports?from=${from}&to=${to}&kind=${reportKind}&format=${format}`}
                          >
                            <Download size={15} />
                            {format.toUpperCase()}
                          </a>
                        ))}
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {report.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((v, j) => (
                                <td key={j}>{v}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!report.rows.length && <Empty text="No activity in this date range." />}
                  </section>
                </>
              )}
            </>
          )}
          {section === 'team' && me.role === 'OWNER' && (
            <div className="two-col">
              <section className="panel">
                <div className="panel-heading">
                  <h2>Your team</h2>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          <small>{u.email}</small>
                        </td>
                        <td>{u.role}</td>
                        <td>
                          <span className={'badge ' + (u.active ? 'green' : 'red')}>
                            {u.active ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td>
                          {u.role !== 'OWNER' && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  await api('/users/' + u.id, { active: !u.active }, 'PATCH');
                                  await refresh();
                                })
                              }
                            >
                              {u.active ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="panel pad">
                <h2>Add a team member</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const data = Object.fromEntries(new FormData(form));
                    action(async () => {
                      await api('/users', data);
                      form.reset();
                      await refresh();
                      setNotice('Team member created.');
                    });
                  }}
                >
                  <label>
                    Name
                    <input name="name" maxLength={100} required />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" maxLength={254} required />
                  </label>
                  <label>
                    Initial password
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option>CASHIER</option>
                      <option>MANAGER</option>
                      <option>OWNER</option>
                    </select>
                  </label>
                  <p className="hint">
                    Cashiers sell. Managers also manage inventory, refunds and reports. Owners
                    manage the team.
                  </p>
                  <button className="primary" disabled={busy}>
                    Create account
                  </button>
                </form>
              </section>
            </div>
          )}
          {section === 'audit' && managed && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Activity log</h2>
                <Pager page={page} setPage={setPage} hasNext={audit.length === 100} />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{date(a.createdAt)}</td>
                      <td>{a.action.replaceAll('_', ' ')}</td>
                      <td className="mono">{a.entityId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!audit.length && <Empty text="Your store activity will appear here." />}
            </section>
          )}
          {['reports', 'purchases', 'audit'].includes(section) && !managed && (
            <Empty text="Your role does not have access to this page." />
          )}
          {section === 'team' && me.role !== 'OWNER' && (
            <Empty text="Only owners can manage the team." />
          )}
          <footer className="footer">
            <span>ShopFlow · Store workspace</span>
            <span>All amounts in LKR · Asia/Colombo</span>
          </footer>
        </main>
      </div>
      {accountOpen &&
        modal(
          'Your account',
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              action(async () => {
                await api('/auth/password', data);
                setAccountOpen(false);
                setMe(null);
                setCsrf('');
                setNotice('Password changed. Sign in again.');
              });
            }}
          >
            <p>
              Signed in as {me.name} · {me.email}
            </p>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <p className="hint">Changing your password signs out all your sessions.</p>
            <button className="primary" disabled={busy}>
              Change password & sign out
            </button>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </form>,
          () => setAccountOpen(false),
        )}
      {editingNamed &&
        modal(
          editingNamed.kind === 'categories' ? 'Edit category' : 'Edit supplier',
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              action(async () => {
                await api(
                  `/${editingNamed.kind}/${editingNamed.value.id}`,
                  {
                    name: data.get('name'),
                    ...(editingNamed.kind === 'suppliers' ? { contact: data.get('contact') } : {}),
                  },
                  'PATCH',
                );
                setEditingNamed(null);
                await refresh();
              });
            }}
          >
            <label>
              Name
              <input name="name" defaultValue={editingNamed.value.name} maxLength={100} required />
            </label>
            {editingNamed.kind === 'suppliers' && (
              <label>
                Contact details
                <input
                  name="contact"
                  defaultValue={editingNamed.value.contact ?? ''}
                  maxLength={200}
                />
              </label>
            )}
            <p className="hint">
              Records used by products or purchases are kept to preserve history.
            </p>
            <div className="form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api(`/${editingNamed.kind}/${editingNamed.value.id}`, {}, 'DELETE');
                    setEditingNamed(null);
                    await refresh();
                  })
                }
              >
                Delete unused record
              </button>
              <button className="primary" disabled={busy}>
                Save changes
              </button>
            </div>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </form>,
          () => setEditingNamed(null),
        )}
      {editing &&
        modal(
          editing === 'new' ? 'Add a product' : 'Edit product',
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              action(async () => {
                if (photoProcessing) throw new Error('Wait for the photo to finish preparing.');
                const body = {
                  sku: data.get('sku'),
                  name: data.get('name'),
                  priceMinor: minor(String(data.get('price'))),
                  costMinor: minor(String(data.get('cost'))),
                  reorderLevel: Number(data.get('reorderLevel')),
                  categoryId: data.get('categoryId') || null,
                  ...(data.get('photo') ? { photo: JSON.parse(String(data.get('photo'))) } : {}),
                };
                await api(
                  editing === 'new' ? '/products' : '/products/' + editing.id,
                  body,
                  editing === 'new' ? 'POST' : 'PATCH',
                );
                setEditing(null);
                await refresh();
                setNotice('Product saved.');
              });
            }}
          >
            <label>
              Product name
              <input
                name="name"
                defaultValue={editing === 'new' ? '' : editing.name}
                maxLength={160}
                required
              />
            </label>
            <label>
              SKU
              <input
                name="sku"
                defaultValue={editing === 'new' ? '' : editing.sku}
                maxLength={60}
                required
              />
            </label>
            <div className="two-col">
              <label>
                Selling price LKR
                <input
                  name="price"
                  inputMode="decimal"
                  defaultValue={editing === 'new' ? '' : (editing.priceMinor / 100).toFixed(2)}
                  required
                />
              </label>
              <label>
                Unit cost LKR
                <input
                  name="cost"
                  inputMode="decimal"
                  defaultValue={
                    editing === 'new' ? '0.00' : ((editing.costMinor ?? 0) / 100).toFixed(2)
                  }
                  required
                />
              </label>
            </div>
            <label>
              Category
              <select
                name="categoryId"
                defaultValue={editing === 'new' ? '' : (editing.categoryId ?? '')}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reorder level
              <input
                name="reorderLevel"
                type="number"
                min={0}
                max={1000000}
                defaultValue={editing === 'new' ? 5 : editing.reorderLevel}
                required
              />
            </label>
            <PhotoPicker
              key={editing === 'new' ? 'new' : editing.id}
              product={editing === 'new' ? undefined : editing}
              onProcessing={setPhotoProcessing}
            />
            <p className="hint">
              New products start with zero stock. Receive a purchase to add inventory.
            </p>
            <div className="form-actions">
              {editing !== 'new' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api('/products/' + editing.id, { active: false }, 'PATCH');
                      setEditing(null);
                      await refresh();
                      setNotice('Product archived.');
                    })
                  }
                >
                  Archive product
                </button>
              )}
              <button className="primary" disabled={busy || photoProcessing}>
                Save product
              </button>
            </div>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </form>,
          () => setEditing(null),
        )}
      {refunding &&
        modal(
          'Refund SF-' + String(refunding.invoiceNo).padStart(8, '0'),
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              action(async () => {
                const lines = refunding.lines
                  .map((l) => ({ saleLineId: l.id, quantity: Number(data.get(l.id) || 0) }))
                  .filter((l) => l.quantity > 0);
                if (!lines.length) throw new Error('Choose a quantity to refund');
                await submitOnce({
                  path: `/sales/${refunding.id}/refunds`,
                  body: { requestKey: crypto.randomUUID(), reason: data.get('reason'), lines },
                });
              });
            }}
          >
            <p>Returned goods go back into stock. Refunds use the original selling price.</p>
            {refunding.lines.map((l) => (
              <label key={l.id}>
                {l.name} · {l.quantity - l.returnedQuantity} returnable
                <input
                  type="number"
                  name={l.id}
                  min={0}
                  max={l.quantity - l.returnedQuantity}
                  defaultValue={0}
                />
              </label>
            ))}
            <label>
              Reason
              <textarea name="reason" minLength={3} maxLength={300} required />
            </label>
            <p className="hint">
              This records a cash refund. Return the cash to the customer after it succeeds.
            </p>
            <button className="primary" disabled={busy || !!pending}>
              Record refund & restore stock
            </button>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </form>,
          () => setRefunding(null),
        )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
}) {
  return (
    <section className="stat">
      <div>
        <span>{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ShoppingBag size={28} />
      <p>{text}</p>
    </div>
  );
}
function Pager({
  page,
  setPage,
  hasNext,
}: {
  page: number;
  setPage: (n: number) => void;
  hasNext: boolean;
}) {
  return (
    <div className="row-actions">
      <button disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span>{page}</span>
      <button disabled={!hasNext} onClick={() => setPage(page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
