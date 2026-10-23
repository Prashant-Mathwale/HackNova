import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, BarChart3, Bolt, Check, ChevronDown, CircleAlert,
  CircleHelp, Clock3, CloudUpload, Database, FileSpreadsheet, House, LayoutDashboard,
  LoaderCircle, LockKeyhole, LogOut, Mail, Menu, ShieldCheck, Sparkles, TriangleAlert,
  Upload, Waves, X, Zap
} from 'lucide-react';
import { getAnomalies, getConsumptionSample, getForecast, loginUser, registerUser, uploadCsv, waitForAnalysis } from './api.js';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload data', icon: CloudUpload },
  { id: 'consumption', label: 'Consumption', icon: Activity },
  { id: 'peak', label: 'Peak demand', icon: Bolt },
  { id: 'forecast', label: 'Forecast', icon: Waves },
  { id: 'anomalies', label: 'Anomaly review', icon: TriangleAlert },
  { id: 'quality', label: 'Data quality', icon: ShieldCheck }
];

const formatNumber = (value, digits = 2) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '--';
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not available';
const formatDateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available';

function Logo({ small = false }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><Zap size={17} fill="currentColor" /></span><span className="brand-name">Energy<span>IQ</span></span></div>;
}

function Login({ onContinue }) {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccessMsg('');

    if (mode === 'register' && !name.trim()) {
      return setError('Please enter your full name.');
    }
    if (!email.trim() || !password) {
      return setError('Please enter both email and password.');
    }
    if (mode === 'register' && password.length < 6) {
      return setError('Password must be at least 6 characters long.');
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        const result = await registerUser(name.trim(), email.trim(), password);
        setSuccessMsg('Account created successfully! Signing you in...');
        setTimeout(() => {
          onContinue(result.email || email.trim());
        }, 800);
      } else {
        const result = await loginUser(email.trim(), password);
        onContinue(result.email || email.trim());
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-page">
    <div className="login-top"><Logo /><span className="preview-chip"><i /> LIVE APP</span></div>
    <div className="login-layout">
      <section className="login-intro">
        <p className="eyebrow"><i /> SMART METER ANALYTICS</p>
        <h1>Know where your<br /><em>energy goes.</em></h1>
        <p className="intro-copy">Turn household meter readings into a clearer picture of consumption, demand and unusual patterns.</p>
        <div className="intro-note">
          <span className="note-icon"><Activity size={17} /></span>
          <span><strong>One workspace. Clear signals.</strong><small>Upload a CSV to begin an analysis.</small></span>
        </div>
      </section>

      <section className="login-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>{mode === 'login' ? 'Sign in to EnergyIQ' : 'Create an Account'}</h2>
          </div>
          <span className="panel-shield"><ShieldCheck size={19} /></span>
        </div>

        <div className="auth-tabs" style={{ display: 'flex', gap: '8px', margin: '20px 0 16px', background: '#f0f5f2', padding: '4px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: 0,
              borderRadius: '6px',
              background: mode === 'login' ? '#fff' : 'transparent',
              fontWeight: mode === 'login' ? '600' : '400',
              color: mode === 'login' ? 'var(--green-dark)' : 'var(--muted)',
              boxShadow: mode === 'login' ? '0 2px 6px rgba(0,0,0,.06)' : 'none',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: 0,
              borderRadius: '6px',
              background: mode === 'register' ? '#fff' : 'transparent',
              fontWeight: mode === 'register' ? '600' : '400',
              color: mode === 'register' ? 'var(--green-dark)' : 'var(--muted)',
              boxShadow: mode === 'register' ? '0 2px 6px rgba(0,0,0,.06)' : 'none',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Register
          </button>
        </div>

        <button className="demo-access" type="button" onClick={() => onContinue('demo@energyiq.local')}>
          <span className="demo-icon"><Zap size={18} fill="currentColor" /></span>
          <span><strong>Continue with demo access</strong><small>Skip login and open the workspace</small></span>
          <ArrowRight size={18} />
        </button>

        <div className="form-divider"><i /> OR WITH YOUR ACCOUNT <i /></div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div style={{ marginBottom: '14px' }}>
              <label className="field-label" htmlFor="name">Full Name</label>
              <div className="input-wrap">
                <input
                  id="name"
                  type="text"
                  placeholder="e.g. Alex Taylor"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            </div>
          )}

          <label className="field-label" htmlFor="email">Email address</label>
          <div className="input-wrap">
            <Mail size={16} />
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="password-label">
            <label className="field-label" htmlFor="password">Password</label>
            {mode === 'login' && (
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Min 6 characters</span>
            )}
          </div>
          <div className="input-wrap">
            <LockKeyhole size={16} />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder={mode === 'register' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
            <button
              type="button"
              className="input-action"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <X size={15} /> : <CircleHelp size={15} />}
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          {successMsg && <p style={{ margin: '10px 0 0', color: 'var(--green)', fontSize: '12px' }}>{successMsg}</p>}

          <button className="primary-button login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Please wait...' : (mode === 'register' ? 'Create Account' : 'Sign In')} <ArrowRight size={16} />
          </button>
        </form>

        <p className="auth-disclaimer">
          <ShieldCheck size={13} /> Secure authentication connected to MongoDB Atlas.
        </p>
      </section>
    </div>
    <div className="login-footer"><span>ENERGYIQ / HACKNOVA '26</span><span>Household energy intelligence</span></div>
  </main>;
}

function StatCard({ label, value, unit, note, icon: Icon, tone = 'green' }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={16} /></span></div><div className="stat-value">{value}<small>{unit}</small></div><div className="stat-note">{note}</div></article>;
}

function LineChart({ readings = [], height = 230 }) {
  const data = readings.map((reading) => ({ value: Number(reading.Global_active_power), timestamp: reading.timestamp })).filter((point) => Number.isFinite(point.value));
  const width = 760;
  const pad = { top: 18, right: 14, bottom: 29, left: 46 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const min = Math.min(0, ...data.map((point) => point.value));
  const max = Math.max(.1, ...data.map((point) => point.value));
  const points = data.map(({ value }, index) => [pad.left + (data.length < 2 ? chartWidth / 2 : index / (data.length - 1) * chartWidth), pad.top + (1 - (value - min) / (max - min || 1)) * chartHeight]);
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = points.length ? `${pad.left},${height - pad.bottom} ${line} ${points.at(-1)[0]},${height - pad.bottom}` : '';
  return <div className="chart-frame">{data.length ? <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Active power readings in kilowatts over time">
    <defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#007a5e" stopOpacity=".2" /><stop offset="1" stopColor="#007a5e" stopOpacity="0" /></linearGradient></defs>
    {[0, .5, 1].map((fraction) => { const y = pad.top + fraction * chartHeight; return <g key={fraction}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="chart-grid" /><text x={pad.left - 9} y={y + 4} textAnchor="end" className="chart-label">{formatNumber(max - fraction * (max - min), 1)}</text></g>; })}
    <polygon points={area} fill="url(#areaFill)" /><polyline points={line} fill="none" stroke="#007a5e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    {points.length > 0 && <circle cx={points.at(-1)[0]} cy={points.at(-1)[1]} r="4.5" fill="#ed825d" stroke="#fff" strokeWidth="2" />}
    <text x={pad.left} y={height - 7} className="chart-label">{data[0]?.timestamp ? new Date(data[0].timestamp).toLocaleDateString() : ''}</text><text x={width - pad.right} y={height - 7} textAnchor="end" className="chart-label">{data.at(-1)?.timestamp ? new Date(data.at(-1).timestamp).toLocaleDateString() : ''}</text>
  </svg> : <div className="chart-empty"><Activity size={18} /><span>Readings appear here after analysis.</span></div>}</div>;
}

function HourChart({ readings }) {
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => []);
    readings.forEach((reading) => { const value = Number(reading.Global_active_power); if (Number.isFinite(value) && reading.timestamp) buckets[new Date(reading.timestamp).getUTCHours()].push(value); });
    return buckets.map((bucket, hour) => ({ hour, average: bucket.length ? bucket.reduce((sum, value) => sum + value, 0) / bucket.length : 0 }));
  }, [readings]);
  const maximum = Math.max(.1, ...hourly.map((item) => item.average));
  return <div className="hour-chart" role="img" aria-label="Mean active power by UTC hour from plotted samples">{hourly.map(({ hour, average }) => <div className="hour-column" key={hour} title={`${String(hour).padStart(2, '0')}:00 UTC · ${formatNumber(average)} kW`}><span className={`hour-bar ${average === maximum ? 'peak-bar' : ''}`} style={{ height: `${Math.max(average ? 8 : 2, average / maximum * 100)}%` }} />{hour % 4 === 0 && <small>{String(hour).padStart(2, '0')}</small>}</div>)}</div>;
}

