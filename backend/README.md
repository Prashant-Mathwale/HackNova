# EnergyIQ backend

Node.js 22+ / Express 5 API for uploading the UCI Individual Household Electric Power Consumption CSV, storing normalized readings in MongoDB, and requesting forecasts/anomaly labels from a separate FastAPI service.

## Current implementation and assumptions

- This repository did not contain a backend or FastAPI service when this API was added. The ML endpoints below are a **proposed shared contract**, not a claim that the Python service has been integrated or verified. The backend fails the analysis if the service is unavailable or returns an invalid response; it never fabricates results.
- CSV uploads are processed asynchronously in the Node process. `POST /api/uploads` responds with `202`; poll `GET /api/analyses/{analysisId}` until status is `completed` or `failed`. Jobs are not distributed across multiple backend instances. A backend restart marks in-flight records failed with `PROCESS_RESTARTED`.
- The parser accepts the UCI dataset's nine columns and comma- or semicolon-delimited headers. Timestamps are stored as UTC, interpreting the source's timezone-unspecified wall-clock values as UTC. Preserve and confirm that assumption with the data owner before comparing against local-time systems.
- Rows must be chronological. Duplicate timestamps and out-of-order rows are skipped and counted as invalid. Rows with malformed timestamps, invalid numeric values, or missing active power are skipped. `?` (and empty cells) in other numeric fields are retained as null and counted as missing values. Anomaly inference only includes readings with all seven measurements present.
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

The Python service is not present in this repository. From that service's own directory, activate its virtual environment and run the module that defines its FastAPI `app`; for example, if its entry point is `main.py`:

```powershell
Set-Location C:\path\to\your\ml-service
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8000
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

## FastAPI integration contract (to agree with the ML team)

Use `ML_SERVICE_URL` as the base URL. The Node client uses bounded request timeouts, does not automatically retry POSTs, and does not log payloads. Responses are validated before persistence.

`GET /health` returns a successful HTTP status while the service is healthy.

`POST /predict/consumption` receives up to `FORECAST_HISTORY_ROWS` chronological readings:

```json
{
  "readings": [
    { "timestamp": "2007-01-01T00:00:00.000Z", "Global_active_power": 2.45 }
  ],
  "horizon": 1
}
```

It must return a non-empty `forecast` array, a non-empty `model_version`, and optional `horizon` and `validation`:

```json
{
  "forecast": [
    { "timestamp": "2007-01-01T00:01:00.000Z", "predicted_active_power_kw": 2.3 }
  ],
  "horizon": 1,
  "model_version": "random-forest-v1",
  "validation": { "mae_kw": 0.25 }
}
```

The Python team must confirm the minimum history required for model lag features and the intended forecast timestamp/horizon. The Node backend currently enforces at least two valid history points; that is a safe minimum, not confirmation of the trained model's actual requirement.

`POST /detect/anomalies` receives batches of up to `ANOMALY_BATCH_SIZE` chronological readings. Only complete measurement rows are sent:

```json
{
  "readings": [
    {
      "timestamp": "2007-01-01T00:00:00.000Z",
      "Global_active_power": 2.45,
      "Global_reactive_power": 0.2,
      "Voltage": 230.1,
      "Global_intensity": 10.5,
      "Sub_metering_1": 0,
      "Sub_metering_2": 1,
      "Sub_metering_3": 5
    }
  ]
}
```

Return one result per input reading, in the same order and with the same timestamp, plus a non-empty model version:

```json
{
  "anomalies": [
    { "timestamp": "2007-01-01T00:00:00.000Z", "is_anomaly": false, "score": 0.12 }
  ],
  "model_version": "isolation-forest-v1"
}
```

If the deployed FastAPI implementation uses different paths, field names, feature order, minimum history, or response semantics, agree the contract and update `src/services/ml.service.js` and its tests together. The service was not available for live verification in this repository.

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

The upload middleware writes to a generated filename in the operating system's temporary directory. The API creates a `processing` analysis record and returns immediately. The worker streams the CSV parser, writes readings to MongoDB in 1,000-document batches, computes summary statistics, submits bounded chronological input to FastAPI, persists the model results, and changes the status to `completed`. Any known processing/ML failure records `failed`, removes partial reading records, and the temporary upload is removed in a `finally` cleanup path. A restart fails abandoned `processing` analyses.

MongoDB stores metadata in `Analysis` and readings in `Reading`, with indexes for analysis/time and anomaly lookups. Large raw CSV files and full readings arrays are not stored in a single BSON document. Chart pages are capped. This is an in-process hackathon implementation: use one backend process, and do not treat analysis IDs as access-control tokens.

## Troubleshooting

- **Startup says MongoDB is unavailable:** start the local service or verify `MONGODB_URI`, network access, and credentials.
- **Health reports `mlService: unavailable`:** start FastAPI and verify `ML_SERVICE_URL/health`. Uploads can be accepted while health is degraded, but analyses fail explicitly if ML inference cannot complete.
- **Upload is rejected as unsupported:** use a filename ending in `.csv`; file extensions are only the first check, and the content must still have the supported header.
- **CSV has no usable readings:** confirm required headers, numeric active power, `DD/MM/YYYY` dates and `HH:mm:ss` times, and ascending unique timestamps.
- **CORS error:** set `FRONTEND_ORIGIN` to the exact browser origin (scheme, host, and port); multiple allowed origins can be comma-separated.
- **Analysis has failed:** inspect its safe `error.code`/`error.message`, verify both dependencies and the FastAPI response contract, then upload again. Internal diagnostics are correlated using `X-Request-ID` and server logs.
