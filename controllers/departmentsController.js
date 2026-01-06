const pool = require('../db/connection');

const getAllDepartments = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, 
        COUNT(DISTINCT e.employee_id) as staff_count,
        CONCAT(mgr_e.first_name, ' ', mgr_e.last_name) as manager_name
      FROM department d
      LEFT JOIN employment_assignment ea ON d.department_id = ea.department_id AND ea.status = 'ACTIVE'
      LEFT JOIN employee e ON ea.employee_id = e.employee_id AND e.status = 'ACTIVE'
      LEFT JOIN employment_assignment mgr_ea ON d.manager_assignment_id = mgr_ea.assignment_id
      LEFT JOIN employee mgr_e ON mgr_ea.employee_id = mgr_e.employee_id
      GROUP BY d.department_id
      ORDER BY d.name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT d.*, 
        COUNT(DISTINCT e.employee_id) as staff_count,
        CONCAT(mgr_e.first_name, ' ', mgr_e.last_name) as manager_name
      FROM department d
      LEFT JOIN employment_assignment ea ON d.department_id = ea.department_id AND ea.status = 'ACTIVE'
      LEFT JOIN employee e ON ea.employee_id = e.employee_id AND e.status = 'ACTIVE'
      LEFT JOIN employment_assignment mgr_ea ON d.manager_assignment_id = mgr_ea.assignment_id
      LEFT JOIN employee mgr_e ON mgr_ea.employee_id = mgr_e.employee_id
      WHERE d.department_id = $1
      GROUP BY d.department_id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createDepartment = async (req, res) => {
  try {
    const { name, description, budget, manager_assignment_id } = req.body;
    const result = await pool.query(
      'INSERT INTO department (name, description, budget, manager_assignment_id) VALUES ($1, $2, $3, $4) RETURNING department_id',
      [name, description, budget || 0, manager_assignment_id || null]
    );
    res.status(201).json({ department_id: result.rows[0].department_id, message: 'Department created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, budget, manager_assignment_id } = req.body;
    await pool.query(
      'UPDATE department SET name = $1, description = $2, budget = $3, manager_assignment_id = $4 WHERE department_id = $5',
      [name, description, budget, manager_assignment_id || null, id]
    );
    res.json({ message: 'Department updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDepartmentEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const deptId = parseInt(id);

    const result = await pool.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.hire_date,
        p.title as position_title,
        d.name as department_name
      FROM employee e
      INNER JOIN employment_assignment ea ON e.employee_id = ea.employee_id
      LEFT JOIN "position" p ON ea.position_id = p.position_id
      LEFT JOIN department d ON ea.department_id = d.department_id
      WHERE ea.department_id = $1 AND ea.status = 'ACTIVE' AND e.status = 'ACTIVE'
      ORDER BY e.last_name, e.first_name`,
      [deptId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching department employees:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  getDepartmentEmployees
};
