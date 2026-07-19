// test-ratelimit.js
require('dotenv').config();
const Redis = require('ioredis');
const { tryConsumeToken } = require('./src/utils/rateLimiter');

const redis = new Redis(process.env.REDIS_URL);

async function test() {
  for (let i = 1; i <= 15; i++) {
    const allowed = await tryConsumeToken(redis, 'techmart', 10, 5);
    console.log(`Request ${i}: ${allowed ? 'ALLOWED' : 'REJECTED'}`);
  }
  process.exit();
}

test();