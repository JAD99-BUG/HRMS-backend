console.log('🚀 HRMS Backend LOADED at', new Date().toISOString());
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const VERSION = '1.0.3';



app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const employeeRoutes = require('./routes/employees');
const departmentRoutes = require('./routes/departments');
const attendanceRoutes = require('./routes/attendance');
const payrollRoutes = require('./routes/payroll');
const leaveRoutes = require('./routes/leave');
const userRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const reportsRoutes = require('./routes/reports');
const positionsRoutes = require('./routes/positions');

// ... routes

app.get('/', (req, res) => {
  res.send(`HRMS Backend API v${VERSION} is running. Access endpoints at /api`);
});


app.get('/api', (req, res) => {
  res.json({
    message: 'HRMS API Root',
    endpoints: [
      '/api/auth/login',
      '/api/health',
      '/api/employees',
      '/api/departments',
      '/api/attendance',
      '/api/payroll',
      '/api/leave',
      '/api/users',
      '/api/dashboard',
      '/api/reports',
      '/api/positions'
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date() });
});


app.use('/api/employees', employeeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/positions', positionsRoutes);

const pool = require('./db/connection');

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`HRMS Backend API v${VERSION} starting...`);
  console.log(`Server running on port ${PORT}`);
  console.log('Testing database connection...');

  try {
    const res = await pool.query('SELECT NOW()');

    console.log('✅ Database connected successfully at:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
});


