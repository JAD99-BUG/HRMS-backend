const pool = require('../db/connection');

const getDashboardStats = async (req, res) => {
  try {
    const [activeEmployees] = await pool.execute(
      "SELECT COUNT(*) as count FROM employee WHERE status = 'ACTIVE'"
    );
    const [totalDepts] = await pool.execute('SELECT COUNT(*) as count FROM department');
    const [activeLeave] = await pool.execute(
      "SELECT COUNT(*) as count FROM leave_request WHERE status = 'PENDING'"
    );
    const [payrollData] = await pool.execute(`
      SELECT SUM(pe.net_salary) as total
      FROM payroll_entry pe
      INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
      WHERE pr.status = 'APPROVED' AND MONTH(pr.period_start) = MONTH(CURDATE()) AND YEAR(pr.period_start) = YEAR(CURDATE())
    `);

    // Get payroll totals for the last 6 months
    const [payrollTrends] = await pool.execute(`
      SELECT 
        YEAR(pr.period_start) as year,
        MONTH(pr.period_start) as month,
        SUM(pe.net_salary) as total
      FROM payroll_entry pe
      INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
      WHERE pr.status = 'APPROVED' 
        AND pr.period_start >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY YEAR(pr.period_start), MONTH(pr.period_start)
      ORDER BY YEAR(pr.period_start) ASC, MONTH(pr.period_start) ASC
    `);

    res.json({
      activeEmployees: activeEmployees[0].count,
      totalDepts: totalDepts[0].count,
      activeLeaveCount: activeLeave[0].count,
      totalPayroll: payrollData[0].total || 0,
      payrollTrends: payrollTrends || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDepartmentStats = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT d.name, COUNT(DISTINCT e.employee_id) as staff
      FROM department d
      LEFT JOIN employment_assignment ea ON d.department_id = ea.department_id AND ea.status = 'ACTIVE'
      LEFT JOIN employee e ON ea.employee_id = e.employee_id AND e.status = 'ACTIVE'
      GROUP BY d.department_id, d.name
      ORDER BY d.name
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getDepartmentStats
};





