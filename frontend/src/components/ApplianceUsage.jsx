import { useMemo } from 'react';
import { AnalyticsBarChart } from './AnalyticsChart.jsx';

const meters = [
  {
    key: 'Sub_metering_1',
    title: 'Kitchen group',
    description: 'Kitchen group · mean Wh per interval by hour',
    color: '#007a5e',
    peakColor: '#005e49'
  },
  {
    key: 'Sub_metering_2',
    title: 'Laundry and lighting group',
    description: 'Laundry and lighting group · mean Wh per interval by hour',
    color: '#2b82d9',
    peakColor: '#1d5fa5'
  },
  {
    key: 'Sub_metering_3',
    title: 'Water heating and A/C group',
    description: 'Water heating and A/C group · mean Wh per interval by hour',
    color: '#d98242',
    peakColor: '#a85e28'
  }
];

export function ApplianceUsage({ analysis, readings = [] }) {
  const hourlyData = useMemo(() => {
    const groups = Object.fromEntries(meters.map(({ key }) => [
      key,
      Array.from({ length: 24 }, (_, hour) => ({ hour, sum: 0, count: 0 }))
    ]));

    readings.forEach((reading) => {
      if (!reading.timestamp) return;
      const hour = new Date(reading.timestamp).getUTCHours();
      meters.forEach(({ key }) => {
        const rawValue = reading[key];
        if (rawValue === null || rawValue === undefined || rawValue === '') return;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;
        groups[key][hour].sum += value;
        groups[key][hour].count += 1;
      });
    });

    return Object.fromEntries(meters.map(({ key }) => [
      key,
      readings.length
        ? groups[key].map(({ hour, sum, count }) => ({ hour, average: count ? sum / count : 0 }))
        : []
    ]));
  }, [readings]);

  const hasSubMeterData = readings.some((reading) => meters.some(({ key }) => {
    const value = reading[key];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }));

  return <div className="page-content">
    <PageHeading analysis={analysis} />
    {!hasSubMeterData ? <section className="surface empty-state">
      <div>
        <h2>Sub-meter readings unavailable</h2>
        <p>Upload data containing Sub_metering_1, Sub_metering_2, and Sub_metering_3 to compare the groups.</p>
      </div>
    </section> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
      {meters.map((meter) => <section className="surface" style={{ minWidth: 0, padding: '18px' }} key={meter.key}>
        <AnalyticsBarChart
          title={meter.title}
          subtitle={meter.description}
          hourlyData={hourlyData[meter.key]}
          metricKey="average"
          yAxisLabel="Mean energy per 1-min interval (Wh)"
          yUnit="Wh/interval"
          barColor={meter.color}
          peakColor={meter.peakColor}
          height={230}
        />
      </section>)}
    </div>}
    <div className="notice">
      <span>These are grouped energy readings, not individual appliance power measurements. Hourly averages use the readings loaded for the charts, which may be a sample of a larger upload.</span>
    </div>
  </div>;
}

function PageHeading({ analysis }) {
  return <div className="page-heading">
    <div>
      <p className="eyebrow">ENERGY WORKSPACE / SUB-METERING</p>
      <h1>Appliance usage</h1>
      <p>Compare the three sub-meter groups by hour (UTC).</p>
    </div>
    {analysis && <span className="active-analysis"><i /> ANALYSIS LOADED</span>}
  </div>;
}
