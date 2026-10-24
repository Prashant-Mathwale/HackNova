import React, { useState } from 'react';

/**
 * Enhanced analytical chart component adhering to Section 3 Charting Standard:
 * - Clear meaningful titles & subtitle
 * - Explicit X and Y axis labels with units
 * - Dynamic ticks, background gridlines, and responsive layout
 * - Precise hover tooltip showing timestamp, formatted metrics & anomaly/peak badges
 * - Categorical series legend distinguishing actual, anomaly, peak, predicted, etc.
 * - Empty & Loading states
 */
export function AnalyticsChart({
  title,
  subtitle,
  data = [],
  series = [
    { key: 'value', label: 'Observed Power', color: '#007a5e', strokeWidth: 2 }
  ],
  xAxisLabel = 'Timestamp',
  yAxisLabel = 'Active Power (kW)',
  yUnit = 'kW',
  height = 280,
  showAnomalies = false,
  peakPoint = null,
  highlightPoint = null,
  forecastStartTimestamp = null,
  dateFilter = 'all',
  onDateFilterChange = null
}) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div className="chart-empty" style={{ minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '13px', color: '#7a8882' }}>No readings available for this visualization.</span>
      </div>
    );
  }

  const width = 800;
  const pad = { top: 28, right: 30, bottom: 48, left: 65 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  // Compute domain
  let allYValues = [];
  data.forEach((d) => {
    series.forEach((s) => {
      const val = Number(d[s.key]);
      if (Number.isFinite(val)) allYValues.push(val);
    });
  });

  const minY = Math.min(0, ...allYValues);
  const maxY = Math.max(0.2, ...allYValues);
  const rangeY = (maxY - minY) || 1;

  // Coordinates helper
  const getX = (index) => pad.left + (data.length <= 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth);
  const getY = (val) => pad.top + (1 - (val - minY) / rangeY) * chartHeight;

  // Format tick labels
  const formatTickVal = (val) => {
    if (Math.abs(val) >= 100) return val.toFixed(0);
    if (Math.abs(val) >= 10) return val.toFixed(1);
    return val.toFixed(2);
  };

  const yTicks = [
    { fraction: 0, val: maxY },
    { fraction: 0.25, val: minY + rangeY * 0.75 },
    { fraction: 0.5, val: minY + rangeY * 0.5 },
    { fraction: 0.75, val: minY + rangeY * 0.25 },
    { fraction: 1, val: minY }
  ];

  // X ticks: 5 distributed points
  const xTickIndices = [0];
  if (data.length > 4) {
    xTickIndices.push(Math.floor(data.length * 0.25));
    xTickIndices.push(Math.floor(data.length * 0.5));
    xTickIndices.push(Math.floor(data.length * 0.75));
    xTickIndices.push(data.length - 1);
  } else if (data.length > 1) {
    xTickIndices.push(data.length - 1);
  }

  const formatXTimestamp = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  };

  // Find hover item
  const hoveredData = hoverIndex !== null && data[hoverIndex] ? data[hoverIndex] : null;

  return (
    <div className="analytics-chart-container" style={{ position: 'relative', width: '100%' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          {title && <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>}
          {subtitle && <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--muted)' }}>{subtitle}</p>}
        </div>

        {/* Filter buttons if provided */}
        {onDateFilterChange && (
          <div style={{ display: 'inline-flex', gap: '4px', background: '#f0f5f2', padding: '3px', borderRadius: '6px' }}>
            {['all', 'day', 'hour'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onDateFilterChange(opt)}
                style={{
                  border: 0,
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: dateFilter === opt ? 600 : 400,
                  color: dateFilter === opt ? '#fff' : 'var(--muted)',
                  background: dateFilter === opt ? 'var(--green)' : 'transparent',
                  cursor: 'pointer'
                }}
              >
                {opt.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SVG Chart */}
      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          onMouseLeave={() => setHoverIndex(null)}
          role="img"
          aria-label={title || 'Analytical time-series chart'}
        >
          <defs>
            <linearGradient id="primaryAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#007a5e" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#007a5e" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="forecastAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b82d9" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2b82d9" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Gridlines & Y-Axis Ticks */}
          {yTicks.map(({ fraction, val }) => {
            const y = pad.top + fraction * chartHeight;
            return (
              <g key={fraction}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={width - pad.right}
                  y2={y}
                  stroke="#e4ebe6"
                  strokeDasharray="3 4"
                  strokeWidth="1"
                />
                <text
                  x={pad.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#788680"
                  fontSize="11"
                  fontFamily="var(--mono)"
                >
                  {formatTickVal(val)}
                </text>
              </g>
            );
          })}

          {/* Y Axis Label */}
          <text
            transform={`rotate(-90)`}
            x={-(pad.top + chartHeight / 2)}
            y={16}
            textAnchor="middle"
            fill="#576861"
            fontSize="12"
            fontWeight="600"
          >
            {yAxisLabel}
          </text>

          {/* X Axis Baseline */}
          <line
            x1={pad.left}
            y1={height - pad.bottom}
            x2={width - pad.right}
            y2={height - pad.bottom}
            stroke="#cfdad3"
            strokeWidth="1.5"
          />

          {/* X Axis Ticks */}
          {xTickIndices.map((idx) => {
            const point = data[idx];
            if (!point) return null;
            const x = getX(idx);
            const y = height - pad.bottom;
            return (
              <g key={idx}>
                <line x1={x} y1={y} x2={x} y2={y + 5} stroke="#85938d" strokeWidth="1" />
                <text
                  x={x}
                  y={y + 19}
                  textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'}
                  fill="#788680"
                  fontSize="10"
                  fontFamily="var(--mono)"
                >
                  {formatXTimestamp(point.timestamp)}
                </text>
              </g>
            );
          })}

          {/* X Axis Label */}
          <text
            x={pad.left + chartWidth / 2}
            y={height - 8}
            textAnchor="middle"
            fill="#576861"
            fontSize="12"
            fontWeight="600"
          >
            {xAxisLabel}
          </text>

          {/* Series Paths */}
          {series.map((s) => {
            const pts = data.map((d, i) => {
              const val = Number(d[s.key]);
              if (!Number.isFinite(val)) return null;
              return [getX(i), getY(val)];
            }).filter(Boolean);

            if (pts.length === 0) return null;

            const pathD = pts.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(' ');
            const areaD = `${pathD} L ${pts[pts.length - 1][0]} ${height - pad.bottom} L ${pts[0][0]} ${height - pad.bottom} Z`;

            return (
              <g key={s.key}>
                {s.area && (
                  <path
                    d={areaD}
                    fill={s.areaGradient ? `url(#${s.areaGradient})` : (s.color || '#007a5e')}
                    opacity={s.areaGradient ? 1 : 0.15}
                  />
                )}
                <path
                  d={pathD}
                  fill="none"
                  stroke={s.color || '#007a5e'}
                  strokeWidth={s.strokeWidth || 2}
                  strokeDasharray={s.dashed ? '5 4' : 'none'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Highlight the selected daily reading so it can be matched to its metric card. */}
          {highlightPoint && (() => {
            const pointIndex = data.findIndex((point) => point.timestamp === highlightPoint.timestamp);
            const value = pointIndex >= 0 ? Number(data[pointIndex][highlightPoint.key]) : NaN;
            if (pointIndex < 0 || !Number.isFinite(value)) return null;
            const x = getX(pointIndex);
            const y = getY(value);
            const alignRight = pointIndex >= data.length - 2;
            return (
              <g key="highlight-point">
                <line x1={x} y1={pad.top} x2={x} y2={height - pad.bottom} stroke="#007a5e" strokeDasharray="3 3" strokeWidth="1.5" />
                <circle cx={x} cy={y} r="6" fill="#007a5e" stroke="#fff" strokeWidth="2.5" />
                <text x={x + (alignRight ? -6 : 6)} y={pad.top + 14} textAnchor={alignRight ? 'end' : 'start'} fill="#005e49" fontSize="10" fontFamily="var(--mono)" fontWeight="bold">ASSIGNED DAY</text>
              </g>
            );
          })()}

          {/* Forecast Vertical Horizon Line */}
          {forecastStartTimestamp && (
            (() => {
              const fIdx = data.findIndex((d) => new Date(d.timestamp) >= new Date(forecastStartTimestamp));
              if (fIdx >= 0) {
                const x = getX(fIdx);
                return (
                  <g>
                    <line
                      x1={x}
                      y1={pad.top}
                      x2={x}
                      y2={height - pad.bottom}
                      stroke="#2b82d9"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                    <text
                      x={x + 5}
                      y={pad.top + 14}
                      fill="#20609d"
                      fontSize="10"
                      fontFamily="var(--mono)"
                      fontWeight="bold"
                    >
                      FORECAST START
                    </text>
                  </g>
                );
              }
              return null;
            })()
          )}

          {/* Peak Point Marker */}
          {peakPoint && Number.isFinite(Number(peakPoint.Global_active_power)) && (
            (() => {
              const pIdx = data.findIndex((d) => d.timestamp === peakPoint.timestamp);
              if (pIdx >= 0) {
                const cx = getX(pIdx);
                const cy = getY(Number(peakPoint.Global_active_power));
                return (
                  <g key="peak-marker">
                    <circle cx={cx} cy={cy} r="6.5" fill="#e7895e" stroke="#fff" strokeWidth="2.5" />
                    <text x={cx} y={cy - 10} textAnchor="middle" fill="#c45d2e" fontSize="10" fontWeight="bold">
                      PEAK
                    </text>
                  </g>
                );
              }
              return null;
            })()
          )}

          {/* Anomaly markers */}
          {showAnomalies && data.map((d, i) => {
            if (d.anomaly || d.isAnomaly) {
              const val = Number(d.Global_active_power ?? d.value);
              if (!Number.isFinite(val)) return null;
              const cx = getX(i);
              const cy = getY(val);
              return (
                <g key={`anom-${i}`}>
                  <circle cx={cx} cy={cy} r="5" fill="#dc3545" stroke="#fff" strokeWidth="2" />
                  <circle cx={cx} cy={cy} r="9" fill="none" stroke="#dc3545" strokeWidth="1" opacity="0.6" />
                </g>
              );
            }
            return null;
          })}

          {/* Interactive Mouse Trigger Columns */}
          {data.map((d, i) => {
            const x = getX(i);
            const colWidth = chartWidth / data.length;
            return (
              <rect
                key={i}
                x={x - colWidth / 2}
                y={pad.top}
                width={Math.max(1, colWidth)}
                height={chartHeight}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                style={{ cursor: 'crosshair' }}
              />
            );
          })}

          {/* Hover Crosshair & Indicators */}
          {hoverIndex !== null && hoveredData && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={pad.top}
                x2={getX(hoverIndex)}
                y2={height - pad.bottom}
                stroke="#6b867c"
                strokeWidth="1.2"
                strokeDasharray="2 3"
              />
              {series.map((s) => {
                const val = Number(hoveredData[s.key]);
                if (!Number.isFinite(val)) return null;
                return (
                  <circle
                    key={`hover-dot-${s.key}`}
                    cx={getX(hoverIndex)}
                    cy={getY(val)}
                    r="5"
                    fill={s.color || '#007a5e'}
                    stroke="#fff"
                    strokeWidth="2"
                  />
                );
              })}
            </g>
          )}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoverIndex !== null && hoveredData && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: `${Math.min(80, Math.max(15, (getX(hoverIndex) / width) * 100))}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(23, 37, 34, 0.94)',
              color: '#fff',
              padding: '9px 13px',
              borderRadius: '7px',
              fontSize: '12px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
              pointerEvents: 'none',
              zIndex: 10,
              minWidth: '170px'
            }}
          >
            <div style={{ fontSize: '11px', color: '#a5b5ad', fontFamily: 'var(--mono)', marginBottom: '5px', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '4px' }}>
              {formatXTimestamp(hoveredData.timestamp)}
            </div>
            {series.map((s) => {
              const val = Number(hoveredData[s.key]);
              if (!Number.isFinite(val)) return null;
              return (
                <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '2px' }}>
                  <span style={{ color: s.color || '#7dd3ad', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: s.color || '#7dd3ad' }} />
                    {s.label}:
                  </span>
                  <strong style={{ fontFamily: 'var(--mono)' }}>
                    {val.toFixed(2)} {yUnit}
                  </strong>
                </div>
              );
            })}
            {hoveredData.Voltage && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '2px', color: '#cbd5e1' }}>
                <span>Voltage:</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{Number(hoveredData.Voltage).toFixed(1)} V</span>
              </div>
            )}
            {hoveredData.anomaly && (
              <div style={{ marginTop: '6px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.15)', color: '#ff7d7d', fontSize: '11px', fontWeight: 600 }}>
                ⚠️ Anomaly Flagged (Score: {hoveredData.anomalyScore ? Number(hoveredData.anomalyScore).toFixed(3) : 'High outlier'})
              </div>
            )}
            {peakPoint && hoveredData.timestamp === peakPoint.timestamp && (
              <div style={{ marginTop: '4px', color: '#fba57b', fontSize: '11px', fontWeight: 600 }}>
                ⭐ Highest Observed Peak
              </div>
            )}
          </div>
        )}
      </div>

      {/* Series Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px', marginTop: '10px', flexWrap: 'wrap' }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#576861' }}>
            <span
              style={{
                width: '18px',
                height: s.dashed ? '2px' : '3px',
                background: s.color || '#007a5e',
                borderTop: s.dashed ? `2px dashed ${s.color}` : 'none'
              }}
            />
            <span>{s.label}</span>
          </div>
        ))}
        {peakPoint && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#576861' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#e7895e', border: '2px solid #fff', boxShadow: '0 0 0 1px #e7895e' }} />
            <span>Highest Peak</span>
          </div>
        )}
        {highlightPoint && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#576861' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#007a5e' }} />
            <span>Assigned day peak</span>
          </div>
        )}
        {showAnomalies && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#576861' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#dc3545' }} />
            <span>Model Flagged Anomaly</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Analytical Distribution Bar Chart adhering to Section 3:
 * - Precise 24-Hour Mean Demand or Hourly Energy
 * - Clear Peak Hour indicator
 * - Interactive hover tooltips with exact values
 * - Proper X and Y axis labels
 */
export function AnalyticsBarChart({
  title,
  subtitle,
  hourlyData = [],
  metricKey = 'average',
  yAxisLabel = 'Mean Active Power (kW)',
  yUnit = 'kW',
  height = 240,
  barColor = '#34a876',
  peakColor = '#e7895e',
  showYAxisLabel = true,
  separateYAxisLabel = false
}) {
  const [hoveredHour, setHoveredHour] = useState(null);

  if (!hourlyData || hourlyData.length === 0) {
    return <div className="chart-empty" style={{ minHeight: height }}>No hourly readings available.</div>;
  }

  const maxVal = Math.max(0.1, ...hourlyData.map((d) => Number(d[metricKey]) || 0));
  const peakHourItem = hourlyData.reduce((prev, curr) => (Number(curr[metricKey]) > Number(prev[metricKey]) ? curr : prev), hourlyData[0]);

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <div style={{ marginBottom: '14px' }}>
        {title && <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{title}</h3>}
        {subtitle && <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--muted)' }}>{subtitle}</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', height: `${height}px`, gap: '5px', padding: `15px 10px 32px ${separateYAxisLabel ? '0' : '45px'}`, position: 'relative', borderBottom: '1px solid #e1e9e4' }}>
        {showYAxisLabel && separateYAxisLabel && <div style={{ flex: '0 0 18px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '10px', fontWeight: 600, color: '#576861', whiteSpace: 'nowrap' }}>
          {yAxisLabel}
        </div>}
        {showYAxisLabel && !separateYAxisLabel && <div style={{ position: 'absolute', left: '-5px', top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: '11px', fontWeight: 600, color: '#576861', whiteSpace: 'nowrap' }}>
          {yAxisLabel}
        </div>}

        {/* 24 Hourly Columns */}
        {hourlyData.map((item) => {
          const val = Number(item[metricKey]) || 0;
          const isPeak = item.hour === peakHourItem?.hour && val > 0;
          const barHeightPct = Math.max(3, (val / maxVal) * 100);

          return (
            <div
              key={item.hour}
              onMouseEnter={() => setHoveredHour(item)}
              onMouseLeave={() => setHoveredHour(null)}
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                position: 'relative',
                cursor: 'pointer'
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: '24px',
                  height: `${barHeightPct}%`,
                  background: isPeak ? peakColor : (hoveredHour?.hour === item.hour ? '#005e49' : barColor),
                  borderRadius: '3px 3px 0 0',
                  transition: 'background 0.15s, height 0.2s'
                }}
              />
              {/* Hour X Label */}
              <span
                style={{
                  position: 'absolute',
                  bottom: '-24px',
                  fontSize: '10px',
                  fontFamily: 'var(--mono)',
                  color: item.hour % 3 === 0 ? '#63736d' : 'transparent'
                }}
              >
                {String(item.hour).padStart(2, '0')}h
              </span>
            </div>
          );
        })}
      </div>

      {/* Hover Tooltip */}
      {hoveredHour && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            background: 'rgba(23, 37, 34, 0.94)',
            color: '#fff',
            padding: '7px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <strong style={{ fontFamily: 'var(--mono)' }}>{String(hoveredHour.hour).padStart(2, '0')}:00 UTC</strong>
          <div style={{ marginTop: '2px' }}>
            {yAxisLabel.split('(')[0]}: <strong>{(Number(hoveredHour[metricKey]) || 0).toFixed(2)} {yUnit}</strong>
          </div>
          {hoveredHour.count !== undefined && (
            <div style={{ fontSize: '11px', color: '#9bb0a5' }}>Sample points: {hoveredHour.count}</div>
          )}
          {hoveredHour.hour === peakHourItem?.hour && (
            <div style={{ color: '#fba57b', fontSize: '11px', fontWeight: 600, marginTop: '3px' }}>Highest Hourly Demand Period</div>
          )}
        </div>
      )}

      {/* Legend & X-Axis Note */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', fontSize: '11px', color: '#687771', flexWrap: 'wrap', gap: '8px' }}>
        <span>X-Axis: Hour of Day (00:00 - 23:00 UTC)</span>
        <div style={{ display: 'flex', gap: '14px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', background: '#34a876', borderRadius: '2px' }} />
            Mean Demand
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', background: '#e7895e', borderRadius: '2px' }} />
            Peak Hour ({String(peakHourItem?.hour).padStart(2, '0')}:00)
          </span>
        </div>
      </div>
    </div>
  );
}
