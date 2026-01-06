const pool = require('../db/connection');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `attendance_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

const getAllAttendance = async (req, res) => {
  try {
    const { date, employee_id, month, year } = req.query;
    let query = `
      SELECT ar.*, 
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM attendance_record ar
      INNER JOIN employee e ON ar.employee_id = e.employee_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM ar.attendance_date) = $${paramIndex} AND EXTRACT(YEAR FROM ar.attendance_date) = $${paramIndex + 1}`;
      params.push(parseInt(month, 10), parseInt(year, 10));
      paramIndex += 2;
    } else if (date) {
      query += ` AND ar.attendance_date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }
    if (employee_id) {
      query += ` AND ar.employee_id = $${paramIndex}`;
      params.push(employee_id);
      paramIndex++;
    }

    query += ' ORDER BY ar.attendance_date DESC, e.last_name, e.first_name';

    const result = await pool.query(query, params);

    const formatted = result.rows.map(row => {
      const normalizeTimeDisplay = (timeStr) => {
        if (!timeStr) return null;

        const str = String(timeStr).trim();

        const isoTimeMatch = str.match(/T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?/i);
        if (isoTimeMatch) {
          const hours = isoTimeMatch[1];
          const minutes = isoTimeMatch[2];
          return `${hours}:${minutes}`;
        }

        if (/^\d{2}:\d{2}$/.test(str)) {
          return str;
        }

        if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
          return str.substring(0, 5);
        }

        const parts = str.split(':');
        if (parts.length >= 2) {
          return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }

        return str;
      };

      const checkIn = normalizeTimeDisplay(row.check_in);
      const checkOut = normalizeTimeDisplay(row.check_out);
      let workingHours = 0;
      let hourVariance = 0;

      if (checkIn && checkOut) {
        const [inHour, inMin] = checkIn.split(':').map(Number);
        const [outHour, outMin] = checkOut.split(':').map(Number);
        const inTime = inHour * 60 + inMin;
        const outTime = outHour * 60 + outMin;
        workingHours = (outTime - inTime) / 60;
        hourVariance = workingHours - 8;
      }

      return {
        ...row,
        check_in: checkIn,
        check_out: checkOut,
        working_hours: Math.round(workingHours * 100) / 100,
        hour_variance: Math.round(hourVariance)
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ar.*, 
        CONCAT(e.first_name, ' ', e.last_name) as employee_name
      FROM attendance_record ar
      INNER JOIN employee e ON ar.employee_id = e.employee_id
      WHERE ar.attendance_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createAttendance = async (req, res) => {
  try {
    const { employee_id, attendance_date, check_in, check_out, mark, notes } = req.body;

    // PostgreSQL UPSERT using ON CONFLICT
    const result = await pool.query(
      `INSERT INTO attendance_record (employee_id, attendance_date, check_in, check_out, mark, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (employee_id, attendance_date)
       DO UPDATE SET
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         mark = EXCLUDED.mark,
         notes = EXCLUDED.notes
       RETURNING attendance_id`,
      [employee_id, attendance_date, check_in, check_out, mark || 'PRESENT', notes]
    );
    res.status(201).json({ attendance_id: result.rows[0].attendance_id, message: 'Attendance record created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in, check_out, mark, notes } = req.body;
    await pool.query(
      'UPDATE attendance_record SET check_in = $1, check_out = $2, mark = $3, notes = $4 WHERE attendance_id = $5',
      [check_in, check_out, mark, notes, id]
    );
    res.json({ message: 'Attendance record updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM attendance_record WHERE attendance_id = $1', [id]);
    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const importAttendance = async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    let data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false,
      dateNF: 'yyyy-mm-dd'
    });

    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: true
    });

    for (let i = 0; i < data.length && i < rawData.length; i++) {
      for (let j = 0; j < data[i].length && j < rawData[i].length; j++) {
        if ((data[i][j] === null || data[i][j] === undefined || data[i][j] === '') &&
          rawData[i][j] !== null && rawData[i][j] !== undefined) {
          data[i][j] = rawData[i][j];
        }
      }
    }

    console.log('[ImportAttendance] Sample first 3 rows (formatted):', JSON.stringify(data.slice(0, 3), null, 2));
    console.log('[ImportAttendance] Sample first 3 rows (raw):', JSON.stringify(rawData.slice(0, 3), null, 2));

    let totalRowsRead = 0;
    let validRows = 0;
    let insertedRecords = 0;
    let updatedRecords = 0;
    let skippedInvalidEmployee = 0;
    let skippedEmptyRows = 0;

    const dataRows = data.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      totalRowsRead++;

      const isEmptyRow = !row || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
      if (isEmptyRow) {
        skippedEmptyRows++;
        continue;
      }

      const employeeId = row[0] ? String(row[0]).trim() : null;
      const dateValue = row[2];
      const timeInRaw = row[3];
      const timeOutRaw = row[4];

      console.log(`[ImportAttendance] Row ${i + 2}: EmployeeID=${employeeId}, Date=${dateValue}, TimeIn=${timeInRaw} (type: ${typeof timeInRaw}), TimeOut=${timeOutRaw} (type: ${typeof timeOutRaw})`);

      if (!employeeId) {
        skippedEmptyRows++;
        continue;
      }

      const employeeCheck = await pool.query(
        'SELECT employee_id FROM employee WHERE employee_id = $1',
        [employeeId]
      );

      if (employeeCheck.rows.length === 0) {
        skippedInvalidEmployee++;
        continue;
      }

      validRows++;

      let attendanceDate = null;
      if (dateValue) {
        if (dateValue instanceof Date) {
          attendanceDate = dateValue.toISOString().split('T')[0];
        } else if (typeof dateValue === 'number') {
          const excelEpoch = new Date(1899, 11, 30);
          const date = new Date(excelEpoch.getTime() + dateValue * 86400000);
          attendanceDate = date.toISOString().split('T')[0];
        } else {
          const dateStr = String(dateValue).trim();

          const mmddyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (mmddyyyyMatch) {
            const month = parseInt(mmddyyyyMatch[1], 10);
            const day = parseInt(mmddyyyyMatch[2], 10);
            const year = parseInt(mmddyyyyMatch[3], 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
              attendanceDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              console.log(`[ImportAttendance] Row ${i + 2}: Parsed MM/DD/YYYY format "${dateStr}" to ${attendanceDate}`);
            }
          } else {
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
              attendanceDate = parsedDate.toISOString().split('T')[0];
              console.log(`[ImportAttendance] Row ${i + 2}: Parsed date "${dateStr}" to ${attendanceDate}`);
            } else {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                attendanceDate = dateStr;
              } else {
                console.log(`[ImportAttendance] Row ${i + 2}: Could not parse date: "${dateStr}"`);
              }
            }
          }
        }
      }

      if (!attendanceDate) {
        skippedEmptyRows++;
        continue;
      }

      const normalizeTime = (timeValue, rowNum) => {
        if (timeValue === null || timeValue === undefined) {
          return null;
        }

        const timeStr = String(timeValue).trim();

        if (timeStr === '' || timeStr === 'NULL' || timeStr === 'N/A' || timeStr === 'null' || timeStr === 'undefined') {
          return null;
        }

        const timeStrUpper = timeStr.toUpperCase();

        if (timeStrUpper === 'OFF' || timeStrUpper === 'OFF') {
          return 'OFF';
        }

        if (typeof timeValue === 'number') {
          if (timeValue >= 0 && timeValue < 1) {
            const totalMinutes = Math.floor(timeValue * 24 * 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Converted Excel time serial ${timeValue} to ${result}`);
            return result;
          }
          if (timeValue >= 1) {
            const timePart = timeValue % 1;
            if (timePart > 0) {
              const totalMinutes = Math.floor(timePart * 24 * 60);
              const hours = Math.floor(totalMinutes / 60);
              const minutes = totalMinutes % 60;
              const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from date-time serial ${timeValue} to ${result}`);
              return result;
            }
          }
        }

        if (timeValue instanceof Date) {
          const hours = String(timeValue.getHours()).padStart(2, '0');
          const minutes = String(timeValue.getMinutes()).padStart(2, '0');
          const result = `${hours}:${minutes}`;
          console.log(`[ImportAttendance] Row ${rowNum}: Converted Date object to ${result}`);
          return result;
        }

        if (typeof timeValue === 'string') {
          const isoTimeMatch = timeStr.match(/T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?/i);
          if (isoTimeMatch) {
            const hours = isoTimeMatch[1];
            const minutes = isoTimeMatch[2];
            const result = `${hours}:${minutes}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from ISO format "${timeStr}" to ${result}`);
            return result;
          }

          let timeOnly = timeStr.split(' ').pop().trim();

          const simpleTimeMatch = timeOnly.match(/^(\d{1,2}):(\d{2})$/);
          if (simpleTimeMatch) {
            let hours = parseInt(simpleTimeMatch[1], 10);
            const minutes = simpleTimeMatch[2];
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Parsed simple HH:MM format "${timeOnly}" to ${result}`);
              return result;
            }
          }

          const time24Match = timeOnly.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (time24Match) {
            const hours = parseInt(time24Match[1], 10);
            const minutes = time24Match[2];
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Parsed 24-hour format "${timeOnly}" to ${result}`);
              return result;
            }
          }

          const amPmMatch = timeOnly.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
          if (amPmMatch) {
            let hours = parseInt(amPmMatch[1], 10);
            const minutes = amPmMatch[2];
            const period = amPmMatch[4].toUpperCase();

            if (period === 'PM' && hours !== 12) {
              hours += 12;
            } else if (period === 'AM' && hours === 12) {
              hours = 0;
            }
            const result = `${String(hours).padStart(2, '0')}:${minutes}`;
            console.log(`[ImportAttendance] Row ${rowNum}: Converted 12-hour format "${timeOnly}" to ${result}`);
            return result;
          }

          const anyTimeMatch = timeOnly.match(/(\d{1,2})[:.](\d{2})/);
          if (anyTimeMatch) {
            const hours = parseInt(anyTimeMatch[1], 10);
            const minutes = anyTimeMatch[2];
            if (hours >= 0 && hours <= 23 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) <= 59) {
              const result = `${String(hours).padStart(2, '0')}:${minutes}`;
              console.log(`[ImportAttendance] Row ${rowNum}: Extracted time from "${timeOnly}" to ${result}`);
              return result;
            }
          }

          console.log(`[ImportAttendance] Row ${rowNum}: Could not parse time string: "${timeStr}"`);
        }

        console.log(`[ImportAttendance] Row ${rowNum}: Unknown time format: ${typeof timeValue} = ${timeValue}`);
        return null;
      };

      const timeIn = normalizeTime(timeInRaw, i + 2);
      const timeOut = normalizeTime(timeOutRaw, i + 2);

      console.log(`[ImportAttendance] Row ${i + 2}: Normalized TimeIn=${timeIn}, TimeOut=${timeOut}`);

      let status = null;
      let finalTimeIn = null;
      let finalTimeOut = null;

      if (timeIn === 'OFF' || timeOut === 'OFF') {
        status = 'OFF';
        finalTimeIn = null;
        finalTimeOut = null;
      }
      else if (timeIn && !timeOut) {
        status = 'NO_SIGN_OUT';
        finalTimeIn = timeIn;
        finalTimeOut = null;
      }
      else if (!timeIn && !timeOut) {
        status = 'ABSENT';
        finalTimeIn = null;
        finalTimeOut = null;
      }
      else if (timeIn && timeOut) {
        status = 'PRESENT';
        finalTimeIn = timeIn;
        finalTimeOut = timeOut;
      }
      else {
        skippedEmptyRows++;
        continue;
      }

      const existing = await pool.query(
        'SELECT attendance_id FROM attendance_record WHERE employee_id = $1 AND attendance_date = $2',
        [employeeId, attendanceDate]
      );

      if (existing.rows.length > 0) {
        const attendanceId = existing.rows[0].attendance_id;
        console.log(`[ImportAttendance] Row ${i + 2}: Updating existing record - AttendanceID=${attendanceId}, EmployeeID=${employeeId}, Date=${attendanceDate}, CheckIn=${finalTimeIn}, CheckOut=${finalTimeOut}, Status=${status}`);

        await pool.query(
          `UPDATE attendance_record 
           SET check_in = $1, check_out = $2, mark = $3
           WHERE attendance_id = $4`,
          [finalTimeIn, finalTimeOut, status, attendanceId]
        );

        console.log(`[ImportAttendance] Row ${i + 2}: Successfully updated attendance record`);
        updatedRecords++;
      } else {
        console.log(`[ImportAttendance] Row ${i + 2}: Inserting new record - EmployeeID=${employeeId}, Date=${attendanceDate}, CheckIn=${finalTimeIn}, CheckOut=${finalTimeOut}, Status=${status}`);

        await pool.query(
          `INSERT INTO attendance_record (employee_id, attendance_date, check_in, check_out, mark)
           VALUES ($1, $2, $3, $4, $5)`,
          [employeeId, attendanceDate, finalTimeIn, finalTimeOut, status]
        );

        console.log(`[ImportAttendance] Row ${i + 2}: Successfully inserted attendance record`);
        insertedRecords++;
      }
    }

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      total_rows_read: totalRowsRead,
      valid_rows: validRows,
      inserted_records: insertedRecords,
      updated_records: updatedRecords,
      skipped_invalid_employee: skippedInvalidEmployee,
      skipped_empty_rows: skippedEmptyRows
    });

  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    console.error('Error importing attendance:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  importAttendance,
  upload
};
