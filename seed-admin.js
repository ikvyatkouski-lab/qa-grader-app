require('dotenv').config();
const pg = require('pg');
const bcrypt = require('bcrypt');

const { Pool } = pg;

(async () => {
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const passwordHash = await bcrypt.hash('Qwerty1234!', 12);

    await pool.query(
      `INSERT INTO users (email, username, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      ['igar.k@wonderly.com', 'igar.k@wonderly.com', passwordHash]
    );

    console.log('Admin seeded successfully');
    await pool.end();
  } catch (error) {
    console.error('Seed failed:', error);
  }
})();