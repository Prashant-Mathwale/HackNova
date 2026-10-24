import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CircleAlert, LoaderCircle, Zap } from 'lucide-react';
import { getUsagePatterns } from '../api.js';
import { AnalyticsChart } from './AnalyticsChart.jsx';

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '--';

export function UsagePatterns({ analysis }) {
  const analysisId = analysis?.analysisId;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getUsagePatterns(analysisId)
      .then((data) => { if (active) setResult(data); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [analysisId]);

  const dailyChart = useMemo(() => (result?.dailyPattern || []).map((day) => ({
    timestamp: `${day.date}T00:00:00Z`,
    average_power_kw: day.average_power_kw,
    peak_power_kw: day.peak_power_kw
  })), [result]);

  if (loading) return <div className="page-content"><div className="loading-bar"><LoaderCircle className="spin" size={14} /> Analyzing daily usage patterns...</div></div>;
  if (error) return <div className="page-content"><div className="inline-error" role="alert"><CircleAlert size={16} />{error}</div></div>;

  const cluster = result?.cluster;
  const dailyPattern = result?.dailyPattern || [];
  const assignedDay = dailyPattern.find((day) => day.date === cluster?.assignment_scope);
  const comparisonDay = assignedDay || dailyPattern.at(-1);

  return <div className="page-content">
    <div className="page-heading">
      <div>
        <p className="eyebrow">ENERGY WORKSPACE / PATTERN IDENTIFICATION</p>
        <h1>Usage patterns</h1>
        <p>See how daily energy profiles compare with patterns learned by K-Means.</p>
      </div>
      <span className="active-analysis"><i /> ANALYSIS LOADED</span>
    </div>

    <section className="surface" style={{ padding: '20px', marginBottom: '14px' }}>
      <div className="surface-heading">
        <div>
          <span className="section-kicker">LATEST ELIGIBLE DAY</span>
          <h2>Pattern assignment</h2>
        </div>
        <span className="subtle-icon"><BarChart3 size={17} /></span>
      </div>
      {cluster?.available ? <>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px', marginTop: '16px' }}>
          <strong style={{ color: 'var(--green)', fontSize: '22px' }}>{cluster.description}</strong>
          <span className="unit-badge">Cluster {cluster.cluster_id + 1}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '7px 0 0' }}>
          Assigned day: {cluster.assignment_scope}
        </p>
      </> : <div className="inline-error" style={{ marginTop: '16px' }}>
        <CircleAlert size={16} />
        {cluster?.reason || 'The trained K-Means model could not assign a pattern.'}
      </div>}
    </section>

    {comparisonDay && <section className="surface" style={{ padding: '20px', marginBottom: '14px' }}>
      <span className="section-kicker">OBSERVED DAY / MATCHES CHART</span>
      <h2 style={{ margin: '6px 0 0', fontSize: '16px' }}>Actual readings · {comparisonDay.date}</h2>
      <p style={{ color: 'var(--muted)', fontSize: '11px', margin: '5px 0 0' }}>
        These values are calculated from the uploaded readings for this day.
      </p>
      <div className="mini-stat-grid" style={{ marginTop: '14px', marginBottom: 0 }}>
        <PatternMetric label="Observed daily energy" value={format(comparisonDay.estimated_energy_kwh)} unit="kWh" icon={Zap} />
        <PatternMetric label="Observed average power" value={format(comparisonDay.average_power_kw)} unit="kW" icon={Zap} />
        <PatternMetric label="Peak power · full dataset" value={format(analysis?.summary?.maxActivePowerKw)} unit="kW" icon={BarChart3} />
      </div>
    </section>}

    {dailyChart.length > 0 && <section className="surface chart-surface full-chart">
      <AnalyticsChart
        title="Daily usage profile"
        subtitle="Average and peak active power for each eligible day in the analyzed readings."
        data={dailyChart}
        series={[
          { key: 'average_power_kw', label: 'Daily average', color: '#007a5e', strokeWidth: 2 },
          { key: 'peak_power_kw', label: 'Daily peak', color: '#d98242', strokeWidth: 2 }
        ]}
        xAxisLabel="Date (UTC)"
        yAxisLabel="Active power (kW)"
        yUnit="kW"
        height={290}
      />
    </section>}

    {result?.basedOn?.sampled && <div className="notice" style={{ marginTop: '14px' }}>
      Pattern analysis used an evenly spaced sample of {Number(result.basedOn.analyzedReadings).toLocaleString()} from {Number(result.basedOn.sourceReadings).toLocaleString()} readings.
    </div>}
    <div className="notice" style={{ marginTop: '14px' }}>
      K-Means groups days by estimated energy, average and peak power, variability, and evening usage. A cluster means the day resembles a learned profile; it does not identify the cause or appliance.
    </div>
  </div>;
}

function PatternMetric({ label, value, unit, icon: Icon }) {
  return <article className="stat-card">
    <div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div>
    <div className="stat-value">{value}<small>{unit}</small></div>
  </article>;
}