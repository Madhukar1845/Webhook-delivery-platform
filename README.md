# Webhook Delivery Platform

A reliable, at-least-once webhook delivery system built from scratch — modeled on how Stripe and GitHub deliver events to their customers' servers. Built to explore real distributed-systems reliability patterns: durable event streaming, crash recovery, circuit breaking, rate limiting, and idempotent, signed delivery.

## What it does

A platform (an e-commerce backend, a payments system, anything with events) needs to notify other companies' servers the instant something happens — an order was created, a payment failed. This project is the infrastructure that makes that notification **reliable**: it survives worker crashes, backs off intelligently on failure, stops hammering dead subscribers, respects each subscriber's rate limits, and lets subscribers cryptographically verify what they receive.

```
POST /events  →  Redis Stream  →  Fanout Worker  →  Delivery Worker  →  Subscriber's URL
                                        ↓                    ↓
                                   MongoDB (Event,      Circuit Breaker
                                   Subscription,        Rate Limiter
                                   DeliveryJob)          Retry Scheduler
```

## Core features

- **Durable ingestion** — Redis Streams with consumer groups guarantee at-least-once processing, even across worker crashes (via `XAUTOCLAIM` recovery)
- **Exponential backoff with jitter** — failed deliveries retry with increasing delays, randomized to avoid thundering-herd retries
- **Per-subscriber circuit breaker** (Redis-backed, CLOSED/OPEN/HALF_OPEN) — stops attempting delivery to a subscriber that's clearly down, and automatically tests recovery
- **Per-subscriber token-bucket rate limiter** (Redis-backed) — paces delivery to respect each subscriber's stated capacity
- **HMAC-SHA256 payload signing** — subscribers can verify a webhook genuinely came from this platform and wasn't tampered with
- **Idempotency keys** — a stable `X-Event-Id` header lets subscribers safely detect and ignore duplicate deliveries
- **MongoDB compound unique index** — prevents duplicate delivery-job records if an event is reprocessed after a crash
- **Dead-lettering** — after 8 failed attempts, a job stops retrying permanently
- **Live metrics** — p50/p95/p99 delivery latency, computed from real delivery data
- **React dashboard** — register subscriptions, fire test events, watch live delivery status and retry countdowns
- **Load tested with k6** — ~190 req/sec sustained, 0 failures, p95 latency under 6ms end-to-end

## Architecture

| Process | Responsibility |
|---|---|
| `src/app.js` | Express API — subscriptions, event ingestion, delivery history, metrics |
| `src/workers/fanoutWorker.js` | Reads new events, finds matching subscribers, creates delivery jobs |
| `src/workers/deliveryWorker.js` | Reads delivery jobs, checks circuit breaker/rate limit, signs and sends the HTTP request |
| `src/workers/retryScheduler.js` | Polls for due retries and re-queues them |
| `fake-subscriber-server.js` | A simulated subscriber endpoint (with a toggle to simulate downtime) for local testing/demo |
| `client/` | React dashboard for the demo |

Full write-up of every component, the design decisions behind them, and the event lifecycle trace is in [`ARCHITECTURE.md`](./ARCHITECTURE.md) *(optional — link only if you add one)*.

## Tech stack

Node.js · Express · Redis (Streams, ioredis) · MongoDB (Mongoose) · React (Vite) · k6

## Running it locally

Requires Node.js, a running Redis instance, and a MongoDB connection string.

1. Clone the repo and install dependencies:
   ```bash
   npm install
   cd client && npm install && cd ..
   ```
2. Create a `.env` file in the project root:
   ```
   REDIS_URL=redis://localhost:6380
   MONGO_URI=<your MongoDB connection string>
   PORT=3000
   ```
3. Start Redis (Docker example):
   ```bash
   docker run -d --name webhook-redis -p 6380:6379 redis:7-alpine
   ```
4. Start each process in its own terminal, in this order:
   ```bash
   node fake-subscriber-server.js
   node src/app.js
   node src/workers/fanoutWorker.js
   node src/workers/deliveryWorker.js
   node src/workers/retryScheduler.js
   cd client && npm run dev
   ```
5. Open the dashboard (the URL Vite prints, typically `http://localhost:5173`), register a subscription pointing at the fake subscriber (`http://localhost:4000/webhook`), and fire a test event.

## Demoing the reliability features

1. Fire a healthy event — watch it appear as `delivered` in the live table.
2. Toggle the fake subscriber to fail: `POST http://localhost:4000/toggle-failure`.
3. Fire a few more events — watch delivery attempts fail, and after 5 failures, watch the circuit breaker trip (`Circuit Open, Skipping..`) so it stops wasting requests on a subscriber it knows is down.
4. Toggle the subscriber back to healthy, and watch the retry scheduler re-queue the failed jobs and the delivery worker successfully deliver them — rows flip from `failed`/`pending` to `delivered` automatically.

## Load testing

```bash
k6 run loadtest/ingest.k6.js
```

Results from a 20-VU, 15-second run against the ingestion endpoint: **~192 req/sec**, **0 failures**, **p95 latency 5.49ms** — with every request exercising the full async pipeline down to a real MongoDB Atlas write.

## Known limitations

- The delivery worker and retry scheduler both follow a read-modify-write pattern on `DeliveryJob` documents rather than atomic updates, which can produce a race condition under specific overlapping timing. The correct fix (not yet implemented) is a conditional `findOneAndUpdate`.
- The retry scheduler is written for a single instance; running multiple instances would need the same fix above to be safe.
- This guarantees **at-least-once** delivery, not exactly-once — subscribers are expected to use the idempotency key to dedupe, same as real webhook providers like Stripe and GitHub.

## Author

Singeetham Madhukar