# EnergyIQ backend

Node.js 22+ / Express 5 API for uploading the UCI Individual Household Electric Power Consumption CSV, storing normalized readings in MongoDB, and requesting forecasts/anomaly labels from a separate FastAPI service.

## Current implementation and assumptions

- The backend calls the repository's FastAPI routes at `GET /health`, `POST /predict/consumption`, and `POST /detect/anomalies`. It translates UCI columns into the Python service's canonical reading fields and validates the actual FastAPI response schemas. ML requests are not mocked in production, and no predictions are fabricated.
- CSV uploads are processed asynchronously in the Node process. `POST /api/uploads` responds with `202`; poll `GET /api/analyses/{analysisId}` until status is `completed` or `failed`. Jobs are not distributed across multiple backend instances. A backend restart marks in-flight records failed with `PROCESS_RESTARTED`.
- The parser accepts the UCI dataset's nine columns and comma- or semicolon-delimited headers. Timestamps are stored as UTC, interpreting the source's timezone-unspecified wall-clock values as UTC. Preserve and confirm that assumption with the data owner before comparing against local-time systems.
- Rows must be chronological. Duplicate timestamps and out-of-order rows are skipped and counted as invalid. Rows with malformed timestamps, invalid numeric values, or missing active power are skipped. `?` (and empty cells) in other numeric fields are retained as null and counted as missing values. Anomaly inference receives these optional null fields; the Python model imputes them using its trained medians.
- Numeric sanity limits are active/reactive power `0–100`, voltage `>0–500`, intensity `0–1000`, and each sub-metering value `0–100000`, in the source's units. These intentionally broad checks are for the supported UCI data format, not universal utility-export validation.
- Raw normalized readings and anomaly flags are stored as individual MongoDB documents, not embedded in the analysis metadata. Chart and anomaly results are paginated. Documents are not user-private: authentication and ownership checks are not implemented, so analysis IDs are not authorization tokens. Do not expose this service publicly with sensitive household data.
- `observedActivePowerSampleSumKw` is the sum of power samples, **not energy consumed**. No kWh or energy estimate is calculated because interval-based integration is not part of this contract.
- One analysis can retain up to `MAX_CSV_ROWS` readings. Uploads are rate limited to 10 per IP per minute; deployments behind a proxy must configure Express proxy trust carefully before relying on IP-based limits.

## Requirements and setup (PowerShell)

Use Node.js 22 LTS or a newer supported LTS release.

```powershell
Set-Location .\backend
npm install
Copy-Item .env.example .env
```

Edit `.env` if MongoDB, the frontend origin, or the ML service uses a different address. Never commit `.env`.

### MongoDB

Start a local MongoDB service using your installation's Windows service name, if installed:

```powershell
Get-Service *mongo*
Start-Service MongoDB
```

Or set `MONGODB_URI` in `.env` to a reachable MongoDB deployment. The backend waits for MongoDB before listening. The first analysis creates the `Analysis` and `Reading` collections and their indexes.

### Run and test

```powershell
Set-Location .\backend
npm run dev
```

In another PowerShell window:

```powershell
Set-Location .\backend
npm test
```

`npm test` uses Node's built-in test runner and Supertest. Unit tests mock the ML HTTP calls; they do not require a real FastAPI process or MongoDB connection. The API tests include health/dependency status and validation/error responses.

### Run the separate FastAPI service

The FastAPI application is in the repository root. In a separate PowerShell window from the repository root:

```powershell
Set-Location ..
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Set `ML_SERVICE_URL` to its base URL. The backend checks `GET /health`.

## API contract

All endpoints are under `/api`. Success responses use:

```json
{ "success": true, "message": "Request completed", "data": {} }
```

Errors use HTTP status codes and:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CSV",
    "message": "The CSV is missing required columns.",
    "details": []
  },
  "requestId": "..."
}
```

Every response includes `X-Request-ID`. Unexpected internal errors do not expose stack traces, filesystem paths, or database error details.

### Health

`GET /api/health`

No request body. Returns `200` when MongoDB and FastAPI health checks are available, otherwise `503` with `data.status: "degraded"` and dependency states.

```json
{
  "success": true,
  "message": "Health check completed",
  "data": {
    "service": "energyiq-backend",
    "status": "degraded",
    "database": "connected",
    "mlService": "unavailable"
  }
}
```

### Upload a CSV

`POST /api/uploads`

- Header: `Content-Type: multipart/form-data`
- Required field: `file` (a `.csv` file)
- Response: `202 Accepted`, with analysis ID and initial `processing` status.
- Errors: `400` missing/invalid multipart data, `413` too large, `415` wrong extension, `422` invalid CSV/row limit, `429` rate limited.

PowerShell using `curl.exe`:

```powershell
curl.exe -X POST http://localhost:5000/api/uploads -F "file=@C:\data\household_power_consumption.txt;type=text/csv"
```

