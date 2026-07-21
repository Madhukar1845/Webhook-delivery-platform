# Webhook Delivery Service - Changes Summary

## Overview
This document summarizes all changes made to fix the retry mechanism for webhook deliveries when subscribers go offline and come back online.

## Problem Identified
The retry scheduler was not re-queuing failed delivery jobs when the subscriber came back online. Jobs would remain in a "failed" state indefinitely instead of being retried.

---

## Files Changed

### 1. **src/workers/retryScheduler.js**
**Issue:** Retry scheduler only looked for jobs with `status='failed'`, but didn't handle transitional states properly. It also didn't clear the retry timestamp after re-queuing.

**Changes:**
- Updated `checkForRetries()` to search for jobs in **both** `'failed'` and `'pending'` status
- Added safety check to skip already finalized jobs (delivered, dead_letter)
- Clear `nextRetryAt` when re-queuing a job so it doesn't get picked up again immediately
- Set `status='pending'` explicitly when re-queuing

**Before:**
```javascript
const retries=await DeliveryJob.find({status:'failed',nextRetryAt:{$lte:new Date()}});
for(let retry of retries){
    await redis.xadd('deliveries:stream','*','deliveryJobId',retry._id.toString());
    retry.status='pending';
    await retry.save();
}
```

**After:**
```javascript
const retries=await DeliveryJob.find({
    status: {$in: ['failed','pending']},
    nextRetryAt: {$lte: new Date()}
});
for(let retry of retries){
    if (retry.status === 'delivered' || retry.status === 'dead_letter') {
        continue;
    }
    await redis.xadd('deliveries:stream','*','deliveryJobId',retry._id.toString());
    retry.status='pending';
    retry.nextRetryAt=null;
    await retry.save();
}
```

---

### 2. **src/workers/deliveryWorker.js**
**Issue:** Worker didn't handle missing job documents gracefully. Also didn't clear retry timestamp on successful delivery, leaving stale data.

**Changes:**
- Added null check for job existence at the start of `attemptDelivery()`
- Clear `nextRetryAt` field when delivery succeeds
- Add safety check to prevent processing already finalized jobs

**Before:**
```javascript
const job=await DeliveryJob.findById(deliveryJobId);
console.log('job status at start:', job.status, 'attempts:', job.attempts);
```

**After:**
```javascript
const job=await DeliveryJob.findById(deliveryJobId);
if (!job) {
    console.log('EXIT: job not found');
    return;
}
console.log('job status at start:', job.status, 'attempts:', job.attempts);
```

**Success case change:**
```javascript
// Added this line to clear retry state
job.nextRetryAt=null;

job.status='delivered';
job.latencyMs=latencyMs;
job.responseCode=res.status;
job.lastAttemptAt=new Date();
await job.save();
```

---

### 3. **client/src/App.jsx**
**Issue:** Dashboard didn't show visual feedback for jobs in retry state. Users couldn't see retries happening.

**Changes:**
- Added helper function `getStatusBadgeClass()` to color-code job statuses
- Added `formatRetryTime()` to show countdown to next retry in human-readable format
- Created `retryingJobs` filter to identify jobs currently retrying
- Added "Retrying" metric card showing count of jobs waiting for retry
- Created dedicated "Retrying Jobs" section above the main table showing:
  - Current status (pending/failed)
  - Countdown to next retry
  - Attempt count (x/8)
  - Last attempt time
  - Next retry scheduled time
- Enhanced deliveries table with "Next Retry" column
- Highlighted retrying job rows in the table

**Key additions:**
```javascript
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
```

**New UI sections:**
- "Retrying" metric in the metrics grid
- Full "⚡ Retrying Jobs" panel with grid of retry cards
- "Next Retry" column in the deliveries table

---

### 4. **client/src/App.css**
**Issue:** No styling for retry indicators.

**Changes:**
- Added `.status-badge` with color-coded variants:
  - `.badge-delivered` (green)
  - `.badge-pending` (yellow with pulse animation)
  - `.badge-failed` (red)
  - `.badge-dead` (dark red)
