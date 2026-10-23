import React from 'react';
import { AlertTriangle, Clock, Lightbulb, Zap, ShieldCheck } from 'lucide-react';

/**
 * Section 10: Actionable, Data-Supported Recommendations Component
 * Translates dataset patterns into concrete advisory guidance with confidence and evidence.
 */
export function RecommendationsSection({ analysis, readings = [], anomalies = null }) {
  if (!analysis || !analysis.summary) return null;

  const summary = analysis.summary;
  const avgKw = summary.averageActivePowerKw || 0;
  const peakKw = summary.maxActivePowerKw || 0;
  const peakTime = summary.peakTimestamp ? new Date(summary.peakTimestamp) : null;
  const flaggedCount = anomalies?.totalFlagged ?? analysis.anomalySummary?.totalFlagged ?? 0;
  const readingCount = summary.validReadingCount || analysis.totalRows || 0;

  const recommendations = [];

  // 1. Peak Demand Spike Advisory
  if (peakKw > 0) {
    const ratio = avgKw > 0 ? (peakKw / avgKw).toFixed(1) : null;
    recommendations.push({
      id: 'peak-spike',
      type: 'warning',
      icon: Zap,
      title: 'Peak Load Interval Detected',
      observation: `Observed demand surged to ${peakKw.toFixed(2)} kW at ${peakTime ? peakTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'peak interval'}${ratio ? `, which is ${ratio}x higher than the dataset average (${avgKw.toFixed(2)} kW)` : ''}.`,
      evidence: `Peak timestamp: ${peakTime ? peakTime.toUTCString() : 'Recorded in dataset'} · Active Power: ${peakKw.toFixed(2)} kW`,
      suggestedAction: 'Review concurrent heavy appliances (e.g. EV charger, water heating, electric oven) operating around this timeframe to spread load.',
      confidence: 'High (Direct measurement)',
      tag: 'Demand Management'
    });
  }

  // 2. Anomaly Review Advisory
  if (flaggedCount > 0) {
    const anomalyRate = readingCount > 0 ? ((flaggedCount / readingCount) * 100).toFixed(1) : 0;
    recommendations.push({
      id: 'anomaly-alert',
      type: 'danger',
      icon: AlertTriangle,
      title: 'Model-Flagged Statistical Outliers',
      observation: `The Isolation Forest model identified ${flaggedCount.toLocaleString()} readings (${anomalyRate}% of analyzed samples) as statistical outliers.`,
      evidence: `${flaggedCount} readings deviated significantly from baseline multivariate patterns (power, voltage, current).`,
      suggestedAction: 'Inspect the Anomaly Review table to verify whether these coincide with unusual appliance spikes, metering dropouts, or transient voltage dips.',
      confidence: 'Medium (Statistical detection - not verified hardware faults)',
      tag: 'Diagnostics'
    });
  } else {
    recommendations.push({
      id: 'anomaly-clean',
      type: 'success',
      icon: ShieldCheck,
      title: 'Stable Baseline Profile',
      observation: 'No statistical anomalies were flagged by the Isolation Forest model under standard sensitivity.',
      evidence: `Zero readings exceeded the contamination threshold across ${readingCount.toLocaleString()} validated observations.`,
      suggestedAction: 'Power draw remained within expected normal distributions for this household sample.',
      confidence: 'High',
      tag: 'System Health'
    });
  }

  // 3. Time-of-Use & Night Load
  if (readings.length > 0) {
    const nightReadings = readings.filter((r) => {
      const h = new Date(r.timestamp).getUTCHours();
      return h >= 0 && h <= 5;
    });
    if (nightReadings.length > 0) {
      const nightAvg = nightReadings.reduce((sum, r) => sum + (Number(r.Global_active_power) || 0), 0) / nightReadings.length;
      if (nightAvg > 0.4) {
        recommendations.push({
          id: 'base-load',
          type: 'info',
          icon: Clock,
          title: 'Elevated Overnight Basal Load',
          observation: `Average overnight consumption (00:00 - 05:00 UTC) is ${nightAvg.toFixed(2)} kW.`,
          evidence: `Computed across ${nightReadings.length} overnight readings.`,
          suggestedAction: 'Check for high "vampire" or standby electrical loads such as continuous climate control, entertainment centers, or unmonitored baseline appliances.',
          confidence: 'Medium',
          tag: 'Efficiency'
        });
      }
    }
  }

  // 4. Data Span Advisory
  const dateRange = analysis.dateRange;
  if (dateRange?.start && dateRange?.end) {
    const spanHours = (new Date(dateRange.end) - new Date(dateRange.start)) / (1000 * 3600);
    if (spanHours < 48) {
      recommendations.push({
        id: 'data-limitation',
        type: 'neutral',
        icon: Lightbulb,
        title: 'Dataset Timespan Notice',
        observation: `The uploaded dataset spans approximately ${spanHours.toFixed(1)} hours.`,
        evidence: `Range: ${new Date(dateRange.start).toLocaleDateString()} to ${new Date(dateRange.end).toLocaleDateString()}.`,
        suggestedAction: 'Long-term seasonal and weekly billing analyses require multi-week continuous readings. Upload longer recording intervals for comprehensive trend analytics.',
        confidence: 'Informational',
        tag: 'Data Quality'
      });
    }
  }

  return (
    <div className="recommendations-container" style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <span className="section-kicker">DATA-DRIVEN INSIGHTS</span>
          <h2 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 600 }}>Actionable Optimization Guidance</h2>
        </div>
        <span style={{ fontSize: '11px', color: '#576861', fontFamily: 'var(--mono)', background: '#edf7f1', padding: '5px 9px', borderRadius: '5px' }}>
          {recommendations.length} Active Findings
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
        {recommendations.map((rec) => {
          const IconComponent = rec.icon;
          const toneColors = {
            warning: { border: '#fad5b8', bg: '#fffbf7', iconBg: '#ffe8d6', iconColor: '#d9652b' },
            danger: { border: '#f7c8c8', bg: '#fff9f9', iconBg: '#ffe2e2', iconColor: '#c92a2a' },
            success: { border: '#c3ebd5', bg: '#f9fdfa', iconBg: '#d9f5e5', iconColor: '#007a5e' },
            info: { border: '#c8e1f5', bg: '#f9fcfe', iconBg: '#d9edfb', iconColor: '#1d70b8' },
            neutral: { border: '#e1e8e4', bg: '#ffffff', iconBg: '#eef3f0', iconColor: '#4f615b' }
          };
          const style = toneColors[rec.type] || toneColors.neutral;

          return (
            <article
              key={rec.id}
              style={{
                border: `1px solid ${style.border}`,
                background: style.bg,
                borderRadius: '9px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '7px',
                        background: style.iconBg,
                        color: style.iconColor,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0
                      }}
                    >
                      <IconComponent size={17} />
                    </div>
                    <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{rec.title}</strong>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'var(--mono)',
                      background: '#fff',
                      border: `1px solid ${style.border}`,
                      padding: '3px 7px',
                      borderRadius: '4px',
                      color: style.iconColor
                    }}
                  >
                    {rec.tag}
                  </span>
                </div>

                <p style={{ margin: '12px 0 8px', fontSize: '12.5px', color: '#384842', lineHeight: '1.5' }}>
                  {rec.observation}
                </p>

                <div style={{ fontSize: '11.5px', color: '#687771', background: 'rgba(0,0,0,0.025)', padding: '8px 10px', borderRadius: '5px', margin: '8px 0' }}>
                  <strong>Evidence:</strong> {rec.evidence}
                </div>
              </div>

              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '12px', color: 'var(--green-dark)', fontWeight: 500 }}>
                  💡 <strong>Suggested Action:</strong> {rec.suggestedAction}
                </div>
                <div style={{ marginTop: '6px', fontSize: '10px', color: '#7a8983' }}>
                  Confidence: {rec.confidence}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