Although the UCI download is commonly named `.txt`, copy or rename it to `.csv` before upload. PowerShell `Invoke-RestMethod` example:

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/uploads `
  -Method Post -Form @{ file = Get-Item 'C:\data\household_power_consumption.csv' }
```

Example response:

```json
{
  "success": true,
  "message": "Analysis started",
  "data": { "analysisId": "68f000000000000000000001", "status": "processing" }
}
```

### Analysis status/details

`GET /api/analyses/{analysisId}`

Returns status, safe error details when failed, original display filename, timestamps, row counts, summary, bounded forecast and anomaly summaries, and model version. Poll this endpoint while `status` is `processing`. A failed analysis may be re-run by uploading the source file again.

Errors: `400` invalid ObjectId, `404` not found.

### Analysis history

`GET /api/analyses?page=1&pageSize=20&status=completed&sort=desc`

- `page`: positive integer, defaults to `1`.
- `pageSize`: `1`–`100`, defaults to `20`.
- `status`: optional `processing`, `completed`, or `failed`.
- `sort`: optional `asc` or `desc` by creation time; defaults to `desc`.
- Errors: `400` invalid query values.

The response contains `items` and `pagination` (`page`, `pageSize`, `total`, `totalPages`). It does not include raw readings or anomaly arrays.

### Forecast

`GET /api/analyses/{analysisId}/forecast`

Returns `predictions` with UTC target timestamp and `predictedActivePowerKw`, `unit`, `horizon`, `modelVersion`, and model `validation` metadata. `409` means processing is ongoing; `422` means no forecast is available.

### Anomalies

`GET /api/analyses/{analysisId}/anomalies?page=1&pageSize=100`

Returns the total flagged count, classification caveat, and paginated measurements (`timestamp`, source measurement fields, and model score where provided). Page size is capped at `100`. Results are statistical model flags, not proof of faults, theft, or unsafe conditions. `409` means processing is ongoing; `422` means results are unavailable.

### Consumption chart data

`GET /api/analyses/{analysisId}/consumption?page=1&pageSize=500`

Returns timestamped normalized readings and pagination metadata. Page size is capped at `1000`. Fields whose source values were missing are `null`. Invalid timestamps, rows with missing active power, out-of-order rows, and duplicate timestamps are not retained.

### Delete an analysis

`DELETE /api/analyses/{analysisId}`

Deletes the analysis and its persisted readings. Repeated deletion is idempotent and returns `deleted: false` when the record was already absent. Authentication is not implemented; anyone who can reach this API and knows an ID can request deletion.

### Copyable frontend examples

```js
const form = new FormData();
form.append("file", fileInput.files[0]);

const upload = await fetch("http://localhost:5000/api/uploads", {
  method: "POST",
  body: form
});
const { data: { analysisId } } = await upload.json();

async function pollAnalysis(id) {
  const response = await fetch(`http://localhost:5000/api/analyses/${id}`);
  return response.json();
}