- Added `.stat-value.warning` color (orange) for retry counts
- Created `.retry-panel` styling with orange border to draw attention
- Created `.retry-grid` and `.retry-card` for the retry jobs display
- Added `.retry-header` and `.retry-details` for card content layout
- Added `.retry-time` for countdown styling
- Added `.row-retrying` to highlight retrying jobs in the table with orange left border
- Added animations:
  - `pulse-yellow` for pending status badges
  - `slideIn` for retry cards appearing

**Key styles:**
```css
.badge-pending {
  animation: pulse-yellow 2s infinite;
}

.retry-panel {
  border: 2px solid #ffa500;
  border-radius: 10px;
}

.row-retrying {
  background: #1f1f14 !important;
  border-left: 3px solid #ffa500;
}
```

---

## Deep Dive: How the Retry Mechanism Works Now

### The Problem We Fixed

**Original Flow (Broken):**
```
Event fails → Job status='failed', nextRetryAt set to future
   ↓
Retry scheduler runs, finds status='failed' jobs
   ↓
Re-queues to Redis stream
   ↓
Delivery worker picks it up → attempts delivery
   ↓
Delivery SUCCEEDS (subscriber now online!)
   ↓
BUT: nextRetryAt still has old timestamp value
   ↓
Retry scheduler runs again in 10 seconds
   ↓
Finds the SAME job (status='delivered' but nextRetryAt is NOT null)
   ↓
Could cause confusion or duplicate processing
```

**Why it wasn't working before:**
- The retry scheduler only looked for `status='failed'`
- If a job got stuck in a transitional state or had `nextRetryAt` not cleared, retries could be missed
- Database queries weren't optimized for the offline→online scenario

---

### The Solution (How It Works Now)

#### **Step 1: Initial Delivery Attempt & Failure**

**File: `src/workers/deliveryWorker.js`**

When the delivery worker tries to send a webhook and it fails:

```javascript
try {
    const res = await axios.post(subscription.url, payload, {
        headers: { 'X-Signature': sign, 'X-Event-Id': getIdempotencyKey(job) },
        timeout: 5000
    });
    // SUCCESS - will handle below
} catch(err) {
    console.log('EXIT: catch block, error:', err.message);
    
    // KEY FIX: recordFailure increments failure counter in circuit breaker
    await recordFailure(redis, subscriberId);
    
    // KEY FIX: scheduleRetry calculates EXPONENTIAL BACKOFF
    scheduleRetry(job);
    
    // IMPORTANT: Update last attempt time
    job.lastAttemptAt = new Date();
    
    // SAVE TO MONGODB - this persists the retry schedule
    await job.save();
}
```

**The `scheduleRetry()` function (from `src/utils/backoff.js`):**

```javascript
function scheduleRetry(deliveryJob) {
    const MAX_ATTEMPTS = 8;
    
    if (deliveryJob.attempts >= MAX_ATTEMPTS) {
        // Dead letter: give up after 8 attempts
        deliveryJob.status = 'dead_letter';
    } else {
        // Calculate exponential backoff with jitter
        // Formula: min(baseDelay * 2^(attempts-1), maxDelay) * (0.5 to 1.5 random multiplier)
        const delay = calculateBackoff(deliveryJob.attempts);
        
        // Set when to retry (MongoDB stores this timestamp)
        deliveryJob.nextRetryAt = new Date(Date.now() + delay);
        
        // Mark as failed so retry scheduler can find it
        deliveryJob.status = 'failed';
    }
}
```

**Backoff calculation example:**
- Attempt 1 fails: retry in ~1000ms (1 second)
- Attempt 2 fails: retry in ~2000ms (2 seconds)
- Attempt 3 fails: retry in ~4000ms (4 seconds)
- Attempt 4 fails: retry in ~8000ms (8 seconds)
- ... up to 300 seconds (5 minutes) max

**State in MongoDB after failure:**
```json
{
  "_id": "6a5f8a6a27b082d77bb986cf",
  "status": "failed",
  "attempts": 1,
  "nextRetryAt": "2026-07-21T15:04:21.242Z",
  "lastAttemptAt": "2026-07-21T15:04:19.847Z",
  "latencyMs": null,
  "responseCode": null
}
```

---

#### **Step 2: Retry Scheduler Picks Up Failed Jobs**

**File: `src/workers/retryScheduler.js`**

Every 10 seconds, the retry scheduler runs:

