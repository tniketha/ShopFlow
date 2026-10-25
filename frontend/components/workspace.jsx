'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProductPhoto } from './product-photo';
import { BrandMark, BrandName } from './brand';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
function formatAmount(amountInCents) {
  const amount = BigInt(amountInCents);
  const rupees = new Intl.NumberFormat('en-LK').format(amount / 100n);
  const cents = String(amount % 100n).padStart(2, '0');
  return `LKR ${rupees}.${cents}`;
}
const formatDate = (value) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
function parseAmount(value) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value))
    throw new Error('Use an LKR amount with up to two decimal places');
  const [rupees, cents = ''] = value.split('.');
  return Number(rupees) * 100 + Number(cents.padEnd(2, '0'));
}
const links = [
  ['/', 'Overview', LayoutDashboard],
  ['/pos', 'Point of sale', ShoppingCart],
  ['/inventory', 'Inventory', Boxes],
  ['/purchases', 'Purchases', PackagePlus],
  ['/sales', 'Sales history', ClipboardList],
];
const sectionCopy = {
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
    label: 'SALES HISTORY',
    description: 'Review completed sales and their original prices.',
  },
};
export default function Workspace() {
  const pathname = usePathname();
  const section = pathname.split('/')[1] || 'overview';
  const [me, setMe] = useState(null);
  const [business, setBusiness] = useState('ShopFlow');
  const [csrf, setCsrf] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const refreshSequence = useRef(0);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  const [paid, setPaid] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [pending, setPending] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingNamed, setEditingNamed] = useState(null);
  const canManageStock = me?.role === 'OWNER' || me?.role === 'MANAGER';
  const requestApi = useCallback(
    async (path, body, method = 'POST') => {
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
  const loadPageData = useCallback(
    async (isCurrent = () => true) => {
      if (!me) return;
      const sequence = ++refreshSequence.current;
      const current = () => isCurrent() && sequence === refreshSequence.current;
      async function load(path, setter) {
        const data = await requestApi(path);
        if (current()) setter(data);
      }
      const jobs = [];
      if (section === 'overview') jobs.push(load('/dashboard', setDashboard));
      if (['inventory', 'pos', 'purchases'].includes(section)) {
        jobs.push(
          (async () => {
            const query = new URLSearchParams({
              page: String(page),
              search,
            });
            const data = await requestApi(`/products?${query}`);
            if (!current()) return;
            setProducts(data.items);
            setCount(data.count);
            if (page > Math.max(1, Math.ceil(data.count / 50)))
              setPage(Math.max(1, Math.ceil(data.count / 50)));
          })(),
        );
        jobs.push(load('/categories', setCategories));
      }
      if (section === 'purchases' && canManageStock) {
        jobs.push(load('/suppliers', setSuppliers), load('/purchases', setPurchases));
      }
      if (section === 'sales') jobs.push(load(`/sales?page=${page}`, setSales));
      await Promise.all(jobs);
    },
    [requestApi, me, section, page, search, canManageStock],
  );
  const latestLoader = useRef(loadPageData);
  latestLoader.current = loadPageData;
  useEffect(() => {
    requestApi('/auth/me')
      .then((data) => {
        setMe(data.user);
        setCsrf(data.csrf);
        setBusiness(data.business.name);
        const saved = sessionStorage.getItem('shopflow-pending:' + data.user.id);
        if (saved) {
          const request = JSON.parse(saved);
          if (request && ['/sales', '/purchases'].includes(request.path)) setPending(request);
          else sessionStorage.removeItem('shopflow-pending:' + data.user.id);
        }
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
        loadPageData(() => alive)
          .catch((event) => {
            if (alive) setError(event.message);
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
  }, [loadPageData, search]);
  async function performAction(work) {
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
  async function submitOnce(request) {
    if (!me) return;
    if (pending && JSON.stringify(pending) !== JSON.stringify(request))
      throw new Error('Resolve the pending request before starting a different transaction.');
    const storageKey = 'shopflow-pending:' + me.id;
    sessionStorage.setItem(storageKey, JSON.stringify(request));
    setPending(request);
    try {
      const result = await requestApi(request.path, request.body);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      if (request.path === '/sales') {
        setReceipt(result);
        setCart([]);
        setPaid('');
      }
      setNotice('Transaction saved.');
      await latestLoader.current();
    } catch (e) {
      const status = e.status;
      if (status && [400, 403, 404, 409, 413].includes(status)) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      throw e;
    }
  }
  async function login(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await performAction(async () => {
      const result = await requestApi('/auth/login', {
        email: data.get('email'),
        password: data.get('password'),
      });
      setMe(result.user);
      setCsrf(result.csrf);
      window.location.assign('/');
    });
  }
  function addToCart(product) {
    setReceipt(null);
    setCart((current) => {
      const found = current.find((line) => line.product.id === product.id);
      return found
        ? current.map((line) =>
            line.product.id === product.id
              ? { ...line, quantity: Math.min(product.stock, line.quantity + 1) }
              : line,
          )
        : [...current, { product, quantity: 1 }];
    });
  }
  if (loading && !me)
    return (
      <main className="splash">
        <BrandMark />
        <p>Opening your workspace…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <BrandMark inverse />
            <BrandName />
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
  const title = links.find((line) => line[0] === pathname)?.[1] ?? 'Page not found';
  const total = cart.reduce((total, line) => total + line.product.priceMinor * line.quantity, 0);
  const productSearch = (
    <div className="catalogue-controls">
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            aria-label="Search products"
            placeholder="Search products or SKU…"
            value={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="muted">{count} products</span>
        <button
          type="button"
          className="icon-button"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          aria-label="Previous products"
        >
          <ChevronLeft size={18} />
        </button>
        <span>{page}</span>
        <button
          type="button"
          className="icon-button"
          disabled={page * 50 >= count}
          onClick={() => setPage(page + 1)}
          aria-label="Next products"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
  function modal(titleText, children, close) {
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
          <BrandMark inverse />
          <BrandName />
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
            .filter(([path]) => canManageStock || path !== '/purchases')
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
              Your daily store tasks.<small>Stock and cash sales.</small>
            </span>
          </div>
          <div className="profile">
            <div>
              <strong>{me.name}</strong>
              <small>{me.role.toLowerCase()}</small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={() =>
                performAction(async () => {
                  await requestApi('/auth/logout', {});
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
            {section === 'inventory' && canManageStock && (
              <div className="row-actions">
                <button className="primary" onClick={() => setEditing('new')}>
                  <Plus size={18} />
                  Add product
                </button>
              </div>
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
              <button disabled={busy} onClick={() => performAction(() => submitOnce(pending))}>
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
                  label="Sales today"
                  value={formatAmount(dashboard.totalMinor)}
                  icon={<CircleDollarSign />}
                  note="Completed cash sales"
                />
                <Stat
                  label="Transactions"
                  value={String(dashboard.saleCount)}
                  icon={<ShoppingCart />}
                  note="Completed sales today"
                />
                <Stat
                  label="Products"
                  value={String(dashboard.productCount)}
                  icon={<Boxes />}
                  note="Active products"
                />
                <Stat
                  label="Units in stock"
                  value={String(dashboard.stockCount)}
                  icon={<PackagePlus />}
                  note="Across your products"
                />
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Recent sales</h2>
                    <Link href="/sales">View all</Link>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Sale</th>
                          <th>Date</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.recentSales.map((sale) => (
                          <tr key={sale.id}>
                            <td>SF-{String(sale.invoiceNo).padStart(8, '0')}</td>
                            <td>{formatDate(sale.createdAt)}</td>
                            <td>{formatAmount(sale.totalMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!dashboard.recentSales.length && (
                    <Empty text="Completed sales will appear here." />
                  )}
                </section>
                <section className="counter-card">
                  <div
                    className="counter-photo"
                    role="img"
                    aria-label="Fresh vegetables on a shop shelf"
                  />
                  <p className="eyebrow">READY WHEN YOU ARE</p>
                  <h2>Your next sale starts here.</h2>
                  <p>Find a product, build a basket, and keep the queue moving.</p>
                  <Link href="/pos" className="button">
                    Open checkout <ChevronRight size={18} />
                  </Link>
                  <div className="counter-footer">Cash checkout · LKR</div>
                </section>
              </div>
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
                  {products.map((product) => (
                    <div className="product-tile" key={product.id}>
                      <button
                        className={
                          'product-card' +
                          (cart.some((line) => line.product.id === product.id) ? ' in-basket' : '')
                        }
                        disabled={product.stock === 0 || busy || !!pending}
                        onClick={() => addToCart(product)}
                      >
                        <ProductPhoto product={product} large />
                        {cart.some((line) => line.product.id === product.id) && (
                          <span className="basket-count">
                            {cart.find((line) => line.product.id === product.id).quantity} in basket
                          </span>
                        )}
                        <span className="product-meta">
                          <span className="product-sku">{product.sku}</span>
                          <span
                            className={'stock-indicator ' + (product.stock === 0 ? 'sold-out' : '')}
                          >
                            {product.stock === 0 ? 'Sold out' : 'In stock'}
                          </span>
                        </span>
                        <strong>{product.name}</strong>
                        <span className="product-category">
                          {product.category?.name ?? 'General'}
                        </span>
                        <span className="product-card-footer">
                          <span className="product-price">{formatAmount(product.priceMinor)}</span>
                          <span className="add-product-icon" aria-hidden="true">
                            <Plus size={16} />
                          </span>
                        </span>
                        <small>{product.stock} available</small>
                      </button>
                    </div>
                  ))}
                </div>
                {!products.length && <Empty text="No products found. Try another search." />}
              </section>
              <section className="panel basket">
                <div className="panel-heading">
                  <h2>Current sale</h2>
                  <span className="badge">
                    {cart.reduce((total, line) => total + line.quantity, 0)} items
                  </span>
                </div>
                {cart.map((line) => (
                  <div className="cart-line" key={line.product.id}>
                    <ProductPhoto product={line.product} />
                    <div>
                      <strong>{line.product.name}</strong>
                      <small>{formatAmount(line.product.priceMinor)} each</small>
                    </div>
                    <input
                      aria-label={'Quantity for ' + line.product.name}
                      type="number"
                      min={1}
                      max={line.product.stock}
                      disabled={busy || !!pending}
                      value={line.quantity}
                      onChange={(event) =>
                        setCart(
                          cart.map((category) =>
                            category.product.id === line.product.id
                              ? {
                                  ...category,
                                  quantity: Math.max(
                                    1,
                                    Math.min(line.product.stock, Number(event.target.value)),
                                  ),
                                }
                              : category,
                          ),
                        )
                      }
                    />
                    <button
                      className="icon-button"
                      disabled={busy || !!pending}
                      aria-label="Remove item"
                      onClick={() =>
                        setCart(cart.filter((category) => category.product.id !== line.product.id))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!cart.length && <Empty text="Your basket is ready for its first item." />}
                <div className="checkout-total">
                  <span>Total</span>
                  <strong>{formatAmount(total)}</strong>
                </div>
                <label>
                  Cash received (LKR)
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={paid}
                    onChange={(event) => setPaid(event.target.value)}
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
                    performAction(async () =>
                      submitOnce({
                        path: '/sales',
                        body: {
                          requestKey: crypto.randomUUID(),
                          lines: cart.map((line) => ({
                            productId: line.product.id,
                            quantity: line.quantity,
                          })),
                          paidMinor: parseAmount(paid),
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
                      Total {formatAmount(receipt.totalMinor)} · Change{' '}
                      {formatAmount(receipt.paidMinor - receipt.totalMinor)}
                    </p>
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
                        {canManageStock && <th>Unit cost</th>}
                        <th>Stock</th>
                        <th>Status</th>
                        {canManageStock && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <div className="product-identity">
                              <ProductPhoto product={product} />
                              <div>
                                <strong>{product.name}</strong>
                                <small>{product.sku}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="category-tag">
                              {product.category?.name ?? 'Uncategorized'}
                            </span>
                          </td>
                          <td>{formatAmount(product.priceMinor)}</td>
                          {canManageStock && <td>{formatAmount(product.costMinor ?? 0)}</td>}
                          <td>{product.stock}</td>
                          <td>
                            <span className={'badge ' + (product.stock === 0 ? 'amber' : 'green')}>
                              {product.stock === 0 ? 'Out of stock' : 'In stock'}
                            </span>
                          </td>
                          {canManageStock && (
                            <td>
                              <button onClick={() => setEditing(product)}>Edit</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!products.length && (
                  <Empty text="No products found. Try another search or clear filters." />
                )}
              </section>
              {canManageStock && (
                <div className="two-col">
                  <section className="panel pad">
                    <h2>Categories</h2>
                    <div className="tag-list">
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          className="badge"
                          onClick={() => setEditingNamed({ kind: 'categories', value: category })}
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const data = new FormData(form);
                        performAction(async () => {
                          await requestApi('/categories', { name: data.get('name') });
                          form.reset();
                          await loadPageData();
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
                </div>
              )}
            </>
          )}
          {section === 'purchases' && canManageStock && (
            <>
              <div className="two-col">
                <section className="panel pad">
                  <h2>Receive a purchase</h2>
                  <p>Choose a product and record the stock received.</p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const fields = new FormData(form);
                      performAction(async () => {
                        await submitOnce({
                          path: '/purchases',
                          body: {
                            requestKey: crypto.randomUUID(),
                            supplierId: fields.get('supplierId'),
                            lines: [
                              {
                                productId: fields.get('productId'),
                                quantity: Number(fields.get('quantity')),
                                costMinor: parseAmount(String(fields.get('cost'))),
                              },
                            ],
                          },
                        });
                        form.reset();
                      });
                    }}
                  >
                    {productSearch}
                    <label>
                      Supplier
                      <select name="supplierId" defaultValue="" required>
                        <option value="">Choose supplier</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Product
                      <select name="productId" defaultValue="" required>
                        <option value="">Choose product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} ({product.sku})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two-col">
                      <label>
                        Quantity
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={100000}
                          defaultValue={1}
                          required
                        />
                      </label>
                      <label>
                        Unit cost LKR
                        <input name="cost" inputMode="decimal" defaultValue="0.00" required />
                      </label>
                    </div>
                    <button className="primary" disabled={busy || !!pending}>
                      Receive stock
                    </button>
                  </form>
                </section>
                <section className="panel pad">
                  <h2>Suppliers</h2>
                  <div className="chips">
                    {suppliers.map((supplier) => (
                      <button
                        key={supplier.id}
                        onClick={() => setEditingNamed({ kind: 'suppliers', value: supplier })}
                      >
                        {supplier.name}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const fields = new FormData(form);
                      performAction(async () => {
                        await requestApi('/suppliers', {
                          name: fields.get('name'),
                          contact: fields.get('contact'),
                        });
                        form.reset();
                        await loadPageData();
                        setNotice('Supplier saved.');
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
                    <button disabled={busy}>Add supplier</button>
                  </form>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Recent purchases</h2>
                  <span className="muted">Latest 100</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Received</th>
                        <th>Supplier</th>
                        <th>Total cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.map((purchase) => (
                        <tr key={purchase.id}>
                          <td>{formatDate(purchase.createdAt)}</td>
                          <td>{purchase.supplier.name}</td>
                          <td>{formatAmount(purchase.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!purchases.length && <Empty text="Received purchases will appear here." />}
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
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <strong>SF-{String(sale.invoiceNo).padStart(8, '0')}</strong>
                        </td>
                        <td>{formatDate(sale.createdAt)}</td>
                        <td>{formatAmount(sale.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!sales.length && <Empty text="Completed sales will appear here." />}
            </section>
          )}
          {section === 'purchases' && !canManageStock && (
            <Empty text="Your account cannot manage purchases." />
          )}
          <footer className="footer">
            <span>ShopFlow · Store workspace</span>
            <span>All amounts in LKR · Asia/Colombo</span>
          </footer>
        </main>
      </div>
      {editingNamed &&
        modal(
          editingNamed.kind === 'categories' ? 'Edit category' : 'Edit supplier',
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              performAction(async () => {
                await requestApi(
                  `/${editingNamed.kind}/${editingNamed.value.id}`,
                  {
                    name: data.get('name'),
                    ...(editingNamed.kind === 'suppliers' ? { contact: data.get('contact') } : {}),
                  },
                  'PATCH',
                );
                setEditingNamed(null);
                await loadPageData();
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
                  performAction(async () => {
                    await requestApi(
                      `/${editingNamed.kind}/${editingNamed.value.id}`,
                      {},
                      'DELETE',
                    );
                    setEditingNamed(null);
                    await loadPageData();
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
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              performAction(async () => {
                const body = {
                  sku: data.get('sku'),
                  name: data.get('name'),
                  priceMinor: parseAmount(String(data.get('price'))),
                  costMinor: parseAmount(String(data.get('cost'))),
                  categoryId: data.get('categoryId') || null,
                };
                await requestApi(
                  editing === 'new' ? '/products' : '/products/' + editing.id,
                  body,
                  editing === 'new' ? 'POST' : 'PATCH',
                );
                setEditing(null);
                await loadPageData();
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
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              New products start with zero stock. Receive a purchase to add inventory.
            </p>
            <div className="form-actions">
              {editing !== 'new' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    performAction(async () => {
                      await requestApi('/products/' + editing.id, { active: false }, 'PATCH');
                      setEditing(null);
                      await loadPageData();
                      setNotice('Product archived.');
                    })
                  }
                >
                  Archive product
                </button>
              )}
              <button className="primary" disabled={busy}>
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
    </div>
  );
}
function Stat({ label, value, icon, note }) {
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
function Empty({ text }) {
  return (
    <div className="empty">
      <ShoppingBag size={28} />
      <p>{text}</p>
    </div>
  );
}
function Pager({ page, setPage, hasNext }) {
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
