const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

process.env.NODE_ENV = 'test';

const testEnvPath = path.join(__dirname, '..', '.env.test');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath });
} else {
  dotenv.config(); // falls back to .env — fine for local dev, CI should provide .env.test
}