const analysis = await pollAnalysis(analysisId);
if (analysis.data.status === "completed") {
  const [chart, forecast, anomalies] = await Promise.all([
    fetch(`http://localhost:5000/api/analyses/${analysisId}/consumption?page=1&pageSize=500`).then(r => r.json()),
    fetch(`http://localhost:5000/api/analyses/${analysisId}/forecast`).then(r => r.json()),
    fetch(`http://localhost:5000/api/analyses/${analysisId}/anomalies?page=1&pageSize=50`).then(r => r.json())
  ]);
}
```

## FastAPI integration contract (implemented)

Use `ML_SERVICE_URL` as the base URL. The Node client uses bounded request timeouts, does not automatically retry POSTs, and does not log payloads. Responses are validated before persistence.

`GET /health` must return `"status": "ok"` and both `"forecasting": true` and `"anomaly_detection": true` in `model_readiness` for the backend health route to report `mlService: "available"`. Check `GET /models/status` when an artifact needs retraining.

Both POST routes use the Python `Reading` schema. The Node adapter maps the UCI columns to canonical API names (`active_power_kw`, `reactive_power`, `voltage_v`, `current_a`, and `sub_metering_1`–`sub_metering_3`). Optional sensor values remain `null`; the anomaly model can impute them using its trained medians.

`POST /predict/consumption` receives up to `FORECAST_HISTORY_ROWS` chronological readings, with `horizon_steps: 1` and `interval_minutes: 1`:

```json
{
  "readings": [
    {
      "timestamp": "2007-01-01T00:00:00.000Z",
      "active_power_kw": 2.45,
      "reactive_power": 0.2,
      "voltage_v": 230.1,
      "current_a": 10.5,
      "sub_metering_1": 0,
      "sub_metering_2": 1,
      "sub_metering_3": 5
    }
  ],
  "horizon_steps": 1,
  "interval_minutes": 1
}
```

The Python service requires at least 30 consecutive one-minute readings and a trained forecasting artifact. The backend checks the history length and one-minute spacing before making the request. The actual response includes:

```json
{
  "status": "success",
  "latest_observed_active_power_kw": 2.45,
  "predictions": [
    {
      "active_power_kw": 2.3,
      "timestamp": "2007-01-01T00:01:00+00:00",
      "horizon_steps": 1,
      "persistence_baseline_kw": 2.45,
      "absolute_difference_from_baseline_kw": 0.15
    }
  ],
  "unit": "kW",
  "model": { "name": "random_forest", "version": "1.0" },
  "warnings": []
}
```

The backend maps this response into the dashboard contract's `predictions`, `unit`, `horizon`, `modelVersion`, and validation metadata.

`POST /detect/anomalies` receives batches of up to `ANOMALY_BATCH_SIZE` readings in the same canonical schema:

```json
{
  "readings": [
    {
      "timestamp": "2007-01-01T00:00:00.000Z",
      "active_power_kw": 2.45,
      "reactive_power": 0.2,
      "voltage_v": 230.1,
      "current_a": 10.5,
      "sub_metering_1": 0,
      "sub_metering_2": 1,
      "sub_metering_3": 5
    }
  ]
}
```

The response returns one ordered result per input reading with its original timestamp:

```json
{
  "status": "success",
  "results": [
    {
      "timestamp": "2007-01-01T00:00:00+00:00",
      "is_anomaly": false,
      "score": 0.12,
      "explanation": "No unusual pattern was detected by the fitted model."
    }
  ],
  "flagged_count": 0,
  "model": { "name": "isolation_forest", "version": "1.0" },
  "warnings": []
}
```

FastAPI `422` validation errors and `503` model-not-ready responses are mapped to safe backend error codes. The Node tests mock the actual FastAPI response/request contract; live service connectivity still requires starting MongoDB and FastAPI locally.

## Configuration

See `.env.example`. Environment variables are validated at startup:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5000` | HTTP listen port |
| `NODE_ENV` | `development` | Runtime mode |
| `MONGODB_URI` | local EnergyIQ database | MongoDB connection |
| `ML_SERVICE_URL` | `http://127.0.0.1:8000` | FastAPI base URL |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Comma-separated CORS origin allowlist |
| `MAX_UPLOAD_SIZE_MB` | `20` | Multer maximum upload |
| `MAX_CSV_ROWS` | `200000` | Maximum data rows |
| `ANALYSIS_TIMEOUT_MS` | `120000` | Overall processing budget |
| `ML_REQUEST_TIMEOUT_MS` | `30000` | Per-call ML timeout |
| `FORECAST_HISTORY_ROWS` | `1000` | Maximum recent forecast context |
| `ANOMALY_BATCH_SIZE` | `5000` | Maximum anomaly request batch |

## Data flow and limits

The upload middleware writes to a generated filename in the operating system's temporary directory. The API creates a `processing` analysis record and returns immediately. The worker streams the CSV parser, writes readings to MongoDB in 1,000-document batches, computes summary statistics, submits up to 1,000 recent chronological records for forecasting and sends complete readings in bounded batches to FastAPI for anomaly inference, persists the model results, and changes the status to `completed`. Forecasting requires at least 30 consecutive one-minute readings. Any known processing/ML failure records `failed`, removes partial reading records, and the temporary upload is removed in a `finally` cleanup path. A restart fails abandoned `processing` analyses.

MongoDB stores metadata in `Analysis` and readings in `Reading`, with indexes for analysis/time and anomaly lookups. Large raw CSV files and full readings arrays are not stored in a single BSON document. Chart pages are capped. This is an in-process hackathon implementation: use one backend process, and do not treat analysis IDs as access-control tokens.

## Troubleshooting

- **Startup says MongoDB is unavailable:** start the local service or verify `MONGODB_URI`, network access, and credentials.
- **Health reports `mlService: unavailable`:** start FastAPI, verify `ML_SERVICE_URL/health`, and confirm both `forecasting` and `anomaly_detection` are available in `model_readiness` (train missing models with `python -m scripts.train_all` and restart FastAPI). Uploads can be accepted while health is degraded, but analyses fail explicitly if ML inference cannot complete.
- **Upload is rejected as unsupported:** use a filename ending in `.csv`; file extensions are only the first check, and the content must still have the supported header.
- **CSV has no usable readings:** confirm required headers, numeric active power, `DD/MM/YYYY` dates and `HH:mm:ss` times, and ascending unique timestamps.
- **CORS error:** set `FRONTEND_ORIGIN` to the exact browser origin (scheme, host, and port); multiple allowed origins can be comma-separated.
- **Analysis has failed:** inspect its safe `error.code`/`error.message`, verify MongoDB, both trained model artifacts, and that forecast readings are regularly spaced at one-minute intervals. The forecast model requires at least 30 readings. Internal diagnostics are correlated using `X-Request-ID` and server logs.
