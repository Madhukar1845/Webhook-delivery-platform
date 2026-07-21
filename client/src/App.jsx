import { useState, useEffect } from "react";
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState('');
  const [result, setResult] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [metrics, setMetrics] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const bodyObject = { url, eventTypes: eventTypes.split(',').map(s => s.trim()) };
    const response = await fetch('http://localhost:3000/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObject)
    });
    setResult(await response.json());
  }

  async function fetchDeliveries() {
    const response = await fetch('http://localhost:3000/deliveries');
    const data = await response.json();
    setDeliveries(data.deliveries);
  }
  useEffect(() => {
    fetchDeliveries();
    const interval = setInterval(fetchDeliveries, 3000);
    return () => clearInterval(interval);
  }, []);

  async function fetchMetrics() {
    const response = await fetch('http://localhost:3000/metrics');
    const data = await response.json();
    setMetrics(data);
  }
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  async function fireEvent(type) {
    const bodyObject = {
      type,
      payload: { orderId: `demo_${Date.now()}` }
    };
    await fetch('http://localhost:3000/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObject)
    });
  }

  const retryingJobs = deliveries.filter(d => d.status === 'pending' || d.status === 'failed');
  const getStatusBadgeClass = (status) => {
    switch(status) {
      case 'delivered': return 'badge-delivered';
      case 'failed': return 'badge-failed';
      case 'pending': return 'badge-pending';
      case 'dead_letter': return 'badge-dead';
      default: return 'badge-unknown';
    }
  };
  const formatRetryTime = (nextRetryAt) => {
    if (!nextRetryAt) return '-';
    const date = new Date(nextRetryAt);
    const now = new Date();
    const diff = date - now;
    if (diff < 0) return 'due now';
    const secs = Math.round(diff / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.round(secs / 60);
    return `${mins}m`;
  };

  return (
    <div>
      <h1>Webhook Delivery Platform — Delivery Dashboard</h1>

      <div className="top-row">
        <div className="panel">
          <h2>Register Subscription</h2>
          <form onSubmit={handleSubmit} className="stacked-form">
            <input
              type='text'
              placeholder="Webhook URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <input
              type='text'
              placeholder='Event types (comma-separated)'
              value={eventTypes}
              onChange={(e) => setEventTypes(e.target.value)}
            />
            <button type="submit">Register</button>
          </form>
          {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
        </div>

        <div className="panel">
          <h2>Metrics</h2>
          {metrics && (
            <div className="metrics-grid">
              <div className="stat-card">
                <span className="stat-label">Delivered</span>
                <span className="stat-value good">{metrics.totalDelivered}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Failed</span>
                <span className="stat-value bad">{metrics.totalFailed}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Retrying</span>
                <span className="stat-value warning">{retryingJobs.length}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">p50</span>
                <span className="stat-value">{metrics.p50}ms</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">p95</span>
                <span className="stat-value">{metrics.p95}ms</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">p99</span>
                <span className="stat-value">{metrics.p99}ms</span>
              </div>
            </div>
          )}
          <h3>Fire Test Event</h3>
          <div className="event-buttons">
            <button onClick={() => fireEvent('order.created')}>order.created</button>
            <button onClick={() => fireEvent('order.cancelled')}>order.cancelled</button>
            <button onClick={() => fireEvent('payment.failed')}>payment.failed</button>
          </div>
        </div>
      </div>

      {retryingJobs.length > 0 && (
        <div className="retry-panel" style={{ marginTop: '32px' }}>
          <h2 style={{ color: '#ffa500' }}>⚡ Retrying Jobs ({retryingJobs.length})</h2>
          <div className="retry-grid">
            {retryingJobs.slice(0, 5).map((job) => (
              <div key={job._id} className="retry-card">
                <div className="retry-header">
                  <span className={`status-badge ${getStatusBadgeClass(job.status)}`}>
                    {job.status.toUpperCase()}
                  </span>
                  <span className="retry-time">Retry in {formatRetryTime(job.nextRetryAt)}</span>
                </div>
                <div className="retry-details">
                  <div><strong>Attempts:</strong> {job.attempts}/8</div>
                  <div><strong>Last Try:</strong> {new Date(job.lastAttemptAt).toLocaleTimeString()}</div>
                  {job.nextRetryAt && <div><strong>Next Retry:</strong> {new Date(job.nextRetryAt).toLocaleTimeString()}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 style={{ marginTop: '32px' }}>Recent Deliveries</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Latency</th>
              <th>Response Code</th>
              <th>Attempts</th>
              <th>Next Retry</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery._id} className={delivery.status === 'pending' || delivery.status === 'failed' ? 'row-retrying' : ''}>
                <td><span className={`status-badge ${getStatusBadgeClass(delivery.status)}`}>{delivery.status}</span></td>
                <td>{delivery.latencyMs ? `${delivery.latencyMs}ms` : '-'}</td>
                <td>{delivery.responseCode || '-'}</td>
                <td>{delivery.attempts}</td>
                <td>{formatRetryTime(delivery.nextRetryAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;