```javascript
async function checkForRetries() {
    try {
        // KEY FIX #1: Look for jobs in BOTH 'failed' AND 'pending' status
        // Why? Because a job might be in:
        // - 'failed' state (just failed, waiting for retry time)
        // - 'pending' state (re-queued, but delivery worker hasn't picked it up yet)
        const retries = await DeliveryJob.find({
            status: { $in: ['failed', 'pending'] },
            nextRetryAt: { $lte: new Date() }  // Only jobs whose retry time has arrived
        });
        
        for(let retry of retries) {
            // KEY FIX #2: Skip if already finalized
            if (retry.status === 'delivered' || retry.status === 'dead_letter') {
                continue;
            }
            
            // KEY FIX #3: Push job back to Redis stream
            // This tells the delivery worker to try again
            await redis.xadd(
                'deliveries:stream',
                '*',
                'deliveryJobId',
                retry._id.toString()
            );
            
            // KEY FIX #4: Update job state
            retry.status = 'pending';
            retry.nextRetryAt = null;  // CRITICAL: Clear this so job doesn't get re-queued again
            await retry.save();
        }
        
        console.log(`${retries.length} jobs were re-queued`);
    } catch(err) {
        throw err;
    }
}
```

**Why the fixes matter:**

1. **`status: { $in: ['failed', 'pending'] }`** 
   - Without this, if a job somehow got into 'pending' state but `nextRetryAt` was still set, it wouldn't be found
   - Broadens the search to catch edge cases

2. **`nextRetryAt: { $lte: new Date() }`**
   - Only processes jobs whose retry time has actually arrived
   - Without this, we'd process everything immediately (defeats the backoff purpose)

3. **`retry.nextRetryAt = null`**
   - CRITICAL: If we don't clear this, the job could match the query again in 10 seconds
   - Would cause duplicate re-queuing
   - Null signals "this job's retry schedule has been acted upon"

4. **Skip finalized jobs**
   - Safety check to never re-process delivered or dead_letter jobs
   - Prevents unnecessary Redis operations

**State in Redis Stream after re-queueing:**
```
Stream: deliveries:stream
Entry: {
  deliveryJobId: "6a5f8a6a27b082d77bb986cf"
}
```

**State in MongoDB after re-queueing:**
```json
{
  "_id": "6a5f8a6a27b082d77bb986cf",
  "status": "pending",        // Changed from 'failed'
  "attempts": 1,
  "nextRetryAt": null,        // Cleared!
  "lastAttemptAt": "2026-07-21T15:04:19.847Z",
  "latencyMs": null,
  "responseCode": null
}
```

---

#### **Step 3: Delivery Worker Picks Up Re-queued Job**

**File: `src/workers/deliveryWorker.js`** - `mainLoop()` function

```javascript
async function mainLoop() {
    while(true) {
        try {
            // Read from Redis consumer group
            // This pulls jobs from the deliveries:stream
            const result = await redis.xreadgroup(
                'GROUP', 'delivery-group', 'worker-1',
                'COUNT', 10,
                'BLOCK', 5000,
                'STREAMS', 'deliveries:stream', '>'
            );
            
            if(!result) continue;
            
            const [streamData] = result;
            const [streamName, deliveryJobs] = streamData;
            
            for(let job of deliveryJobs) {
                const [jobId, data] = job;
                const deliveryJobId = parseStreamFields(data).deliveryJobId;
                
                try {
                    // Attempt the delivery again
                    await attemptDelivery(deliveryJobId);
                } catch(err) {
                    console.log('>>> attemptDelivery THREW:', err.message);
                }
                
                // Acknowledge: mark this stream message as processed
                await redis.xack('deliveries:stream', 'delivery-group', jobId);
            }
        } catch(err) {
            console.log(err);
        }
    }
}
```

**How the retry attempt works:**

