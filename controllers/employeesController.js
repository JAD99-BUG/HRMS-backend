const pool = require('../db/connection');

const getAllEmployees = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, 
        ea.assignment_id, ea.department_id, ea.position_id, ea.start_salary, ea.reference_salary,
        d.name as department_name,
        p.title as position_title
      FROM employee e
      LEFT JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
      LEFT JOIN department d ON ea.department_id = d.department_id
      LEFT JOIN "position" p ON ea.position_id = p.position_id
      ORDER BY e.last_name, e.first_name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT e.*, 
        ea.assignment_id, ea.department_id, ea.position_id, ea.start_salary, ea.reference_salary,
        d.name as department_name,
        p.title as position_title
      FROM employee e
      LEFT JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
      LEFT JOIN department d ON ea.department_id = d.department_id
      LEFT JOIN "position" p ON ea.position_id = p.position_id
      WHERE e.employee_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createEmployee = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      first_name, last_name, phone, email, hire_date, status, address,
      nationality, blood_type, nssf_number, department_id, position_id, start_salary
    } = req.body;

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO employee (first_name, last_name, phone, email, hire_date, status, address, nationality, blood_type, nssf_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING employee_id`,
      [first_name, last_name, phone, email, hire_date, status || 'ACTIVE', address, nationality, blood_type, nssf_number]
    );

    const employeeId = result.rows[0].employee_id;

    if (department_id && position_id) {
      await client.query(
        `INSERT INTO employment_assignment (employee_id, department_id, position_id, start_date, start_salary, reference_salary, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [employeeId, department_id, position_id, hire_date, start_salary || 0, start_salary || 0, 'ACTIVE']
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ employee_id: employeeId, message: 'Employee created successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

const updateEmployee = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      first_name, last_name, phone, email, hire_date, status, address,
      nationality, blood_type, nssf_number, department_id, position_id, start_salary
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !phone || !email || !hire_date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update employee table
    await client.query(
      `UPDATE employee 
       SET first_name = $1, last_name = $2, phone = $3, email = $4, hire_date = $5, 
           status = $6, address = $7, nationality = $8, blood_type = $9, nssf_number = $10
       WHERE employee_id = $11`,
      [
        first_name,
        last_name,
        phone,
        email,
        hire_date,
        status || 'ACTIVE',
        address || null,
        nationality || null,
        blood_type || null,
        nssf_number || null,
        parseInt(id)
      ]
    );

    // Handle employment assignment
    if (department_id && position_id) {
      const deptId = parseInt(department_id);
      const posId = parseInt(position_id);
      const salary = parseFloat(start_salary) || 0;

      const existing = await client.query(
        `SELECT assignment_id FROM employment_assignment WHERE employee_id = $1 AND status = 'ACTIVE'`,
        [parseInt(id)]
      );

      if (existing.rows.length > 0) {
        // Update existing assignment
        await client.query(
          `UPDATE employment_assignment 
           SET department_id = $1, position_id = $2, start_salary = $3, reference_salary = $4
           WHERE assignment_id = $5`,
          [deptId, posId, salary, salary, existing.rows[0].assignment_id]
        );
      } else {
        // Create new assignment
        await client.query(
          `INSERT INTO employment_assignment (employee_id, department_id, position_id, start_date, start_salary, reference_salary, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            parseInt(id),
            deptId,
            posId,
            hire_date,
            salary,
            salary,
            'ACTIVE'
          ]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Employee updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating employee:', error);
    res.status(500).json({ error: error.message || 'Failed to update employee' });
  } finally {
    client.release();
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE employee SET status = $1 WHERE employee_id = $2', ['TERMINATED', id]);
    res.json({ message: 'Employee terminated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee
};
