'use client';
import { useEffect, useState } from 'react';
type Daily = {
  date: string;
  grossMinor: number;
  refundMinor: number;
  netMinor: number;
  transactions: number;
};
type Analytics = {
  days: number;
  from: string;
  to: string;
  daily: Daily[];
  summary: Omit<Daily, 'date'>;
  topProducts: { productId: string; name: string; units: number; revenueMinor: number }[];
};
const currency = (minor: number) => {
  const amount = BigInt(minor),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}LKR ${new Intl.NumberFormat('en-LK').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
};
const label = (date: string) =>
  new Date(date + 'T12:00:00+05:30').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Colombo',
  });
export function SalesInsights({ load }: { load: <T>(path: string) => Promise<T> }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [received, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    load<Analytics>(`/analytics/sales?days=${days}`)
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((failure) => {
        if (alive) setError(failure.message);
      });
    return () => {
      alive = false;
    };
  }, [load, days, retry]);
  const data = received?.days === days ? received : null;
  const min = data ? Math.min(0, ...data.daily.map((day) => day.netMinor)) : 0;
  const max = data ? Math.max(100, ...data.daily.map((day) => day.netMinor)) : 100;
  const y = (amount: number) => 180 - ((amount - min) / (max - min)) * 150;
  const x = (index: number) => 20 + (index / (days - 1)) * 580;
  const points = data?.daily.map((day, index) => `${x(index)},${y(day.netMinor)}`).join(' ') ?? '';
  const hasActivity = data?.daily.some((day) => day.grossMinor || day.refundMinor);
  return (
    <section className="panel sales-insights" aria-label="Sales insights">
      <div className="panel-heading">
        <div>
          <h2>Sales at a glance</h2>
          <p>Net sales after refunds · Sri Lanka business days</p>
        </div>
        <div className="period-switch" role="group" aria-label="Sales chart period">
          {([7, 30] as const).map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => setDays(period)}
            >
              Last {period} days
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="pad">
          <p role="alert" className="error-text">
            {error}
          </p>
          <button onClick={() => setRetry(retry + 1)}>Retry chart</button>
        </div>
      ) : !data ? (
        <p className="pad" role="status">
          Loading sales insights…
        </p>
      ) : (
        <>
          <div className="insights-grid">
            <div className="sales-chart">
              <div className="chart-summary">
                <div>
                  <span>Net sales</span>
                  <strong>{currency(data.summary.netMinor)}</strong>
                </div>
                <span>
                  {label(data.from)} – {label(data.to)}
                </span>
              </div>
              {!hasActivity && (
                <p className="hint">
                  No sales or refunds in this period. Your chart will update as you trade.
                </p>
              )}
              <svg
                viewBox="0 0 620 220"
                role="img"
                aria-label={`Daily net sales for the last ${days} days`}
              >
                <desc>
                  Each point shows sales less refunds recorded that day. Exact values are available
                  in the daily figures table below.
                </desc>
                {[30, 105, 180].map((position) => (
                  <line
                    key={position}
                    x1="20"
                    x2="600"
                    y1={position}
                    y2={position}
                    stroke="#e0e6dd"
                    strokeDasharray="4 5"
                  />
                ))}
                <line x1="20" x2="600" y1={y(0)} y2={y(0)} stroke="#9bad91" />
                <polygon points={`20,${y(0)} ${points} 600,${y(0)}`} fill="#d8e6a3" opacity=".45" />
                <polyline
                  points={points}
                  fill="none"
                  stroke="#1d6248"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                {data.daily.map((day, index) => (
                  <circle
                    key={day.date}
                    cx={x(index)}
                    cy={y(day.netMinor)}
                    r={days === 7 ? 4 : 2.5}
                    fill="#1d6248"
                  >
                    <title>
                      {label(day.date)}: {currency(day.netMinor)} net; {day.transactions} sales
                    </title>
                  </circle>
                ))}
                {[0, Math.floor((days - 1) / 2), days - 1].map((index) => (
                  <text
                    key={index}
                    x={x(index)}
                    y="211"
                    textAnchor={index === 0 ? 'start' : index === days - 1 ? 'end' : 'middle'}
                    fill="#62756a"
                    fontSize="12"
                  >
                    {label(data.daily[index]!.date)}
                  </text>
                ))}
              </svg>
              <div className="chart-range">
                <span>Low: {currency(min)}</span>
                <span>High: {currency(Math.max(...data.daily.map((day) => day.netMinor), 0))}</span>
              </div>
            </div>
            <div className="top-products">
              <h3>Top 5 products</h3>
              <p className="hint">Ranked by units sold, before returns.</p>
              {!data.topProducts.length ? (
                <p className="muted">Products appear here after your first sale.</p>
              ) : (
                <ol>
                  {data.topProducts.map((product) => (
                    <li key={product.productId}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>{product.units} sold</span>
                      </div>
                      <div className="product-rank-track">
                        <span
                          style={{
                            width: `${Math.max(2, (product.units / data.topProducts[0]!.units) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <details className="daily-figures">
            <summary>View daily figures</summary>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Daily sales and refunds in LKR</caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sales</th>
                    <th>Gross</th>
                    <th>Refunds</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => (
                    <tr key={day.date}>
                      <td>{label(day.date)}</td>
                      <td>{day.transactions}</td>
                      <td>{currency(day.grossMinor)}</td>
                      <td>{currency(day.refundMinor)}</td>
                      <td>{currency(day.netMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