function PageHeading({ eyebrow, title, subtitle, analysis }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>{analysis && <span className="active-analysis"><i /> ANALYSIS LOADED</span>}</div>;
}

function EmptyAnalysis({ onUpload }) {
  return <div className="empty-state welcome-state"><span className="empty-icon"><BarChart3 size={21} /></span><div><p className="eyebrow">YOUR FIRST ANALYSIS</p><h2>Start with a meter export</h2><p>Upload a CSV to review demand, a short-term forecast and model-flagged readings.</p><button className="primary-button" onClick={onUpload}><CloudUpload size={16} /> Upload CSV <ArrowRight size={15} /></button></div></div>;
}

function UploadView({ busy, status, error, onFile, fileInputRef }) {
  const [dragging, setDragging] = useState(false);
  function dropFile(event) { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) onFile(file); }
  return <div className="page-content upload-page">
    <div className="page-heading"><div><p className="eyebrow">DATA INTAKE / 01</p><h1>Upload meter data</h1><p>Choose a CSV export to start a new analysis.</p></div><span className="step-indicator"><b>01</b><i /> 02 ANALYSIS</span></div>
    <div className="upload-layout">
      <section className="surface upload-surface"><div className="surface-heading"><div><span className="section-kicker">SMART METER FILE</span><h2>Bring your readings in</h2></div><span className="subtle-icon"><FileSpreadsheet size={18} /></span></div>
        <div className={`drop-zone ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} />
          <span className="drop-icon">{busy ? <LoaderCircle className="spin" size={23} /> : <CloudUpload size={24} />}</span><strong>{busy ? status || 'Preparing your analysis...' : 'Drop your CSV file here'}</strong><span>{busy ? 'Large files can take a little longer to process.' : 'or choose a file from your device'}</span>
          {!busy && <button type="button" className="outline-button" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Browse files</button>}
          <small>CSV only <i /> Maximum 20 MB <i /> UCI household format</small>
        </div>
        {error && <div className="inline-error" role="alert"><CircleAlert size={16} />{error}</div>}
        <div className="privacy-row"><LockKeyhole size={14} /><span>Files are sent to your configured EnergyIQ API for processing.</span><span className="secure-label"><i /> API configured separately</span></div>
      </section>
      <aside className="surface requirements-surface"><div className="surface-heading"><div><span className="section-kicker">FILE REQUIREMENTS</span><h2>Before you upload</h2></div><span className="subtle-icon"><CircleHelp size={18} /></span></div>
        <ul className="requirement-list"><li><i><Check size={12} /></i><div><strong>Supported CSV columns</strong><small>Date, Time and household power readings</small></div></li><li><i><Check size={12} /></i><div><strong>Chronological rows</strong><small>Readings must be ordered by timestamp</small></div></li><li><i><Check size={12} /></i><div><strong>Forecast history</strong><small>At least 30 regular one-minute readings</small></div></li><li><i><Check size={12} /></i><div><strong>One file at a time</strong><small>Use a .csv file up to 20 MB</small></div></li></ul>
        <div className="format-note"><span className="format-tag">CSV</span><span><strong>UCI household format</strong><small>Semicolon- or comma-separated headers are supported.</small></span></div>
      </aside>
    </div>
    <div className="upload-footnote"><ShieldCheck size={15} /><span>Preview mode is not account authentication. Analysis IDs are not private in the current backend.</span></div>
  </div>;
}

function Overview({ analysis, readings, forecast, anomalies, onUpload, onNavigate }) {
  if (!analysis) return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / 00" title="Overview" subtitle="Your latest household analysis, at a glance." /><EmptyAnalysis onUpload={onUpload} /></div>;
  const summary = analysis.summary || {};
  return <div className="page-content">
    <div className="page-heading overview-heading"><div><p className="eyebrow">ENERGY WORKSPACE / OVERVIEW</p><h1>Analysis snapshot</h1><p>{analysis.fileName} <span className="dot-divider">/</span> {summary.validReadingCount?.toLocaleString() || '—'} valid readings</p></div><button className="outline-button top-action" onClick={onUpload}><CloudUpload size={15} /> New analysis</button></div>
    <div className="stat-grid"><StatCard label="Average active power" value={formatNumber(summary.averageActivePowerKw)} unit="kW" note="Across valid readings" icon={Activity} /><StatCard label="Highest observed" value={formatNumber(summary.maxActivePowerKw)} unit="kW" note={summary.peakTimestamp ? formatDateTime(summary.peakTimestamp) : 'Peak timestamp unavailable'} icon={Bolt} tone="orange" /><StatCard label="Valid readings" value={Number(summary.validReadingCount ?? analysis.totalRows ?? 0).toLocaleString()} unit="rows" note={`${Number(analysis.invalidRows || 0).toLocaleString()} rows skipped`} icon={Database} tone="blue" /><StatCard label="Model-flagged" value={Number(anomalies?.totalFlagged ?? analysis.anomalySummary?.totalFlagged ?? 0).toLocaleString()} unit="events" note="Statistical outliers, not verified faults" icon={TriangleAlert} tone="rose" /></div>
    <div className="overview-grid"><section className="surface chart-surface"><div className="surface-heading"><div><span className="section-kicker">OBSERVED READINGS</span><h2>Active power profile</h2></div><button className="link-button" onClick={() => onNavigate('consumption')}>Explore <ArrowRight size={14} /></button></div><LineChart readings={readings} /></section>
      <section className="surface focus-surface"><div className="surface-heading"><div><span className="section-kicker">NEXT INTERVAL</span><h2>Forecast signal</h2></div><span className="subtle-icon"><Sparkles size={17} /></span></div><div className="forecast-value">{formatNumber(forecast?.predictions?.[0]?.predictedActivePowerKw)}<small>kW</small></div><p className="focus-copy">One-step active-power estimate from the trained forecasting model.</p><div className="focus-divider" /><div className="focus-meta"><span>Model version</span><strong>{forecast?.modelVersion || analysis.modelVersion || 'Not reported'}</strong></div><button className="link-button" onClick={() => onNavigate('forecast')}>View forecast <ArrowRight size={14} /></button></section></div>
    <section className="surface summary-strip"><span className="summary-icon"><Clock3 size={17} /></span><div><strong>Analysis completed</strong><span>{analysis.processingDurationMs ? `${(analysis.processingDurationMs / 1000).toFixed(1)} seconds` : 'Duration not reported'} <i /> {Number(analysis.missingValues || 0).toLocaleString()} missing values</span></div><span className="status-pill"><i /> COMPLETE</span></section>
  </div>;
}

function Consumption({ analysis, readings }) {
  const values = readings.map((item) => Number(item.Global_active_power)).filter(Number.isFinite);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const maximum = values.length ? Math.max(...values) : null;
  return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / CONSUMPTION" title="Consumption" subtitle="Explore the active-power readings retained by this analysis." analysis={analysis} />
    <div className="mini-stat-grid"><MiniStat label="Average in plotted sample" value={formatNumber(average)} unit="kW" /><MiniStat label="Maximum in plotted sample" value={formatNumber(maximum)} unit="kW" /><MiniStat label="Chart points loaded" value={values.length.toLocaleString()} unit="readings" /></div>
    <section className="surface chart-surface full-chart"><div className="surface-heading"><div><span className="section-kicker">TIME SERIES / UTC</span><h2>Active power over time</h2></div><span className="unit-badge">kW</span></div><LineChart readings={readings} height={320} /><p className="chart-caption">Up to 20 evenly spaced API pages (maximum 20,000 readings). This is active power, not cumulative energy.</p></section>
  </div>;
}
function MiniStat({ label, value, unit }) { return <div className="mini-stat"><span>{label}</span><strong>{value} <small>{unit}</small></strong></div>; }

function PeakDemand({ analysis, readings }) {
  return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / PEAK DEMAND" title="Peak demand" subtitle="Review the highest recorded active-power value and its timing." analysis={analysis} />
    <div className="peak-grid"><section className="surface peak-callout"><span className="peak-graphic"><Bolt size={22} /></span><span className="section-kicker">HIGHEST OBSERVED READING</span><strong>{formatNumber(analysis?.summary?.maxActivePowerKw)} <small>kW</small></strong><span className="peak-timestamp">{formatDateTime(analysis?.summary?.peakTimestamp)}</span><p>Peak value from the complete validated dataset summary.</p></section>
      <section className="surface chart-surface"><div className="surface-heading"><div><span className="section-kicker">SAMPLE PROFILE / UTC</span><h2>Mean demand by hour</h2></div><span className="unit-badge">kW</span></div><HourChart readings={readings} /><p className="chart-caption">Hourly means use the readings loaded for the consumption chart, not every raw row.</p></section></div>
    <div className="notice"><CircleHelp size={16} /><span>The API reports the dataset's highest observed reading; it does not provide a learned hourly peak-demand forecast.</span></div>
  </div>;
}

function Forecast({ analysis, readings, forecast }) {
  const prediction = forecast?.predictions?.[0];
  return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / FORECAST" title="Forecast" subtitle="The model's next-interval estimate, with the observed context alongside it." analysis={analysis} />
    <div className="forecast-layout"><section className="surface forecast-primary"><span className="section-kicker">PREDICTED ACTIVE POWER</span><strong>{formatNumber(prediction?.predictedActivePowerKw)} <small>{forecast?.unit || 'kW'}</small></strong><p>Target interval: {formatDateTime(prediction?.timestamp)}</p><div className="forecast-context"><div><span>Latest observed</span><b>{formatNumber(forecast?.validation?.latestObservedActivePowerKw ?? readings.at(-1)?.Global_active_power)} kW</b></div><div><span>Forecast horizon</span><b>{forecast?.horizon ?? prediction?.horizonSteps ?? '1'} interval</b></div></div></section>
      <section className="surface chart-surface"><div className="surface-heading"><div><span className="section-kicker">RECENT CONTEXT</span><h2>Observed active power</h2></div><span className="unit-badge">kW</span></div><LineChart readings={readings.slice(-120)} height={245} /></section></div>
    <div className="notice"><Sparkles size={16} /><span>Forecasts are model estimates, not guarantees. This API currently returns a next-interval prediction only.</span></div>
    <section className="surface model-meta"><div><span className="section-kicker">MODEL DETAILS</span><strong>{forecast?.modelVersion || analysis?.modelVersion || 'Model version not reported'}</strong></div><div><span className="section-kicker">VALIDATION</span><strong>{forecast?.validation?.status || forecast?.validation?.message || 'No validation note returned'}</strong></div></section>
  </div>;
}

function Anomalies({ analysis, anomalies }) {
  const count = anomalies?.totalFlagged ?? analysis?.anomalySummary?.totalFlagged ?? 0;
  return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / ANOMALIES" title="Anomaly review" subtitle="Inspect readings the Isolation Forest model marked as unusual." analysis={analysis} />
    <div className="anomaly-summary"><span className="anomaly-count-icon"><TriangleAlert size={20} /></span><div><span className="section-kicker">FLAGGED IN FULL ANALYSIS</span><strong>{Number(count).toLocaleString()} <small>readings</small></strong></div><span className="anomaly-caveat">Model flags are statistical outliers, not proof of faults, theft or unsafe wiring.</span></div>
    <section className="surface table-surface"><div className="surface-heading"><div><span className="section-kicker">FIRST PAGE / MAX 100</span><h2>Flagged readings</h2></div><span className="unit-badge">{anomalies?.pagination?.totalPages ? `${anomalies.pagination.totalPages} page${anomalies.pagination.totalPages === 1 ? '' : 's'}` : 'No pages'}</span></div>
      {anomalies?.items?.length ? <div className="table-scroll"><table><thead><tr><th>Timestamp</th><th>Active power</th><th>Voltage</th><th>Current</th><th>Model score</th></tr></thead><tbody>{anomalies.items.map((item) => <tr key={item.timestamp}><td>{formatDateTime(item.timestamp)}</td><td>{formatNumber(item.Global_active_power)} kW</td><td>{formatNumber(item.Voltage, 1)} V</td><td>{formatNumber(item.Global_intensity, 1)} A</td><td><span className="score-pill">{formatNumber(item.score, 3)}</span></td></tr>)}</tbody></table></div> : <div className="empty-state compact-empty"><span className="empty-icon"><Check size={18} /></span><div><strong>{count ? 'No flagged readings on the first page' : 'No flagged readings'}</strong><p>{count ? `${count} flagged readings exist in the full analysis.` : 'The model did not flag any unusual readings.'}</p></div></div>}</section>
  </div>;
}

function Quality({ analysis }) {
  const valid = Number(analysis?.summary?.validReadingCount ?? analysis?.totalRows ?? 0);
  const invalid = Number(analysis?.invalidRows || 0);
  const missing = Number(analysis?.missingValues || 0);
  const columns = analysis?.availableColumns || [];
  const rate = valid + invalid ? Math.max(0, Math.min(100, valid / (valid + invalid) * 100)) : 0;
  return <div className="page-content"><PageHeading eyebrow="ENERGY WORKSPACE / DATA QUALITY" title="Data quality" subtitle="A quick integrity check of the uploaded file and accepted readings." analysis={analysis} />
    <div className="quality-grid"><section className="surface quality-score"><span className="section-kicker">VALID ROWS</span><strong>{valid.toLocaleString()}</strong><span>of {(valid + invalid).toLocaleString()} processed rows</span><div className="quality-track"><i style={{ width: `${rate}%` }} /></div><small>{valid + invalid ? `${rate.toFixed(1)}% accepted` : 'No readings available'}</small></section><QualityCount label="ROWS SKIPPED" value={invalid} note="Invalid, duplicate or out-of-order rows" icon={CircleAlert} /><QualityCount label="MISSING VALUES" value={missing} note="Optional numeric values retained as null" icon={Database} blue /></div>
    <section className="surface quality-details"><div className="surface-heading"><div><span className="section-kicker">INGESTION DETAILS</span><h2>Dataset profile</h2></div><span className="status-pill"><i /> VALIDATED</span></div><div className="details-grid"><Detail label="Uploaded file" value={analysis?.fileName || 'Not available'} /><Detail label="Reading range" value={analysis?.dateRange?.start ? `${formatDate(analysis.dateRange.start)} – ${formatDate(analysis.dateRange.end)}` : 'Not available'} /><Detail label="Missing-value count" value={missing.toLocaleString()} /><Detail label="Analysis status" value={analysis?.status || 'Not available'} /></div><div className="column-list"><span className="section-kicker">COLUMNS DETECTED</span><div>{columns.length ? columns.map((column) => <span className="column-chip" key={column}>{column}</span>) : <small>Column details were not returned.</small>}</div></div></section>
  </div>;
}
function QualityCount({ label, value, note, icon: Icon, blue }) { return <section className="surface quality-count"><span className={`quality-count-icon ${blue ? 'blue' : ''}`}><Icon size={17} /></span><span className="section-kicker">{label}</span><strong>{value.toLocaleString()}</strong><small>{note}</small></section>; }
function Detail({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function App() {
  const [userEmail, setUserEmail] = useState('');
  const [activePage, setActivePage] = useState('overview');
  const [analysis, setAnalysis] = useState(null);
  const [readings, setReadings] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [dataError, setDataError] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (activePage !== 'anomalies' || !analysis || anomalies) return;
    setDataLoading(true);
    getAnomalies(analysis.analysisId).then(setAnomalies).catch((error) => setDataError(error.message)).finally(() => setDataLoading(false));
  }, [activePage, analysis, anomalies]);

  async function handleFile(file) {
    setUploadError('');
    if (!file.name.toLowerCase().endsWith('.csv')) return setUploadError('Choose a file with a .csv extension.');
    if (file.size > 20 * 1024 * 1024) return setUploadError('This file is larger than the 20 MB upload limit.');
    setUploadBusy(true); setUploadStatus('Uploading CSV...'); setAnalysis(null); setReadings([]); setForecast(null); setAnomalies(null); setDataError('');
    try {
      const upload = await uploadCsv(file);
      setUploadStatus('Validating readings and running models...');
      const completed = await waitForAnalysis(upload.analysisId);
      if (completed.status !== 'completed') throw new Error(completed.error?.message || 'Analysis did not complete. Check the supported meter format.');
      setAnalysis(completed); setActivePage('overview'); setUploadStatus('Loading charts and model results...');
      const results = await Promise.allSettled([getConsumptionSample(upload.analysisId), getForecast(upload.analysisId), getAnomalies(upload.analysisId)]);
      if (results[0].status === 'fulfilled') setReadings(results[0].value);
      if (results[1].status === 'fulfilled') setForecast(results[1].value);
      if (results[2].status === 'fulfilled') setAnomalies(results[2].value);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) setDataError(failed.reason.message);
    } catch (error) { setUploadError(error.message); }
    finally { setUploadBusy(false); setUploadStatus(''); }
  }

  function navigate(page) { setActivePage(page); setMobileNavOpen(false); setDataError(''); }
  function endPreview() { setUserEmail(''); setActivePage('overview'); setAnalysis(null); setReadings([]); setForecast(null); setAnomalies(null); }
  if (!userEmail) return <Login onContinue={(email) => { setUserEmail(email); setActivePage('upload'); }} />;

  const activeItem = navigation.find((item) => item.id === activePage) || navigation[0];
  let currentPage;
  if (activePage === 'upload') currentPage = <UploadView busy={uploadBusy} status={uploadStatus} error={uploadError} onFile={handleFile} fileInputRef={fileInputRef} />;
  else if (!analysis) currentPage = <div className="page-content"><PageHeading eyebrow={`ENERGY WORKSPACE / ${activeItem.label.toUpperCase()}`} title={activeItem.label} subtitle="Upload a CSV file to create an analysis." /><EmptyAnalysis onUpload={() => navigate('upload')} /></div>;
  else if (activePage === 'overview') currentPage = <Overview analysis={analysis} readings={readings} forecast={forecast} anomalies={anomalies} onUpload={() => navigate('upload')} onNavigate={navigate} />;
  else if (activePage === 'consumption') currentPage = <Consumption analysis={analysis} readings={readings} />;
  else if (activePage === 'peak') currentPage = <PeakDemand analysis={analysis} readings={readings} />;
  else if (activePage === 'forecast') currentPage = <Forecast analysis={analysis} readings={readings} forecast={forecast} />;
  else if (activePage === 'anomalies') currentPage = <Anomalies analysis={analysis} anomalies={anomalies} />;
  else currentPage = <Quality analysis={analysis} />;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? 'nav-open' : ''}`}><div className="sidebar-brand"><Logo small /><button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
      <div className="workspace-switch"><span className="workspace-mark"><House size={15} /></span><span><strong>Residence #402</strong><small>Household workspace</small></span><ChevronDown size={14} /></div><p className="nav-section-label">ANALYSIS</p>
      <nav className="side-nav" aria-label="Analysis sections">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={17} /><span>{label}</span>{id === 'upload' && <small>NEW</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection-card"><div className="connection-top"><i /> API WORKSPACE</div><strong>{analysis ? analysis.fileName : 'No active analysis'}</strong><small>{analysis ? `${Number(analysis.totalRows || 0).toLocaleString()} validated readings` : 'Upload a CSV to get started'}</small></div><button className="sidebar-help" onClick={() => navigate('quality')}><CircleHelp size={15} /> Data & privacy details</button></div>
    </aside>
    {mobileNavOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <main className="main-column"><header className="topbar"><button className="menu-toggle" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{activeItem.label}</strong></div><div className="topbar-right"><span className="demo-state"><i /> PREVIEW SESSION</span><div className="user-menu"><span className="avatar">{userEmail.charAt(0).toUpperCase()}</span><span className="user-label"><strong>{userEmail}</strong><small>Preview access</small></span><button title="End preview session" aria-label="End preview session" onClick={endPreview}><LogOut size={16} /></button></div></div></header>
      {dataError && <div className="data-error" role="alert"><CircleAlert size={15} />{dataError}<button aria-label="Dismiss" onClick={() => setDataError('')}><X size={14} /></button></div>}{dataLoading && <div className="loading-bar"><LoaderCircle className="spin" size={14} /> Loading analysis data...</div>}{currentPage}
      <footer className="app-footer"><span>ENERGYIQ <i /> HACKNOVA '26</span><span>Preview frontend · backend APIs configured separately</span></footer>
    </main>
  </div>;
}

export default App;