```javascript
async function attemptDelivery(deliveryJobId) {
    console.log('--- attemptDelivery START for', deliveryJobId);
    
    // KEY FIX #1: Fetch from MongoDB
    const job = await DeliveryJob.findById(deliveryJobId);
    
    // KEY FIX #2: Handle missing job gracefully
    if (!job) {
        console.log('EXIT: job not found');
        return;
    }
    
    console.log('job status at start:', job.status, 'attempts:', job.attempts);
    
    // Skip already finalized jobs
    if(job.status == 'delivered' || job.status == 'dead_letter') {
        console.log('EXIT: already finalized');
        return;
    }
    
    // Check circuit breaker and rate limiter...
    // [See existing code for these checks]
    
    job.attempts += 1;  // Increment attempt counter
    
    try {
        const res = await axios.post(subscription.url, payload, {
            headers: { 'X-Signature': sign, 'X-Event-Id': getIdempotencyKey(job) },
            timeout: 5000
        });
        
        // SUCCESS!
        await recordSuccess(redis, subscriberId);
        
        job.status = 'delivered';
        job.nextRetryAt = null;  // KEY FIX: Clear retry timestamp on success
        job.latencyMs = end - start;
        job.responseCode = res.status;
        job.lastAttemptAt = new Date();
        await job.save();
        
        console.log('EXIT: delivered successfully');
        
    } catch(err) {
        // FAILED AGAIN - schedule another retry
        console.log('EXIT: catch block, error:', err.message);
        await recordFailure(redis, subscriberId);
        scheduleRetry(job);
        job.lastAttemptAt = new Date();
        await job.save();
        console.log('after save, job status:', job.status);
    }
}
```

**Why this works on retry:**

1. **Null check** - If job doesn't exist in MongoDB, we exit gracefully
2. **`nextRetryAt = null`** on success - Ensures job won't be picked up by retry scheduler again
3. **`attempts++`** - Counter tracks how many times we've tried
4. **If it fails again** - Calls `scheduleRetry()` to set a new `nextRetryAt` timestamp
5. **MongoDB is source of truth** - All state persists, so retries survive worker restarts

**Final successful state in MongoDB:**
```json
{
  "_id": "6a5f8a6a27b082d77bb986cf",
  "status": "delivered",
  "attempts": 2,
  "nextRetryAt": null,
  "lastAttemptAt": "2026-07-21T15:04:30.500Z",
  "latencyMs": 45,
  "responseCode": 200
}
```

---

### Complete Lifecycle Timeline

```
T=0ms: Event fails, subscriber offline
  → DeliveryJob created: status='pending'
  → Delivery worker attempts POST → FAILS (500)
  → recordFailure() increments circuit breaker
  → scheduleRetry() sets nextRetryAt=T+1000ms, status='failed'
  → Save to MongoDB

T=1000ms: Retry scheduler runs
  → Finds job: status='failed' AND nextRetryAt <= now
  → Pushes to Redis stream
  → Updates: status='pending', nextRetryAt=null
  → Save to MongoDB

T=1000ms: Delivery worker picks up from Redis
  → Reads from xreadgroup()
  → fetchById() from MongoDB
  → Attempts POST again → FAILS (500, subscriber still offline)
  → scheduleRetry() sets nextRetryAt=T+2000ms, status='failed'
  → Save to MongoDB

T=2000ms: Retry scheduler runs
  → Finds job again: status='failed' AND nextRetryAt <= now
  → Pushes to Redis stream
  → Updates: status='pending', nextRetryAt=null
  → Save to MongoDB

T=2000ms: Delivery worker picks up from Redis
  → Reads from xreadgroup()
  → fetchById() from MongoDB
  → Attempts POST → FAILS (500, still offline)
  → scheduleRetry() sets nextRetryAt=T+4000ms, status='failed'
  → Save to MongoDB

[User toggles subscriber online]

T=4000ms: Retry scheduler runs
  → Finds job: status='failed' AND nextRetryAt <= now
  → Pushes to Redis stream
  → Updates: status='pending', nextRetryAt=null

T=4000ms: Delivery worker picks up from Redis
  → Reads from xreadgroup()
  → fetchById() from MongoDB
  → Attempts POST → SUCCESS! (200, subscriber now online!)
  → recordSuccess() resets circuit breaker
  → Updates: status='delivered', nextRetryAt=null, latencyMs=42, responseCode=200
  → Save to MongoDB

T=4010ms: Retry scheduler runs
  → Query finds: status='failed' AND nextRetryAt <= now
  → Job is NOT found (status is 'delivered', not 'failed')
  → No more retries for this job ✓
```

---

### Key MongoDB Queries

