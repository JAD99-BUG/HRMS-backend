const pool = require('../db/connection');

const getAttendanceReport = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ar.employee_id,
        CONCAT(e.first_name, ' ', e.last_name) as name,
        ar.attendance_date as date,
        ar.mark as status,
        EXTRACT(EPOCH FROM (ar.check_out - ar.check_in))/3600 as hours,
        EXTRACT(YEAR FROM ar.attendance_date) as year,
        EXTRACT(MONTH FROM ar.attendance_date) as month,
        EXTRACT(DAY FROM ar.attendance_date) as day
      FROM attendance_record ar
      INNER JOIN employee e ON ar.employee_id = e.employee_id
      ORDER BY ar.attendance_date DESC, e.last_name, e.first_name
    `);

    // Get total number of active employees
    const totalEmployeesResult = await pool.query(
      "SELECT COUNT(*) as count FROM employee WHERE status = 'ACTIVE'"
    );

    res.json({
      attendanceData: result.rows,
      totalEmployees: totalEmployeesResult.rows[0].count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getPayrollReport = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        CONCAT(e.first_name, ' ', e.last_name) as name,
        pr.pay_date as payment_date,
        pe.net_salary as net_paid
      FROM payroll_entry pe
      INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
      INNER JOIN employment_assignment ea ON pe.assignment_id = ea.assignment_id
      INNER JOIN employee e ON ea.employee_id = e.employee_id
      WHERE pr.status = 'APPROVED'
      ORDER BY pr.pay_date DESC, e.last_name, e.first_name
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDepartmentReport = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.name,
        COUNT(DISTINCT e.employee_id) as staff_count,
        d.budget
      FROM department d
      LEFT JOIN employment_assignment ea ON d.department_id = ea.department_id AND ea.status = 'ACTIVE'
      LEFT JOIN employee e ON ea.employee_id = e.employee_id AND e.status = 'ACTIVE'
      GROUP BY d.department_id, d.name, d.budget
      ORDER BY d.name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAttendanceReport,
  getPayrollReport,
  getDepartmentReport
};
