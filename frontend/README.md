# EnergyIQ frontend

Responsive React/Vite interface for the EnergyIQ Node API. It provides preview-only sign-in, CSV upload, and separate Overview, Consumption, Peak demand, Forecast, Anomaly review, and Data quality views.

## Run locally

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Vite runs at `http://localhost:3000`, matching the backend's default CORS origin. Start MongoDB, the Node API, and FastAPI separately as described in the root and backend READMEs. Set `VITE_API_BASE_URL` in a local `.env` file to change the API base; see `.env.example`.

The backend does not implement authentication, and analysis IDs are not private. Do not use this UI for sensitive production data until authentication and authorization are added to the API. Current API output includes a one-step active-power forecast and model-flagged anomalies; the interface does not describe these as energy totals, verified faults, or recommendations.