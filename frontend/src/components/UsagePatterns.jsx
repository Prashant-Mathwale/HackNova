import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CircleAlert, LoaderCircle, Zap } from 'lucide-react';
import { getUsagePatterns } from '../api.js';

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '--';
const groupColors = ['#007a5e', '#2b82d9', '#d98242', '#c04d62'];

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

  const dailyPattern = result?.dailyPattern || [];
  const energyGroups = result?.dailyEnergyGroups?.groups || [];
  const latestDay = dailyPattern.at(-1);

  if (loading) return <div className="page-content"><div className="loading-bar"><LoaderCircle className="spin" size={14} /> Analyzing daily usage patterns...</div></div>;
  if (error) return <div className="page-content"><div className="inline-error" role="alert"><CircleAlert size={16} />{error}</div></div>;

  return <div className="page-content">
    <div className="page-heading">
      <div>
        <p className="eyebrow">ENERGY WORKSPACE / PATTERN IDENTIFICATION</p>
        <h1>Usage patterns</h1>
        <p>Days with similar estimated energy use are grouped together using K-Means.</p>
      </div>
      <span className="active-analysis"><i /> ANALYSIS LOADED</span>
    </div>

    {energyGroups.length > 0 && <section className="surface" style={{ padding: '20px', marginBottom: '14px' }}>
      <div className="surface-heading">
        <div><span className="section-kicker">K-MEANS / UPLOADED DATA</span><h2>Daily energy groups</h2></div>
        <span className="subtle-icon"><BarChart3 size={17} /></span>
      </div>
      <div className="mini-stat-grid" style={{ marginTop: '16px', marginBottom: 0 }}>
        {energyGroups.map((group) => <EnergyGroupMetric key={group.id} group={group} color={groupColors[group.id - 1] || '#788680'} />)}
      </div>
    </section>}

    {dailyPattern.length > 0 && <DailyEnergyChart days={dailyPattern} groups={energyGroups} />}

    {latestDay && <section className="surface" style={{ padding: '20px', marginTop: '14px' }}>
      <span className="section-kicker">LATEST ELIGIBLE DAY</span>
      <h2 style={{ margin: '6px 0 0', fontSize: '16px' }}>Actual readings · {latestDay.date}</h2>
      <div className="mini-stat-grid" style={{ marginTop: '14px', marginBottom: 0 }}>
        <PatternMetric label="Daily energy" value={format(latestDay.estimated_energy_kwh)} unit="kWh" icon={Zap} />
        <PatternMetric label="Average power" value={format(latestDay.average_power_kw)} unit="kW" icon={Activity} />
        <PatternMetric label="Peak power" value={format(latestDay.peak_power_kw)} unit="kW" icon={BarChart3} />
      </div>
    </section>}

    {result?.basedOn?.sampled && <div className="notice" style={{ marginTop: '14px' }}>
      Pattern analysis used an evenly spaced sample of {Number(result.basedOn.analyzedReadings).toLocaleString()} from {Number(result.basedOn.sourceReadings).toLocaleString()} readings.
    </div>}
    <div className="notice" style={{ marginTop: '14px' }}>
      Each color represents a group formed from this upload’s daily estimated energy. K-Means does not identify the cause or appliance behind the usage.
    </div>
  </div>;
}

function PatternMetric({ label, value, unit, icon: Icon }) {
  return <article className="stat-card">
    <div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div>
    <div className="stat-value">{value}<small>{unit}</small></div>
  </article>;
}

function EnergyGroupMetric({ group, color }) {
  return <article className="stat-card">
    <div className="stat-top"><span>{group.label}</span><span className="stat-icon" style={{ color, background: `${color}18` }}><BarChart3 size={16} /></span></div>
    <div className="stat-value">{format(group.mean_daily_energy_kwh)}<small>kWh/day avg</small></div>
    <div className="stat-note">{Number(group.day_count).toLocaleString()} days in this group</div>
  </article>;
}

function DailyEnergyChart({ days, groups }) {
  const width = 920;
  const height = 320;
  const pad = { top: 18, right: 18, bottom: 46, left: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxEnergy = Math.max(0.1, ...days.map((day) => Number(day.estimated_energy_kwh) || 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => maxEnergy * fraction);
  const barSlot = plotWidth / days.length;
  const barWidth = Math.max(2, Math.min(18, barSlot * 0.66));
  const labelIndexes = days.length <= 6
    ? days.map((_day, index) => index)
    : [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round((days.length - 1) * fraction));

  return <section className="surface chart-surface full-chart">
    <div style={{ marginBottom: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Daily consumption by energy group</h3>
      <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Each bar is one eligible day; similar daily kWh values share a color.</p>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily energy by K-Means consumption group" style={{ width: '100%', display: 'block' }}>
      {ticks.map((value, index) => {
        const y = pad.top + plotHeight * (1 - index / (ticks.length - 1));
        return <g key={index}>
          <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#e4ebe6" strokeDasharray="3 4" />
          <text x={pad.left - 9} y={y + 4} textAnchor="end" fill="#788680" fontSize="10" fontFamily="var(--mono)">{format(value, 1)}</text>
        </g>;
      })}
      <text transform={`translate(16 ${pad.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#576861" fontSize="11" fontWeight="600">Estimated energy (kWh/day)</text>
      {days.map((day, index) => {
        const value = Math.max(0, Number(day.estimated_energy_kwh) || 0);
        const groupId = day.energy_group_id;
        const color = groupColors[(groupId || 0) - 1] || '#a4ada8';
        const barHeight = value / maxEnergy * plotHeight;
        const x = pad.left + index * barSlot + (barSlot - barWidth) / 2;
        const y = pad.top + plotHeight - barHeight;
        return <rect key={day.date} x={x} y={y} width={barWidth} height={barHeight} rx="2" fill={color}>
          <title>{`${day.date}: ${format(value)} kWh · ${day.energy_group_label || 'Not grouped'}`}</title>
        </rect>;
      })}
      {labelIndexes.map((index) => <text key={index} x={pad.left + index * barSlot + barSlot / 2} y={height - 20} textAnchor="middle" fill="#788680" fontSize="9" fontFamily="var(--mono)">
        {days[index]?.date}
      </text>)}
      <text x={pad.left + plotWidth / 2} y={height - 3} textAnchor="middle" fill="#576861" fontSize="11" fontWeight="600">Date (UTC)</text>
    </svg>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'center', marginTop: '8px' }}>
      {groups.map((group) => <span key={group.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#576861', fontSize: '11px' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: groupColors[group.id - 1] || '#788680' }} />{group.label}
      </span>)}
      {days.some((day) => !day.energy_group_id) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#576861', fontSize: '11px' }}><span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#a4ada8' }} />Not grouped</span>}
    </div>
  </section>;
}