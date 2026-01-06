const pool = require('../db/connection');

const getDashboardStats = async (req, res) => {
  try {
    const activeEmployeesResult = await pool.query(
      "SELECT COUNT(*) as count FROM employee WHERE status = 'ACTIVE'"
    );
    const totalDeptsResult = await pool.query('SELECT COUNT(*) as count FROM department');
    const activeLeaveResult = await pool.query(
      "SELECT COUNT(*) as count FROM leave_request WHERE status = 'PENDING'"
    );
    const payrollDataResult = await pool.query(`
      SELECT SUM(pe.net_salary) as total
      FROM payroll_entry pe
      INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
      WHERE pr.status = 'APPROVED' 
        AND EXTRACT(MONTH FROM pr.period_start) = EXTRACT(MONTH FROM CURRENT_DATE) 
        AND EXTRACT(YEAR FROM pr.period_start) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);

    // Get payroll totals for the last 6 months
    const payrollTrendsResult = await pool.query(`
      SELECT 
        EXTRACT(YEAR FROM pr.period_start) as year,
        EXTRACT(MONTH FROM pr.period_start) as month,
        SUM(pe.net_salary) as total
      FROM payroll_entry pe
      INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
      WHERE pr.status = 'APPROVED' 
        AND pr.period_start >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY EXTRACT(YEAR FROM pr.period_start), EXTRACT(MONTH FROM pr.period_start)
      ORDER BY year ASC, month ASC
    `);

    res.json({
      activeEmployees: activeEmployeesResult.rows[0].count,
      totalDepts: totalDeptsResult.rows[0].count,
      activeLeaveCount: activeLeaveResult.rows[0].count,
      totalPayroll: payrollDataResult.rows[0].total || 0,
      payrollTrends: payrollTrendsResult.rows || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDepartmentStats = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.name, COUNT(DISTINCT e.employee_id) as staff
      FROM department d
      LEFT JOIN employment_assignment ea ON d.department_id = ea.department_id AND ea.status = 'ACTIVE'
      LEFT JOIN employee e ON ea.employee_id = e.employee_id AND e.status = 'ACTIVE'
      GROUP BY d.department_id, d.name
      ORDER BY d.name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getDepartmentStats
};