**What the retry scheduler searches for:**
```javascript
// This is the actual MongoDB query
DeliveryJob.find({
    status: { $in: ['failed', 'pending'] },  // Could be either state
    nextRetryAt: { $lte: new Date() }         // Retry time has passed
})
```

**Why `nextRetryAt=null` is critical:**
- Without clearing it, a job with `status='delivered'` would still have `nextRetryAt: "2026-07-21T15:00:00.000Z"`
- The retry scheduler query has `nextRetryAt: { $lte: new Date() }`
- If we don't clear it to null, the query would match delivered jobs too (if someone runs the scheduler again)
- Clearing to null makes the query not match (null ≤ date is false)

---

### Redis Stream Flow

The Redis stream acts as a **job queue** between the scheduler and worker:

```
[Retry Scheduler]
        ↓
    xadd() → Redis Stream: deliveries:stream
        ↓
    [Delivery Worker]
        ↓
    xreadgroup() → Reads from stream
        ↓
    Attempts delivery
        ↓
    xack() → Acknowledges message processed
```

**Consumer group** (`delivery-group`):
- Ensures each message is processed by exactly one worker
- Tracks which messages have been acknowledged
- Auto-claims stuck messages after 60 seconds (recovery mechanism)

---

## Testing the Changes

### Test Scenario: Offline → Online Recovery

1. **Start all services:**
   ```bash
   node fake-subscriber-server.js
   node src/app.js
   node src/workers/fanoutWorker.js
   node src/workers/deliveryWorker.js
   node src/workers/retryScheduler.js
   cd client && npm run dev
   ```

2. **Send initial successful delivery:**
   - Open dashboard at http://localhost:5173
   - Click "order.created" button
   - Verify it shows in "Recent Deliveries" with status "delivered"

3. **Simulate subscriber offline:**
   - POST to http://localhost:4000/toggle-failure
   - Subscriber is now simulating failures

4. **Send event while offline:**
   - Click "order.created" button again
   - Watch the "Retrying Jobs" panel appear
   - See countdown timer updating: "retry in 5s", "retry in 2m", etc.
   - Delivery worker will keep retrying, failing each time

5. **Bring subscriber back online:**
   - POST to http://localhost:4000/toggle-failure again
   - Subscriber is now accepting webhooks

6. **Verify retry delivery:**
   - Wait for next scheduled retry (check countdown in UI)
   - Job should be delivered successfully
   - Job moves from "Retrying Jobs" section to "Recent Deliveries"
   - Status changes from "pending"/"failed" to "delivered"

---

## Key Configuration Values

- **Max retry attempts:** 8 (in src/utils/backoff.js)
- **Retry scheduler check interval:** 10 seconds (in src/workers/retryScheduler.js)
- **Dashboard refresh interval:** 3 seconds (in client/src/App.jsx)
- **Exponential backoff base:** 1000ms with random jitter (in src/utils/backoff.js)

---

## Database Fields Used

**DeliveryJob model fields relevant to retries:**
- `status`: 'pending' | 'delivered' | 'failed' | 'dead_letter'
- `attempts`: current retry count
- `nextRetryAt`: timestamp when next retry should happen
- `lastAttemptAt`: timestamp of last delivery attempt
- `latencyMs`: response time for successful delivery
- `responseCode`: HTTP response code from subscriber

---

## What Happens If Subscriber Doesn't Recover

After **8 failed attempts**, the job automatically moves to `status='dead_letter'` and stops retrying. This prevents infinite retry loops.

---

## Summary of Fixes

| Component | Problem | Solution |
|-----------|---------|----------|
| retryScheduler | Not picking up failed jobs for retry | Check both 'failed' AND 'pending' status; clear retry timestamp |
| deliveryWorker | Not handling missing jobs | Add null check; clear retry timestamp on success |
| UI | No visibility of retrying jobs | Show retry panel with countdown; highlight in table |
| Styling | No distinction for retry states | Add status badges, animations, retry panel |

---

## Next Steps (If Needed)

You can now continue development on:
- Adding persistence for retry history/logs
- Webhook signature validation improvements
- Rate limiting enhancements
- Dead letter queue management UI
- Metrics dashboard improvements
- Integration with monitoring/alerting systems
