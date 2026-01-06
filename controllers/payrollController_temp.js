const pool = require('../db/connection');

/**
 * Calculate hour variance from attendance records for a given employee, month, and year
 * Formula: (Total actual worked hours) - (Expected working hours for that month)
 * 
 * @param {number} employee_id - Employee ID
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<number>} Hour variance (actual hours - expected hours)
 */
const calculateHourVarianceFromAttendance = async (employee_id, month, year) => {
  try {
    // Get all attendance records for the employee in the specified month/year
    const [attendanceRecords] = await pool.query(
      `SELECT attendance_date, check_in, check_out, mark
       FROM attendance_record
       WHERE employee_id = ? AND MONTH(attendance_date) = ? AND YEAR(attendance_date) = ?
       ORDER BY attendance_date`,
      [employee_id, month, year]
    );

    // Calculate total actual worked hours
    // Only count PRESENT days with both check_in and check_out
    let totalActualHours = 0;
    
    for (const record of attendanceRecords) {
      // Skip OFF days, ABSENT days, and NO_SIGN_OUT (incomplete records)
      if (record.mark === 'OFF' || record.mark === 'ABSENT' || record.mark === 'NO_SIGN_OUT') {
        continue;
      }
      
      // Only count PRESENT days with both check_in and check_out
      if (record.mark === 'PRESENT' && record.check_in && record.check_out) {
        // Normalize time to HH:MM format
        const normalizeTime = (timeStr) => {
          if (!timeStr) return null;
          const str = String(timeStr).trim();
          
          // Handle ISO format
          const isoTimeMatch = str.match(/T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?/i);
          if (isoTimeMatch) {
            return `${isoTimeMatch[1]}:${isoTimeMatch[2]}`;
          }
          
          // If already in HH:MM format
          if (/^\d{2}:\d{2}$/.test(str)) {
            return str;
          }
          
          // If in HH:MM:SS format, extract HH:MM
          if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
            return str.substring(0, 5);
          }
          
          // Try to parse and format
          const parts = str.split(':');
          if (parts.length >= 2) {
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
          }
          
          return null;
        };
        
        const checkIn = normalizeTime(record.check_in);
        const checkOut = normalizeTime(record.check_out);
        
        if (checkIn && checkOut) {
          const [inHour, inMin] = checkIn.split(':').map(Number);
          const [outHour, outMin] = checkOut.split(':').map(Number);
          const inTime = inHour * 60 + inMin;
          const outTime = outHour * 60 + outMin;
          const workingHours = (outTime - inTime) / 60;
          
          // Only add positive working hours (handle edge cases where check_out < check_in)
          if (workingHours > 0) {
            totalActualHours += workingHours;
          }
        }
      }
    }
    
    // Calculate expected working hours for the month
    // Count working days (Monday-Friday) in the month
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    
    let workingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      // Count Monday (1) through Friday (5) as working days
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workingDays++;
      }
    }
    
    // Expected hours = working days * 8 hours per day
    const expectedHours = workingDays * 8;
    
    // Hour variance = actual hours - expected hours
    const hourVariance = totalActualHours - expectedHours;
    
    // Round to whole number (no decimals) as per existing code
    return Math.round(hourVariance);
  } catch (error) {
    console.error(`[CalculateHourVariance] Error calculating hour variance for employee ${employee_id}, month ${month}, year ${year}:`, error);
    // Return 0 on error to avoid breaking the payroll system
    return 0;
  }
};

const getPayrollEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM payroll_entry WHERE payroll_entry_id = ?',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Payroll entry not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createPayrollRun = async (req, res) => {
  try {
    const { period_start, period_end, pay_date, created_by_user_id, notes } = req.body;
    
    // Convert undefined values to null to avoid MySQL bind parameter errors
    const periodStart = period_start || null;
    const periodEnd = period_end || null;
    const payDate = pay_date || null;
    const createdByUserId = created_by_user_id || null;
    const notesValue = notes !== undefined ? notes : null;
    
    const insertResult = await pool.query(
      `INSERT INTO payroll_run (period_start, period_end, pay_date, created_by_user_id, notes, status)
       VALUES (?, ?, ?, ?, ?, 'DRAFT')`,
      [periodStart, periodEnd, payDate, createdByUserId, notesValue]
    );
    res.status(201).json({ payroll_run_id: result.insertId, message: 'Payroll run created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createPayrollEntry = async (req, res) => {
  try {
    const { payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks, bonuses, deductions } = req.body;

    const connection = await pool.connect();
    await client.query('BEGIN')();

    try {
      const [result] = await connection.query(
        `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks]
      );

      const entryId = result.insertId;

      if (bonuses && bonuses.length > 0) {
        for (const bonus of bonuses) {
          await connection.query(
            'INSERT INTO payroll_bonus (payroll_entry_id, bonus_type_id, amount, reason) VALUES (?, ?, ?, ?)',
            [entryId, bonus.bonus_type_id, bonus.amount, bonus.reason]
          );
        }
      }

      if (deductions && deductions.length > 0) {
        for (const deduction of deductions) {
          await connection.query(
            'INSERT INTO payroll_deduction (payroll_entry_id, deduction_type_id, amount, effective_date, reason) VALUES (?, ?, ?, ?, ?)',
            [entryId, deduction.deduction_type_id, deduction.amount, deduction.effective_date || new Date().toISOString().split('T')[0], deduction.reason]
          );
        }
      }

      await client.query('COMMIT')();
      res.status(201).json({ payroll_entry_id: entryId, message: 'Payroll entry created successfully' });
    } catch (error) {
      await client.query('ROLLBACK')();
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updatePayrollEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { gross_salary, bonus_amount, net_salary, remarks, bonuses, deductions, payroll_run_id } = req.body;

    const connection = await pool.connect();
    await client.query('BEGIN')();

    try {
      // Ensure payroll_entry is linked to a payroll_run
      // If payroll_run_id is provided, update it; otherwise keep existing link
      if (payroll_run_id) {
        await connection.query(
          'UPDATE payroll_entry SET payroll_run_id = ?, gross_salary = ?, bonus_amount = ?, net_salary = ?, remarks = ? WHERE payroll_entry_id = ?',
          [payroll_run_id, gross_salary, bonus_amount, net_salary, remarks, id]
        );
      } else {
        await connection.query(
          'UPDATE payroll_entry SET gross_salary = ?, bonus_amount = ?, net_salary = ?, remarks = ? WHERE payroll_entry_id = ?',
          [gross_salary, bonus_amount, net_salary, remarks, id]
        );
      }

      await connection.query('DELETE FROM payroll_bonus WHERE payroll_entry_id = ?', [id]);
      if (bonuses && bonuses.length > 0) {
        for (const bonus of bonuses) {
          await connection.query(
            'INSERT INTO payroll_bonus (payroll_entry_id, bonus_type_id, amount, reason) VALUES (?, ?, ?, ?)',
            [id, bonus.bonus_type_id, bonus.amount, bonus.reason]
          );
        }
      }

      await connection.query('DELETE FROM payroll_deduction WHERE payroll_entry_id = ?', [id]);
      if (deductions && deductions.length > 0) {
        for (const deduction of deductions) {
          await connection.query(
            'INSERT INTO payroll_deduction (payroll_entry_id, deduction_type_id, amount, effective_date, reason) VALUES (?, ?, ?, ?, ?)',
            [id, deduction.deduction_type_id, deduction.amount, deduction.effective_date || new Date().toISOString().split('T')[0], deduction.reason]
          );
        }
      }

      await client.query('COMMIT')();
      res.json({ message: 'Payroll entry updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK')();
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllPayrollRuns = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payroll_run ORDER BY period_start DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getEmployeesForPayroll = async (req, res) => {
  try {
    const { month, year } = req.query;

    console.log(`[GetEmployeesForPayroll] Fetching payroll data for month=${month}, year=${year}`);

      // Get only active employees with active employment assignments
      const result = await pool.query(`
        SELECT 
          e.employee_id,
          CONCAT(e.first_name, ' ', e.last_name) as employee_name,
          ea.assignment_id,
          ea.start_salary as gross_salary,
          0 as bonus_amount,
          d.name as department_name,
          p.title as position_title,
          e.hire_date,
          ea.start_date as assignment_start_date
        FROM employee e
        INNER JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
        LEFT JOIN department d ON ea.department_id = d.department_id
        LEFT JOIN position p ON ea.position_id = p.position_id
        WHERE e.status = 'ACTIVE'
        ORDER BY e.last_name, e.first_name
      `);

    console.log(`[GetEmployeesForPayroll] Found ${rows.length} active employees with active assignments`);

    // If month/year provided, try to get existing payroll entries
    let existingEntries = [];
    let mainPayrollRunStatus = 'DRAFT';
    let mainPayrollPayDate = null;
    let mainPayrollRunId = null;
    let individualRunsMap = {};

    if (month && year) {
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      const periodStart = new Date(yearNum, monthNum - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const periodEnd = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];

      // Get main payroll run
      const [payrollRuns] = await pool.query(
        `SELECT payroll_run_id, period_start, status FROM payroll_run 
         WHERE YEAR(period_start) = ? AND MONTH(period_start) = ? AND status != 'CANCELLED'
         AND (notes IS NULL OR notes NOT LIKE '%individual_employee:%')
         ORDER BY payroll_run_id DESC LIMIT 1`,
        [yearNum, monthNum]
      );

      if (payrollRuns.length > 0) {
        mainPayrollRunId = payrollRuns[0].payroll_run_id;
        const [runInfo] = await pool.query(
          `SELECT status, pay_date FROM payroll_run WHERE payroll_run_id = ?`,
          [mainPayrollRunId]
        );
        if (runInfo.length > 0) {
          mainPayrollRunStatus = runInfo[0]?.status ? (runInfo[0].status.toUpperCase().trim()) : 'DRAFT';
          mainPayrollPayDate = runInfo[0]?.pay_date || null;
        }

        // Get all payroll entries linked to payroll_run table to retrieve paid status
        // Fetch entries from BOTH main runs AND individual runs
        // Each payroll_entry MUST be linked to a payroll_run via payroll_run_id
        // Status is retrieved directly from payroll_run.status
        const [entries] = await pool.query(
          `SELECT pe.*, 
                  ea.employee_id, 
                  pr.status as run_status, 
                  pr.pay_date,
                  pr.payroll_run_id,
                  pr.period_start,
                  pr.period_end,
                  pr.notes
           FROM payroll_entry pe
           INNER JOIN employment_assignment ea ON pe.assignment_id = ea.assignment_id
           INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
           WHERE YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
           AND pe.payroll_run_id IS NOT NULL
           ORDER BY pr.payroll_run_id DESC`,
          [yearNum, monthNum]
        );

        console.log(`[GetEmployeesForPayroll] Found ${entries.length} payroll entries from database for month=${monthNum}, year=${yearNum}`);

        existingEntries = entries.map(e => ({
          ...e,
          payroll_run_id: e.payroll_run_id, // Each entry is linked to its payroll_run
          run_status: (e.run_status || mainPayrollRunStatus || 'DRAFT').toUpperCase().trim(), // Status from payroll_run table
          pay_date: e.pay_date || mainPayrollPayDate,
          is_main_run: !e.notes || !e.notes.includes('individual_employee:'),
          is_individual: e.notes && e.notes.includes('individual_employee:')
        }));
      }

      // Get individual payroll runs
      // Join with payroll_run to get status and pay_date directly from the table
      // Extract employee_id directly from notes using SUBSTRING_INDEX for reliability
      const [individualRuns] = await pool.query(
        `SELECT 
                pr.payroll_run_id, 
                pr.status, 
                pr.pay_date, 
                pr.notes, 
                pr.period_start,
                pe.payroll_entry_id, 
                pe.assignment_id, 
                pe.gross_salary, 
                pe.bonus_amount, 
                pe.net_salary, 
                pe.remarks,
                ea.employee_id as joined_employee_id,
                CAST(SUBSTRING_INDEX(pr.notes, ':', -1) AS UNSIGNED) as extracted_employee_id
         FROM payroll_run pr
         LEFT JOIN payroll_entry pe ON pr.payroll_run_id = pe.payroll_run_id
         LEFT JOIN employment_assignment ea ON pe.assignment_id = ea.assignment_id
         WHERE YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ? 
         AND pr.notes IS NOT NULL
         AND pr.notes LIKE 'individual_employee:%'
         ORDER BY pr.payroll_run_id DESC`,
        [yearNum, monthNum]
      );

      console.log(`[GetEmployeesForPayroll] Found ${individualRuns.length} individual payroll runs for month=${monthNum}, year=${yearNum}`);
      
      // Log raw query results for debugging
      if (individualRuns.length > 0) {
        console.log(`[GetEmployeesForPayroll] Raw individual runs query results:`, JSON.stringify(individualRuns.map(r => ({
          payroll_run_id: r.payroll_run_id,
          status: r.status,
          pay_date: r.pay_date,
          notes: r.notes,
          joined_employee_id: r.joined_employee_id,
          extracted_employee_id: r.extracted_employee_id,
          payroll_entry_id: r.payroll_entry_id
        })), null, 2));
      }
      
      individualRuns.forEach(run => {
        // Priority: extracted_employee_id (from SQL) > joined_employee_id > JavaScript extraction
        let employeeId = run.extracted_employee_id || run.joined_employee_id;
        if (!employeeId && run.notes) {
          const match = run.notes.match(/individual_employee:(\d+)/);
          if (match) {
            employeeId = parseInt(match[1]);
            console.log(`[GetEmployeesForPayroll] Extracted employee_id=${employeeId} from notes using regex: ${run.notes}`);
          }
        }
        
        if (employeeId) {
          if (!individualRunsMap[employeeId]) {
            const normalizedStatus = run.status ? (run.status.toUpperCase().trim()) : 'DRAFT';
            individualRunsMap[employeeId] = {
              payroll_run_id: run.payroll_run_id,
              status: normalizedStatus,
              pay_date: run.pay_date,
              payroll_entry_id: run.payroll_entry_id,
              gross_salary: run.gross_salary,
              bonus_amount: run.bonus_amount,
              net_salary: run.net_salary,
              remarks: run.remarks
            };
            console.log(`[GetEmployeesForPayroll] Mapped individual run for employee_id=${employeeId}, status=${normalizedStatus}, pay_date=${run.pay_date}`);
          } else {
            // If multiple runs exist, prefer the one with PAID status
            const existingStatus = individualRunsMap[employeeId].status;
            const newStatus = run.status ? (run.status.toUpperCase().trim()) : 'DRAFT';
            if (newStatus === 'PAID' && existingStatus !== 'PAID') {
              individualRunsMap[employeeId] = {
                payroll_run_id: run.payroll_run_id,
                status: newStatus,
                pay_date: run.pay_date,
                payroll_entry_id: run.payroll_entry_id,
                gross_salary: run.gross_salary,
                bonus_amount: run.bonus_amount,
                net_salary: run.net_salary,
                remarks: run.remarks
              };
              console.log(`[GetEmployeesForPayroll] Updated individual run for employee_id=${employeeId} to PAID status`);
            }
          }
        } else {
          console.warn(`[GetEmployeesForPayroll] Individual run ${run.payroll_run_id} has no employee_id (notes: ${run.notes})`);
        }
      });
      
      console.log(`[GetEmployeesForPayroll] Individual runs map contains ${Object.keys(individualRunsMap).length} employees`);
      if (Object.keys(individualRunsMap).length > 0) {
        console.log(`[GetEmployeesForPayroll] Individual runs map details:`, JSON.stringify(individualRunsMap, null, 2));
      }

      // Update existingEntries to use individual run data if available (individual runs take priority)
      existingEntries = existingEntries.map(entry => {
        const individualRun = individualRunsMap[entry.employee_id];
        if (individualRun) {
          console.log(`[GetEmployeesForPayroll] Updating existing entry for employee_id=${entry.employee_id} with individual run data`);
          return {
            ...entry,
            payroll_entry_id: individualRun.payroll_entry_id || entry.payroll_entry_id,
            gross_salary: individualRun.gross_salary !== null && individualRun.gross_salary !== undefined ? individualRun.gross_salary : entry.gross_salary,
            bonus_amount: individualRun.bonus_amount !== null && individualRun.bonus_amount !== undefined ? individualRun.bonus_amount : entry.bonus_amount,
            net_salary: individualRun.net_salary !== null && individualRun.net_salary !== undefined ? individualRun.net_salary : entry.net_salary,
            remarks: individualRun.remarks || entry.remarks,
            run_status: individualRun.status,
            pay_date: individualRun.pay_date,
            payroll_run_id: individualRun.payroll_run_id,
            is_individual: true
          };
        }
        return entry;
      });

      // Add entries for employees who only have individual runs (not in main run entries)
      rows.forEach(emp => {
        const individualRun = individualRunsMap[emp.employee_id];
        if (individualRun) {
          const existingIndex = existingEntries.findIndex(e => e.employee_id === emp.employee_id);
          if (existingIndex === -1) {
            existingEntries.push({
              employee_id: emp.employee_id,
              assignment_id: emp.assignment_id,
              payroll_entry_id: individualRun.payroll_entry_id,
              gross_salary: individualRun.gross_salary || emp.gross_salary || 0,
              bonus_amount: individualRun.bonus_amount !== null && individualRun.bonus_amount !== undefined ? individualRun.bonus_amount : 0,
              net_salary: individualRun.net_salary || (individualRun.gross_salary || 0) + (individualRun.bonus_amount || 0),
              remarks: individualRun.remarks,
              run_status: individualRun.status,
              pay_date: individualRun.pay_date,
              payroll_run_id: individualRun.payroll_run_id,
              is_individual: true
            });
          }
        }
      });
    }

    // Get deductions for existing entries
    const entryIds = existingEntries.map(e => e.payroll_entry_id).filter(id => id);
    let allDeductions = [];
    if (entryIds.length > 0) {
      const placeholders = entryIds.map(() => '?').join(',');
      const [deductions] = await pool.query(
        `SELECT pd.*, dt.name as deduction_type_name
         FROM payroll_deduction pd
         LEFT JOIN deduction_type dt ON pd.deduction_type_id = dt.deduction_type_id
         WHERE pd.payroll_entry_id IN (${placeholders})`,
        entryIds
      );
      allDeductions = deductions;
    }

    // Filter employees based on hire date:
    // - Show employees in the month they were hired (even if hired mid-month)
    // - Show employees in all months AFTER their hire date
    // - Do NOT show employees in months BEFORE their hire date
    let filteredRows = rows;
    if (month && year) {
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const periodEnd = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];
      
      console.log(`[GetEmployeesForPayroll] Filtering employees for period ending ${periodEnd}`);
      console.log(`[GetEmployeesForPayroll] Sample employee dates:`, rows.slice(0, 3).map(e => ({
        id: e.employee_id,
        name: e.employee_name,
        hire_date: e.hire_date,
        assignment_start_date: e.assignment_start_date
      })));
      
      filteredRows = rows.filter(emp => {
        const hireDate = emp.hire_date || emp.assignment_start_date;
        if (!hireDate) {
          // If no hire date, include them (shouldn't happen for active employees, but safe fallback)
          console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}) has no hire date, including`);
          return true;
        }
        
        try {
          // Ensure hireDate is a string in YYYY-MM-DD format for comparison
          let hireDateStr;
          if (hireDate instanceof Date) {
            hireDateStr = hireDate.toISOString().split('T')[0];
          } else if (typeof hireDate === 'string') {
            // Handle various date string formats
            hireDateStr = hireDate.split('T')[0].split(' ')[0];
            // Validate format (should be YYYY-MM-DD)
            if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDateStr)) {
              console.log(`[GetEmployeesForPayroll] Invalid date format for employee ${emp.employee_id}: ${hireDate}, including anyway`);
              return true; // Include if date format is invalid
            }
          } else {
            console.log(`[GetEmployeesForPayroll] Unexpected date type for employee ${emp.employee_id}: ${typeof hireDate}, including anyway`);
            return true; // Include if date type is unexpected
          }
          
          // Include if employee was hired on or before the last day of the payroll month
          // This ensures they appear in their hire month and all subsequent months, but not before
          const shouldInclude = hireDateStr <= periodEnd;
          
          if (!shouldInclude) {
            console.log(`[GetEmployeesForPayroll] Excluding employee ${emp.employee_id} (${emp.employee_name}): hire_date ${hireDateStr} > periodEnd ${periodEnd}`);
          }
          
          return shouldInclude;
        } catch (error) {
          console.error(`[GetEmployeesForPayroll] Error comparing dates for employee ${emp.employee_id}:`, error);
          // On error, include the employee to avoid false negatives
          return true;
        }
      });
      
      console.log(`[GetEmployeesForPayroll] Filtered to ${filteredRows.length} employees (hired on or before ${periodEnd}) out of ${rows.length} total active employees`);
    } else {
      console.log(`[GetEmployeesForPayroll] Including all ${filteredRows.length} active employees (no month/year filter)`);
    }

    // Merge employee data with existing payroll entries
    // For each employee, get status from payroll_run table based on payroll_run_id
    const result = await Promise.all(filteredRows.map(async (emp) => {
      const existing = existingEntries.find(e => e.employee_id === emp.employee_id);

      const deductions = existing?.payroll_entry_id
        ? allDeductions.filter(d => d.payroll_entry_id === existing.payroll_entry_id).map(d => ({
            deduction_type_id: d.deduction_type_id,
            deduction_type_name: d.deduction_type_name,
            amount: parseFloat(d.amount),
            reason: d.reason,
            effective_date: d.effective_date
          }))
        : [];

      const totalDeductions = deductions.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
      // Use payroll_entry data from database if it exists, otherwise use employee assignment data
      // Ensure proper parsing of numeric values
      const gross = parseFloat(existing?.gross_salary !== null && existing?.gross_salary !== undefined ? existing.gross_salary : (emp.gross_salary || 0)) || 0;
      // Bonus should be 0 by default, only use existing bonus_amount if it exists in payroll_entry
      const bonus = parseFloat(existing?.bonus_amount !== null && existing?.bonus_amount !== undefined ? existing.bonus_amount : 0) || 0;

      // Calculate hour variance from attendance records for the selected month/year
      let hour_variance = 0;
      let originalRemarks = null;
      let hour_variance_override = false;
      
      // Extract original remarks and check for override flag from existing entry if it exists
      if (existing?.remarks) {
        try {
          const remarksData = JSON.parse(existing.remarks);
          originalRemarks = remarksData.original_remarks || existing.remarks;
          hour_variance_override = remarksData.hour_variance_override === true;
          // If override exists, use stored value
          if (hour_variance_override && remarksData.hour_variance !== undefined && remarksData.hour_variance !== null) {
            hour_variance = remarksData.hour_variance;
            console.log(`[GetEmployeesForPayroll] Using overridden hour variance for employee ${emp.employee_id}: ${hour_variance} hours`);
          }
        } catch {
          originalRemarks = existing.remarks;
        }
      }
      
      // Auto-calculate hour variance from attendance only if no override exists
      if (!hour_variance_override && month && year) {
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        hour_variance = await calculateHourVarianceFromAttendance(emp.employee_id, monthNum, yearNum);
        console.log(`[GetEmployeesForPayroll] Calculated hour variance for employee ${emp.employee_id}: ${hour_variance} hours (month=${monthNum}, year=${yearNum})`);
      } else if (!hour_variance_override && existing?.remarks) {
        // Fallback to stored value if month/year not provided and no override
        try {
          const remarksData = JSON.parse(existing.remarks);
          hour_variance = remarksData.hour_variance || 0;
        } catch {
          hour_variance = 0;
        }
      }

      // Get status from payroll_run table - each payroll_entry is linked to a payroll_run
      // Priority: Individual runs > Existing entries (via payroll_run_id) > Main run
      let finalStatus = 'DRAFT';
      let finalPayDate = null;
      let payrollRunId = null;
      let statusSource = 'DEFAULT';

      // ALWAYS check individual runs first - they take absolute priority
      if (individualRunsMap && individualRunsMap[emp.employee_id]) {
        const individualRunCheck = individualRunsMap[emp.employee_id];
        finalStatus = individualRunCheck.status; // Status from payroll_run table
        finalPayDate = individualRunCheck.pay_date;
        payrollRunId = individualRunCheck.payroll_run_id;
        statusSource = 'INDIVIDUAL_RUN';
        console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}): Using individual run status=${finalStatus}, pay_date=${finalPayDate}, payroll_run_id=${payrollRunId}`);
      } else if (existing && existing.payroll_run_id) {
        // Get status directly from payroll_run table using payroll_run_id
        // Each payroll_entry is linked to its payroll_run via payroll_run_id
        const [runStatus] = await pool.query(
          `SELECT status, pay_date FROM payroll_run WHERE payroll_run_id = ?`,
          [existing.payroll_run_id]
        );
        
        if (runStatus.length > 0) {
          finalStatus = runStatus[0].status ? (runStatus[0].status.toUpperCase().trim()) : 'DRAFT';
          finalPayDate = runStatus[0].pay_date || null;
          payrollRunId = existing.payroll_run_id;
          statusSource = 'PAYROLL_RUN_TABLE';
          console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}): Retrieved status from payroll_run table via payroll_run_id=${payrollRunId}, status=${finalStatus}, pay_date=${finalPayDate}`);
        } else {
          // If payroll_run not found, use existing run_status as fallback
          finalStatus = existing.run_status || 'DRAFT';
          finalPayDate = existing.pay_date || null;
          payrollRunId = existing.payroll_run_id;
          statusSource = 'EXISTING_ENTRY_FALLBACK';
          console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}): Payroll_run not found, using existing entry status=${finalStatus}, payroll_run_id=${payrollRunId}`);
        }
      } else if (mainPayrollRunId && mainPayrollRunStatus) {
        finalStatus = mainPayrollRunStatus; // Status from main payroll_run
        finalPayDate = mainPayrollPayDate;
        payrollRunId = mainPayrollRunId;
        statusSource = 'MAIN_RUN';
        console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}): Using main run status=${finalStatus}, pay_date=${finalPayDate}, payroll_run_id=${payrollRunId}`);
      } else {
        console.log(`[GetEmployeesForPayroll] Employee ${emp.employee_id} (${emp.employee_name}): No existing payroll data, using default DRAFT. Individual runs map keys: [${Object.keys(individualRunsMap).join(', ')}]`);
      }
      
      // Final verification: if we have an individual run but didn't use it, log a warning
      if (individualRunsMap && individualRunsMap[emp.employee_id] && statusSource !== 'INDIVIDUAL_RUN') {
        console.error(`[GetEmployeesForPayroll] ERROR: Employee ${emp.employee_id} has individual run but status was determined from ${statusSource}!`);
      }

      // Calculate salary deduction from hour variance
      // Ensure proper parsing of numeric values
      const parsedGross = parseFloat(gross) || 0;
      const parsedBonus = parseFloat(bonus) || 0;
      const parsedHourVariance = parseFloat(hour_variance) || 0;
      
      // If hour_variance is negative (worked less hours), deduct proportional salary
      let hourVarianceDeduction = 0;
      if (parsedHourVariance < 0 && parsedGross > 0) {
        // Calculate hourly rate from monthly salary
        // Assume standard: monthly salary / (working days per month * 8 hours per day)
        const monthNum = month ? parseInt(month) : new Date().getMonth() + 1;
        const yearNum = year ? parseInt(year) : new Date().getFullYear();
        const lastDay = new Date(yearNum, monthNum, 0).getDate();
        let workingDays = 0;
        for (let day = 1; day <= lastDay; day++) {
          const date = new Date(yearNum, monthNum - 1, day);
          const dayOfWeek = date.getDay();
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            workingDays++;
          }
        }
        const expectedHours = workingDays * 8;
        const hourlyRate = expectedHours > 0 ? parsedGross / expectedHours : 0;
        // Deduct for negative hour variance (less hours worked)
        hourVarianceDeduction = Math.abs(parsedHourVariance) * hourlyRate;
      }

      // Calculate net salary: gross + bonus - totalDeductions - hourVarianceDeduction
      // Ensure net salary never goes negative (cap at 0)
      let calculatedNetSalary = parsedGross + parsedBonus - totalDeductions - hourVarianceDeduction;
      calculatedNetSalary = Math.max(0, calculatedNetSalary); // Cap at 0
      
      console.log(`[GetEmployeesForPayroll] Net salary calculation for employee ${emp.employee_id}: gross=${parsedGross}, bonus=${parsedBonus}, totalDeductions=${totalDeductions}, hourVarianceDeduction=${hourVarianceDeduction}, calculatedNetSalary=${calculatedNetSalary}`);

      // Use existing net_salary if it exists and payroll is paid, otherwise use calculated
      const isPaid = finalStatus === 'PAID' || finalStatus === 'APPROVED' || finalStatus === 'PROCESSED';
      const finalNetSalary = (isPaid && existing?.net_salary !== null && existing?.net_salary !== undefined) 
        ? parseFloat(existing.net_salary) || 0
        : calculatedNetSalary;

      return {
        ...emp,
        payroll_entry_id: existing?.payroll_entry_id || null,
        payroll_run_id: payrollRunId,
        gross_salary: parsedGross,
        bonus_amount: parsedBonus,
        hour_variance: parsedHourVariance,
        net_salary: finalNetSalary,
        remarks: originalRemarks,
        deductions: deductions,
        run_status: finalStatus,
        pay_date: finalPayDate
      };
    }));

    console.log(`[GetEmployeesForPayroll] Returning ${result.length} employees for payroll`);
    if (result.length === 0) {
      console.log(`[GetEmployeesForPayroll] WARNING: No employees returned! Original rows: ${rows.length}, Filtered rows: ${filteredRows.length}`);
    }
    res.json(result);
  } catch (error) {
    console.error('Error getting employees for payroll:', error);
    res.status(500).json({ error: error.message });
  }
};

