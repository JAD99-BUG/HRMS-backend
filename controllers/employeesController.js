const pool = require('../db/connection');

const getAllEmployees = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT e.*, 
        ea.assignment_id, ea.department_id, ea.position_id, ea.start_salary, ea.reference_salary,
        d.name as department_name,
        p.title as position_title
      FROM employee e
      LEFT JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
      LEFT JOIN department d ON ea.department_id = d.department_id
      LEFT JOIN position p ON ea.position_id = p.position_id
      ORDER BY e.last_name, e.first_name
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT e.*, 
        ea.assignment_id, ea.department_id, ea.position_id, ea.start_salary, ea.reference_salary,
        d.name as department_name,
        p.title as position_title
      FROM employee e
      LEFT JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
      LEFT JOIN department d ON ea.department_id = d.department_id
      LEFT JOIN position p ON ea.position_id = p.position_id
      WHERE e.employee_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createEmployee = async (req, res) => {
  try {
    const {
      first_name, last_name, phone, email, hire_date, status, address,
      nationality, blood_type, nssf_number, department_id, position_id, start_salary
    } = req.body;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.execute(
        `INSERT INTO employee (first_name, last_name, phone, email, hire_date, status, address, nationality, blood_type, nssf_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [first_name, last_name, phone, email, hire_date, status || 'ACTIVE', address, nationality, blood_type, nssf_number]
      );

      const employeeId = result.insertId;

      if (department_id && position_id) {
        await connection.execute(
          `INSERT INTO employment_assignment (employee_id, department_id, position_id, start_date, start_salary, reference_salary, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [employeeId, department_id, position_id, hire_date, start_salary || 0, start_salary || 0, 'ACTIVE']
        );
      }

      await connection.commit();
      res.status(201).json({ employee_id: employeeId, message: 'Employee created successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateEmployee = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const {
      first_name, last_name, phone, email, hire_date, status, address,
      nationality, blood_type, nssf_number, department_id, position_id, start_salary
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !phone || !email || !hire_date) {
      await connection.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update employee table - 11 parameters: 10 SET + 1 WHERE
    await connection.execute(
      `UPDATE employee 
       SET first_name = ?, last_name = ?, phone = ?, email = ?, hire_date = ?, 
           status = ?, address = ?, nationality = ?, blood_type = ?, nssf_number = ?
       WHERE employee_id = ?`,
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
      
      const [existing] = await connection.execute(
        `SELECT assignment_id FROM employment_assignment WHERE employee_id = ? AND status = 'ACTIVE'`,
        [parseInt(id)]
      );

      if (existing.length > 0) {
        // Update existing assignment - 5 parameters: 4 SET + 1 WHERE
        await connection.execute(
          `UPDATE employment_assignment 
           SET department_id = ?, position_id = ?, start_salary = ?, reference_salary = ?
           WHERE assignment_id = ?`,
          [deptId, posId, salary, salary, existing[0].assignment_id]
        );
      } else {
        // Create new assignment - 7 parameters
        await connection.execute(
          `INSERT INTO employment_assignment (employee_id, department_id, position_id, start_date, start_salary, reference_salary, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

    await connection.commit();
    res.json({ message: 'Employee updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating employee:', error);
    res.status(500).json({ error: error.message || 'Failed to update employee' });
  } finally {
    connection.release();
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('UPDATE employee SET status = ? WHERE employee_id = ?', ['TERMINATED', id]);
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
