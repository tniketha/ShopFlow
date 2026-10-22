'use client';
import { useState } from 'react';
type Preview = {
  total: number;
  valid: number;
  rows: { row: number; values: Record<string, string>; errors: string[] }[];
};
export function CsvImport({
  preview,
  onImport,
  onRetry,
  disabled,
  pending,
}: {
  preview: (csv: string) => Promise<Preview>;
  onImport: (csv: string) => Promise<void>;
  onRetry: () => Promise<void>;
  disabled: boolean;
  pending: boolean;
}) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function run(task: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Import could not be completed.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="csv-import">
      <p className="hint">
        Add up to 500 new products. Prices and costs are in LKR; new stock starts at zero. Existing
        products are never overwritten.
      </p>
      <a className="button" href="/templates/products.csv" download>
        Download CSV template
      </a>
      {pending ? (
        <div className="alert pending">
          <p>
            An import is awaiting confirmation. Retry the saved request before choosing another
            file.
          </p>
          <button disabled={working} onClick={() => run(onRetry)}>
            Retry saved import
          </button>
        </div>
      ) : (
        <>
          <label>
            Product CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={disabled || working}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                setResult(null);
                setCsv('');
                setFilename('');
                setError('');
                if (!file) return;
                if (!file.name.toLowerCase().endsWith('.csv') || file.size > 524288) {
                  setError('Choose a CSV file smaller than 512 KB.');
                  return;
                }
                await run(async () => {
                  setCsv(await file.text());
                  setFilename(file.name);
                });
              }}
            />
          </label>
          {filename && <p className="hint">Selected: {filename}</p>}
          <button
            disabled={!csv || disabled || working}
            onClick={() =>
              run(async () => {
                setResult(await preview(csv));
              })
            }
          >
            Preview import
          </button>
          {result && (
            <>
              <p role="status" className="import-summary">
                {result.valid} of {result.total} rows ready.{' '}
                {result.total - result.valid
                  ? 'Correct the highlighted errors and choose the corrected file.'
                  : 'Review the values before confirming.'}
              </p>
              <div className="table-wrap csv-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Price LKR</th>
                      <th>Cost LKR</th>
                      <th>Barcode</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.row} className={row.errors.length ? 'csv-invalid' : ''}>
                        <td>{row.row}</td>
                        <td>{row.values.sku}</td>
                        <td>{row.values.name}</td>
                        <td>{row.values.price}</td>
                        <td>{row.values.cost}</td>
                        <td>{row.values.barcode || '—'}</td>
                        <td>
                          {row.errors.length ? (
                            <ul>
                              {row.errors.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          ) : (
                            'Ready'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button
                  className="primary"
                  disabled={disabled || working || result.valid !== result.total}
                  onClick={() => run(() => onImport(csv))}
                >
                  {working ? 'Saving…' : `Import ${result.total} products`}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Category names must exactly match categories already in your store. Stock quantities cannot
        be imported; receive a purchase to add stock.
      </p>
    </div>
  );
}