const bulkUpdatePayrollEntries = async (req, res) => {
  try {
    const { month, year, entries, created_by_user_id } = req.body;

    const connection = await pool.connect();
    await client.query('BEGIN')();

    try {
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);

      if (monthNum < 1 || monthNum > 12) {
        throw new Error('Invalid month. Month must be between 1 and 12.');
      }

      const periodStart = new Date(yearNum, monthNum - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const periodEnd = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];
      const payDate = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];

      const [existingRuns] = await connection.query(
        `SELECT payroll_run_id, period_start, pay_date, status FROM payroll_run 
         WHERE YEAR(period_start) = ? AND MONTH(period_start) = ? AND status != 'CANCELLED'
         AND (notes IS NULL OR notes NOT LIKE 'individual_employee:%')
         ORDER BY payroll_run_id DESC LIMIT 1`,
        [yearNum, monthNum]
      );

      let payrollRunId;
      if (existingRuns.length > 0) {
        payrollRunId = existingRuns[0].payroll_run_id;
      } else {
        const [runResult] = await connection.query(
          `INSERT INTO payroll_run (period_start, period_end, pay_date, created_by_user_id, status)
           VALUES (?, ?, ?, ?, 'DRAFT')`,
          [periodStart, periodEnd, periodEnd, created_by_user_id || 1]
        );
        payrollRunId = runResult.insertId;
      }

      for (const entry of entries) {
        const { assignment_id, gross_salary, bonus_amount, net_salary, remarks, payroll_entry_id, hour_variance, deductions } = entry;
        let currentEntryId = payroll_entry_id;

        // Get employee_id from assignment_id to calculate hour variance
        const [assignmentData] = await connection.query(
          'SELECT employee_id FROM employment_assignment WHERE assignment_id = ?',
          [assignment_id]
        );
        const employee_id = assignmentData[0]?.employee_id;

        // Check if hour_variance was manually edited (provided in request)
        const isManualEdit = hour_variance !== undefined && hour_variance !== null;
        
        // Get existing remarks to check for override flag
        let existingRemarksData = {};
        if (payroll_entry_id) {
          const [existingEntry] = await connection.query(
            'SELECT remarks FROM payroll_entry WHERE payroll_entry_id = ?',
            [payroll_entry_id]
          );
          if (existingEntry.length > 0 && existingEntry[0].remarks) {
            try {
              existingRemarksData = JSON.parse(existingEntry[0].remarks);
            } catch {
              // Ignore parse errors
            }
          }
        }

        // Determine if we should use override (manual edit or existing override flag)
        const shouldUseOverride = isManualEdit || existingRemarksData.hour_variance_override === true;

        // Auto-calculate hour variance from attendance records only if no override
        let calculatedHourVariance = 0;
        if (!shouldUseOverride && employee_id && monthNum && yearNum) {
          calculatedHourVariance = await calculateHourVarianceFromAttendance(employee_id, monthNum, yearNum);
          console.log(`[BulkUpdatePayrollEntries] Calculated hour variance for employee ${employee_id}: ${calculatedHourVariance} hours (month=${monthNum}, year=${yearNum})`);
        }
        
        // Use manual edit value if provided, otherwise use existing override value, otherwise use calculated
        // Ensure proper parsing of hour_variance value
        let finalHourVariance = 0;
        if (isManualEdit) {
          finalHourVariance = parseFloat(hour_variance) || 0;
          console.log(`[BulkUpdatePayrollEntries] Using manually edited hour variance for employee ${employee_id}: ${finalHourVariance} hours`);
        } else if (shouldUseOverride && existingRemarksData.hour_variance !== undefined && existingRemarksData.hour_variance !== null) {
          finalHourVariance = parseFloat(existingRemarksData.hour_variance) || 0;
          console.log(`[BulkUpdatePayrollEntries] Using existing override hour variance for employee ${employee_id}: ${finalHourVariance} hours`);
        } else {
          finalHourVariance = calculatedHourVariance;
        }

        // Build remarks JSON with override flag if manually edited
        let finalRemarks = remarks || null;
        try {
          const remarksData = remarks ? JSON.parse(remarks) : {};
          remarksData.hour_variance = finalHourVariance;
          // Set override flag if manually edited
          if (isManualEdit) {
            remarksData.hour_variance_override = true;
            console.log(`[BulkUpdatePayrollEntries] Setting hour_variance_override flag for employee ${employee_id}`);
          }
          // Preserve original_remarks if it exists
          if (!remarksData.original_remarks && remarks) {
            remarksData.original_remarks = remarks;
          }
          finalRemarks = JSON.stringify(remarksData);
        } catch {
          finalRemarks = JSON.stringify({ 
            hour_variance: finalHourVariance, 
            hour_variance_override: isManualEdit ? true : false,
            original_remarks: remarks 
          });
        }

        // Calculate salary deduction from hour variance
        // Ensure proper parsing of numeric values
        const gross = parseFloat(gross_salary) || 0;
        const bonus = parseFloat(bonus_amount) || 0;
        const parsedHourVariance = parseFloat(finalHourVariance) || 0;
        
        let hourVarianceDeduction = 0;
        // Only deduct if hour variance is negative (worked less hours than expected)
        if (parsedHourVariance < 0 && gross > 0) {
          // Calculate hourly rate from monthly salary
          const lastDay = new Date(yearNum, monthNum, 0).getDate();
          let workingDays = 0;
          for (let day = 1; day <= lastDay; day++) {
            const date = new Date(yearNum, monthNum - 1, day);
            const dayOfWeek = date.getDay();
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
              workingDays++;
            }
          }
          const expectedHours = workingDays * 8;
          const hourlyRate = expectedHours > 0 ? gross / expectedHours : 0;
          // Deduct for negative hour variance (less hours worked)
          hourVarianceDeduction = Math.abs(parsedHourVariance) * hourlyRate;
          console.log(`[BulkUpdatePayrollEntries] Calculated hour variance deduction for employee ${employee_id}: ${hourVarianceDeduction} (hour_variance=${parsedHourVariance}, hourly_rate=${hourlyRate}, gross=${gross})`);
        } else {
          console.log(`[BulkUpdatePayrollEntries] No hour variance deduction for employee ${employee_id}: hour_variance=${parsedHourVariance}, gross=${gross}`);
        }

        // Calculate total deductions (existing deductions + hour variance deduction)
        const totalDeductionsAmount = (deductions || []).reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
        const totalDeductions = totalDeductionsAmount + hourVarianceDeduction;

        // Calculate net salary: gross + bonus - totalDeductions (including hour variance deduction)
        // Ensure net salary never goes negative (cap at 0)
        let calculatedNetSalary = gross + bonus - totalDeductions;
        calculatedNetSalary = Math.max(0, calculatedNetSalary); // Cap at 0
        
        console.log(`[BulkUpdatePayrollEntries] Net salary calculation for employee ${employee_id}: gross=${gross}, bonus=${bonus}, totalDeductions=${totalDeductions}, calculatedNetSalary=${calculatedNetSalary}`);

        // If hour_variance was manually edited, always use calculated net_salary based on the new hour_variance
        // Otherwise, use provided net_salary if it exists and is valid
        const finalNetSalary = isManualEdit 
          ? calculatedNetSalary // Always recalculate when hour_variance is manually edited
          : ((net_salary !== undefined && net_salary !== null) 
              ? Math.max(0, parseFloat(net_salary) || 0) // Ensure provided value is also non-negative
              : calculatedNetSalary);

        // Ensure every payroll_entry is linked to a payroll_run via payroll_run_id
        // Status will be retrieved from payroll_run.status
        if (payroll_entry_id) {
          // Update existing entry and ensure it's linked to the payroll_run
          await connection.query(
            `UPDATE payroll_entry 
             SET payroll_run_id = ?, gross_salary = ?, bonus_amount = ?, net_salary = ?, remarks = ?
             WHERE payroll_entry_id = ?`,
            [payrollRunId, gross, bonus, finalNetSalary, finalRemarks, payroll_entry_id]
          );
          currentEntryId = payroll_entry_id;
          console.log(`[BulkUpdatePayrollEntries] Updated entry ${payroll_entry_id} linked to payroll_run ${payrollRunId}, net_salary=${finalNetSalary}`);
        } else {
          // Create new entry linked to payroll_run
          const [result] = await connection.query(
            `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [payrollRunId, assignment_id, gross, bonus, finalNetSalary, finalRemarks]
          );
          currentEntryId = result.insertId;
          console.log(`[BulkUpdatePayrollEntries] Created entry ${currentEntryId} linked to payroll_run ${payrollRunId}, net_salary=${finalNetSalary}`);
        }

        if (currentEntryId) {
          await connection.query('DELETE FROM payroll_deduction WHERE payroll_entry_id = ?', [currentEntryId]);

          if (deductions && deductions.length > 0) {
            for (const deduction of deductions) {
              await connection.query(
                'INSERT INTO payroll_deduction (payroll_entry_id, deduction_type_id, amount, effective_date, reason) VALUES (?, ?, ?, ?, ?)',
                [currentEntryId, deduction.deduction_type_id, deduction.amount, deduction.effective_date || new Date().toISOString().split('T')[0], deduction.reason]
              );
            }
          }
        }
      }

      await client.query('COMMIT')();
      client.release();
      res.json({ message: 'Payroll entries updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK')();
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error bulk updating payroll entries:', error);
    res.status(500).json({ error: error.message });
  }
};

const payIndividualEmployee = async (req, res) => {
  try {
    const { month, year, assignment_id, employee_id } = req.body;

    if (!month || !year || !assignment_id || !employee_id) {
      return res.status(400).json({ error: 'Month, year, assignment_id, and employee_id are required' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const periodStart = new Date(yearNum, monthNum - 1, 1).toISOString().split('T')[0];
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const periodEnd = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];
    const currentDate = new Date().toISOString().split('T')[0];

    const connection = await pool.connect();
    await client.query('BEGIN')();

    try {
      const notesPattern = `individual_employee:${employee_id}`;
      
      // First, try to find existing individual run for this employee
      const [existingIndividualRuns] = await connection.query(
        `SELECT pr.payroll_run_id, pr.status, pr.pay_date
         FROM payroll_run pr
         WHERE YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
         AND pr.notes = ?`,
        [yearNum, monthNum, notesPattern]
      );

      let payrollRunId;
      if (existingIndividualRuns.length > 0) {
        payrollRunId = existingIndividualRuns[0].payroll_run_id;
        console.log(`[PayIndividualEmployee] Found existing individual run ${payrollRunId}, updating to PAID...`);
        
        // Update the payroll_run status to PAID
        const [updateResult] = await connection.query(
          `UPDATE payroll_run SET status = 'PAID', pay_date = ? WHERE payroll_run_id = ?`,
          [currentDate, payrollRunId]
        );
        console.log(`[PayIndividualEmployee] Updated payroll_run ${payrollRunId} to PAID, affected rows: ${updateResult.affectedRows}`);
        
        // Ensure payroll_entry exists for this run and is linked to the payroll_run
        // First check if entry exists for this specific run
        const [entryForThisRun] = await connection.query(
          `SELECT payroll_entry_id FROM payroll_entry WHERE payroll_run_id = ? AND assignment_id = ?`,
          [payrollRunId, assignment_id]
        );
        
        if (entryForThisRun.length === 0) {
          // Check if there's an existing entry for this assignment in the same month/year from main run
          const [existingEntry] = await connection.query(
            `SELECT pe.payroll_entry_id, pe.payroll_run_id 
             FROM payroll_entry pe
             INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
             WHERE pe.assignment_id = ?
             AND YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
             AND (pr.notes IS NULL OR pr.notes NOT LIKE 'individual_employee:%')
             ORDER BY pr.payroll_run_id DESC LIMIT 1`,
            [assignment_id, yearNum, monthNum]
          );
          
          if (existingEntry.length > 0) {
            // Update existing entry to link to this paid payroll_run
            const entryId = existingEntry[0].payroll_entry_id;
            await connection.query(
              `UPDATE payroll_entry SET payroll_run_id = ? WHERE payroll_entry_id = ?`,
              [payrollRunId, entryId]
            );
            
            // Also update deductions to link to the new entry (they stay with the entry)
            // No need to move deductions as they're already linked to the entry
          } else {
            // No existing entry found, create new one
            // Get the latest payroll entry data for this assignment from main run
            const [mainEntries] = await connection.query(
              `SELECT pe.* FROM payroll_entry pe
               INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
               WHERE YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
               AND pe.assignment_id = ?
               AND (pr.notes IS NULL OR pr.notes NOT LIKE 'individual_employee:%')
               ORDER BY pr.payroll_run_id DESC LIMIT 1`,
              [yearNum, monthNum, assignment_id]
            );

            if (mainEntries.length > 0) {
              const mainEntry = mainEntries[0];
              const [newEntryResult] = await connection.query(
                `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [payrollRunId, assignment_id, mainEntry.gross_salary, mainEntry.bonus_amount, mainEntry.net_salary, mainEntry.remarks]
              );

              const [deductions] = await connection.query(
                `SELECT * FROM payroll_deduction WHERE payroll_entry_id = ?`,
                [mainEntry.payroll_entry_id]
              );

              for (const deduction of deductions) {
                await connection.query(
                  `INSERT INTO payroll_deduction (payroll_entry_id, deduction_type_id, amount, effective_date, reason)
                   VALUES (?, ?, ?, ?, ?)`,
                  [newEntryResult.insertId, deduction.deduction_type_id, deduction.amount, deduction.effective_date, deduction.reason]
                );
              }
            } else {
              // Create entry from assignment data if no main entry exists
              const [assignmentData] = await connection.query(
                `SELECT start_salary FROM employment_assignment WHERE assignment_id = ?`,
                [assignment_id]
              );

          const grossSalary = assignmentData[0]?.start_salary || 0;
          await connection.query(
            `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
             VALUES (?, ?, ?, 0, ?, NULL)`,
            [payrollRunId, assignment_id, grossSalary, grossSalary]
          );
            }
          }
        }
      } else {
        const notesValue = `individual_employee:${employee_id}`;
        const [runResult] = await connection.query(
          `INSERT INTO payroll_run (period_start, period_end, pay_date, created_by_user_id, status, notes)
           VALUES (?, ?, ?, ?, 'PAID', ?)`,
          [periodStart, periodEnd, currentDate, 1, notesValue]
        );
        payrollRunId = runResult.insertId;

        const [mainEntries] = await connection.query(
          `SELECT pe.* FROM payroll_entry pe
           INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
           WHERE YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
           AND pe.assignment_id = ?
           AND (pr.notes IS NULL OR pr.notes NOT LIKE 'individual_employee:%')
           ORDER BY pr.payroll_run_id DESC LIMIT 1`,
          [yearNum, monthNum, assignment_id]
        );

        if (mainEntries.length > 0) {
          const mainEntry = mainEntries[0];
          const [newEntryResult] = await connection.query(
            `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [payrollRunId, assignment_id, mainEntry.gross_salary, mainEntry.bonus_amount, mainEntry.net_salary, mainEntry.remarks]
          );

          const [deductions] = await connection.query(
            `SELECT * FROM payroll_deduction WHERE payroll_entry_id = ?`,
            [mainEntry.payroll_entry_id]
          );

          for (const deduction of deductions) {
            await connection.query(
              `INSERT INTO payroll_deduction (payroll_entry_id, deduction_type_id, amount, effective_date, reason)
               VALUES (?, ?, ?, ?, ?)`,
              [newEntryResult.insertId, deduction.deduction_type_id, deduction.amount, deduction.effective_date, deduction.reason]
            );
          }
        } else {
          const [assignmentData] = await connection.query(
            `SELECT start_salary FROM employment_assignment WHERE assignment_id = ?`,
            [assignment_id]
          );

          const grossSalary = assignmentData[0]?.start_salary || 0;
          await connection.query(
            `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
             VALUES (?, ?, ?, 0, ?, NULL)`,
            [payrollRunId, assignment_id, grossSalary, grossSalary]
          );
        }
      }

      await client.query('COMMIT')();
      console.log(`[PayIndividualEmployee] ✅ Transaction committed successfully for payroll_run_id: ${payrollRunId}`);
      client.release();

      // Verify the status was saved correctly - use a new connection to ensure we see committed data
      await new Promise(resolve => setTimeout(resolve, 300));
      const verifyConnection = await pool.connect();
      try {
        const [verify] = await verifyConnection.query(
          `SELECT status, pay_date, notes, period_start, period_end FROM payroll_run WHERE payroll_run_id = ?`,
          [payrollRunId]
        );
        
        if (verify.length === 0) {
          console.error(`[PayIndividualEmployee] ❌ ERROR: Payroll_run ${payrollRunId} not found after commit!`);
          verifyclient.release();
          return res.status(500).json({ error: 'Payroll run not found after update' });
        }

        const rawVerifiedStatus = verify[0]?.status;
        const verifiedStatus = rawVerifiedStatus ? (rawVerifiedStatus.toUpperCase().trim()) : 'PAID';
        const verifiedPayDate = verify[0]?.pay_date || currentDate;

        console.log(`[PayIndividualEmployee] ✅ Verified status: ${verifiedStatus}, pay_date: ${verifiedPayDate}, payroll_run_id: ${payrollRunId}`);
        console.log(`[PayIndividualEmployee] Full payroll_run record:`, JSON.stringify(verify[0], null, 2));

        verifyclient.release();

        res.json({
          message: 'Employee marked as paid and saved successfully',
          status: verifiedStatus,
          pay_date: verifiedPayDate,
          payroll_run_id: payrollRunId
        });
      } catch (verifyError) {
        verifyclient.release();
        console.error(`[PayIndividualEmployee] ❌ Error verifying status:`, verifyError);
        // Still return success if update worked, even if verification failed
        res.json({
          message: 'Employee marked as paid and saved successfully',
          status: 'PAID',
          pay_date: currentDate,
          payroll_run_id: payrollRunId
        });
      }
    } catch (error) {
      await client.query('ROLLBACK')();
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error paying individual employee:', error);
    res.status(500).json({ error: error.message });
  }
};

const payAllUnpaidEmployees = async (req, res) => {
  try {
    const { month, year } = req.body;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const periodStart = new Date(yearNum, monthNum - 1, 1).toISOString().split('T')[0];
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const periodEnd = new Date(yearNum, monthNum - 1, lastDay).toISOString().split('T')[0];
    const currentDate = new Date().toISOString().split('T')[0];

    const connection = await pool.connect();
    await client.query('BEGIN')();

    try {
      // Get all active employees with active assignments for this month/year
      const [employees] = await connection.query(`
        SELECT 
          e.employee_id,
          ea.assignment_id,
          CONCAT(e.first_name, ' ', e.last_name) as employee_name
        FROM employee e
        INNER JOIN employment_assignment ea ON e.employee_id = ea.employee_id AND ea.status = 'ACTIVE'
        WHERE e.status = 'ACTIVE'
        AND (e.hire_date IS NULL OR e.hire_date <= ?)
        ORDER BY e.last_name, e.first_name
      `, [periodEnd]);

      console.log(`[PayAllUnpaidEmployees] Found ${employees.length} employees to process for month=${monthNum}, year=${yearNum}`);

      let paidCount = 0;
      let skippedCount = 0;

      // Process each employee individually - similar to payIndividualEmployee
      for (const emp of employees) {
        const notesPattern = `individual_employee:${emp.employee_id}`;
        
        // Check if employee is already paid
        const [existingPaidRuns] = await connection.query(
          `SELECT payroll_run_id, status FROM payroll_run 
           WHERE YEAR(period_start) = ? AND MONTH(period_start) = ?
           AND notes = ?
           AND status = 'PAID'`,
          [yearNum, monthNum, notesPattern]
        );

        if (existingPaidRuns.length > 0) {
          console.log(`[PayAllUnpaidEmployees] Employee ${emp.employee_id} (${emp.employee_name}) already paid, skipping...`);
          skippedCount++;
          continue;
        }

        // Find or create individual payroll_run for this employee
        const [existingIndividualRuns] = await connection.query(
          `SELECT payroll_run_id, status FROM payroll_run 
           WHERE YEAR(period_start) = ? AND MONTH(period_start) = ?
           AND notes = ?`,
          [yearNum, monthNum, notesPattern]
        );

        let payrollRunId;
        if (existingIndividualRuns.length > 0) {
          payrollRunId = existingIndividualRuns[0].payroll_run_id;
          console.log(`[PayAllUnpaidEmployees] Found existing individual run ${payrollRunId} for employee ${emp.employee_id}, updating to PAID...`);
          
          const [updateResult] = await connection.query(
            `UPDATE payroll_run SET status = 'PAID', pay_date = ? WHERE payroll_run_id = ?`,
            [currentDate, payrollRunId]
          );
          console.log(`[PayAllUnpaidEmployees] Updated payroll_run ${payrollRunId} to PAID, affected rows: ${updateResult.affectedRows}`);
        } else {
          // Create new individual payroll_run with status PAID
          const notesValue = `individual_employee:${emp.employee_id}`;
          const [runResult] = await connection.query(
            `INSERT INTO payroll_run (period_start, period_end, pay_date, created_by_user_id, status, notes)
             VALUES (?, ?, ?, ?, 'PAID', ?)`,
            [periodStart, periodEnd, currentDate, 1, notesValue]
          );
          payrollRunId = runResult.insertId;
          console.log(`[PayAllUnpaidEmployees] Created new individual run ${payrollRunId} for employee ${emp.employee_id} with status PAID`);
        }

        // Ensure payroll_entry exists and is linked to this payroll_run
        const [entryForThisRun] = await connection.query(
          `SELECT payroll_entry_id FROM payroll_entry WHERE payroll_run_id = ? AND assignment_id = ?`,
          [payrollRunId, emp.assignment_id]
        );
        
        if (entryForThisRun.length === 0) {
          // Check if there's an existing entry for this assignment in the same month/year from main run
          const [existingEntry] = await connection.query(
            `SELECT pe.payroll_entry_id, pe.payroll_run_id 
             FROM payroll_entry pe
             INNER JOIN payroll_run pr ON pe.payroll_run_id = pr.payroll_run_id
             WHERE pe.assignment_id = ?
             AND YEAR(pr.period_start) = ? AND MONTH(pr.period_start) = ?
             AND (pr.notes IS NULL OR pr.notes NOT LIKE 'individual_employee:%')
             ORDER BY pr.payroll_run_id DESC LIMIT 1`,
            [emp.assignment_id, yearNum, monthNum]
          );
          
          if (existingEntry.length > 0) {
            // Update existing entry to link to this paid payroll_run
            const entryId = existingEntry[0].payroll_entry_id;
            await connection.query(
              `UPDATE payroll_entry SET payroll_run_id = ? WHERE payroll_entry_id = ?`,
              [payrollRunId, entryId]
            );
            console.log(`[PayAllUnpaidEmployees] Linked existing entry ${entryId} to payroll_run ${payrollRunId} for employee ${emp.employee_id}`);
          } else {
            // Create entry from assignment data if no main entry exists
            const [assignmentData] = await connection.query(
              `SELECT start_salary FROM employment_assignment WHERE assignment_id = ?`,
              [emp.assignment_id]
            );

            const grossSalary = assignmentData[0]?.start_salary || 0;
            await connection.query(
              `INSERT INTO payroll_entry (payroll_run_id, assignment_id, gross_salary, bonus_amount, net_salary, remarks)
               VALUES (?, ?, ?, 0, ?, NULL)`,
              [payrollRunId, emp.assignment_id, grossSalary, grossSalary]
            );
            console.log(`[PayAllUnpaidEmployees] Created new entry for employee ${emp.employee_id} linked to payroll_run ${payrollRunId}`);
          }
        }

        paidCount++;
      }

      await client.query('COMMIT')();
      console.log(`[PayAllUnpaidEmployees] ✅ Transaction committed successfully. Paid: ${paidCount}, Skipped: ${skippedCount}`);
      client.release();

      // Verify the updates
      await new Promise(resolve => setTimeout(resolve, 300));
      const verifyConnection = await pool.connect();
      const [verify] = await verifyConnection.query(
        `SELECT COUNT(*) as paid_count FROM payroll_run 
         WHERE YEAR(period_start) = ? AND MONTH(period_start) = ?
         AND notes LIKE 'individual_employee:%'
         AND status = 'PAID'`,
        [yearNum, monthNum]
      );
      verifyclient.release();

      const verifiedPaidCount = verify[0]?.paid_count || 0;
      console.log(`[PayAllUnpaidEmployees] ✅ Verified: ${verifiedPaidCount} employees marked as PAID`);

      res.json({
        message: `All unpaid employees marked as paid successfully`,
        status: 'PAID',
        pay_date: currentDate,
        paid_count: paidCount,
        skipped_count: skippedCount,
        verified_paid_count: verifiedPaidCount
      });
    } catch (error) {
      await client.query('ROLLBACK')();
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error paying all unpaid employees:', error);
    res.status(500).json({ error: error.message });
  }
};

const approvePayrollRun = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const finalStatus = (status || 'PAID').toUpperCase().trim();

    if (finalStatus === 'PAID') {
      const currentDate = new Date().toISOString().split('T')[0];

      const connection = await pool.connect();
      try {
        await client.query('BEGIN')();

        await connection.query(
          `UPDATE payroll_run SET status = ?, pay_date = ? WHERE payroll_run_id = ?`,
          [finalStatus, currentDate, id]
        );

        await client.query('COMMIT')();

        const [verify] = await connection.query(
          `SELECT status, pay_date, period_start FROM payroll_run WHERE payroll_run_id = ?`,
          [id]
        );
        const verifiedStatus = (verify[0]?.status || 'DRAFT').toUpperCase().trim();
        const verifiedPayDate = verify[0]?.pay_date || null;

        client.release();

        await new Promise(resolve => setTimeout(resolve, 100));
        const [finalVerify] = await pool.query(
          `SELECT status, pay_date FROM payroll_run WHERE payroll_run_id = ?`,
          [id]
        );
        const finalStatusCheck = (finalVerify[0]?.status || 'DRAFT').toUpperCase().trim();

        res.json({
          message: `Payroll run marked as ${finalStatus}`,
          status: finalStatusCheck,
          pay_date: finalVerify[0]?.pay_date || verifiedPayDate,
          payroll_run_id: parseInt(id)
        });
      } catch (error) {
        await client.query('ROLLBACK')();
        client.release();
        throw error;
      }
    } else {
      await pool.query(
        `UPDATE payroll_run SET status = ? WHERE payroll_run_id = ?`,
        [finalStatus, id]
      );
      res.json({ message: `Payroll run marked as ${finalStatus}` });
    }
  } catch (error) {
    console.error('Error approving payroll run:', error);
    res.status(500).json({ error: error.message });
  }
};

const getDeductionTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM deduction_type ORDER BY name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getEmployeesForPayroll,
  getPayrollEntryById,
  createPayrollRun,
  getAllPayrollRuns,
  approvePayrollRun,
  bulkUpdatePayrollEntries,
  payIndividualEmployee,
  payAllUnpaidEmployees,
  getDeductionTypes
};
