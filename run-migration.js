const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: 'metro.proxy.rlwy.net',
    user: 'postgres',
    password: 'XPiLcdTZqGbYgjhbRpINjmFHJQiqXQNt',
    database: 'railway',
    port: 31003,
});

async function runMigration() {
    const client = await pool.connect();
    try {
        const sqlFilePath = path.join(__dirname, 'db', 'migrations', '001_create_schema.sql');
        const sql = fs.readFileSync(sqlFilePath, 'utf8');

        console.log('Running database migration...');
        await client.query(sql);
        console.log('✅ Database schema created successfully!');
        console.log('✅ Default admin user created: username=admin, password=admin123');
    } catch (error) {
        console.error('❌ Error running migration:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration()
    .then(() => {
        console.log('Migration complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
