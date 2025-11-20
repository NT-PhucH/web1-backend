// Backend/Services/scheduleScraper.js

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

/**
 * Hàm đăng nhập vào trang QLDT (Form cũ)
 */
async function performLogin(page, username, password) {
  page.on("dialog", async (dialog) => await dialog.accept());

  // Giả lập User Agent để tránh bị chặn
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  try {
    // Truy cập trang Login
    await page.goto("http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Login.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    // Nếu lỗi timeout nhưng url vẫn đúng thì reload
    if (!page.url().includes("Login.aspx"))
      await page.reload({ waitUntil: "domcontentloaded" });
  }

  // Chờ ô nhập liệu xuất hiện
  try {
    await page.waitForSelector("#txtUserName", { timeout: 10000 });
  } catch (e) {
    throw new Error("Lỗi tải trang login (Timeout selector).");
  }

  // Nhập User/Pass
  await page.type("#txtUserName", username, { delay: 20 });
  await page.type("#txtPassword", password, { delay: 20 });

  // Click nút đăng nhập
  const loginBtn = await page.$("#btnSubmit");
  if (loginBtn) {
    await Promise.all([
      loginBtn.click(),
      delay(2000), // Chờ một chút
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {}),
    ]);
  }
  return true;
}

/**
 * Hàm lấy tên sinh viên (Dùng cho API /api/login)
 */
async function fetchStudentName(browser, username, password) {
  const page = await browser.newPage();
  try {
    await performLogin(page, username, password);

    // Lấy tên sinh viên
    const studentName = await page.evaluate(() => {
      const el =
        document.querySelector("#lblStudentName") ||
        document.querySelector(".user-name");
      return el ? el.innerText : "Sinh viên";
    });

    await page.close();
    return studentName;
  } catch (error) {
    await page.close();
    throw error;
  }
}

/**
 * Hàm chính: Lấy lịch học
 */
async function fetchSchedule(browser, username, password) {
  const page = await browser.newPage();
  try {
    // 1. Đăng nhập
    await performLogin(page, username, password);

    console.log("--> Vào trang Report TKB...");

    // 2. Vào trang Lịch học
    await page.goto(
      "http://qldt.actvn.edu.vn/CMCSoft.IU.Web.info/Reports/Form/StudentTimeTable.aspx",
      { waitUntil: "networkidle2", timeout: 60000 }
    );

    // 3. Chờ bảng hiện ra
    try {
      await page.waitForSelector("table", { timeout: 10000 });
    } catch (e) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("table", { timeout: 10000 });
    }

    // 4. Cào dữ liệu (Logic giữ nguyên từ code cũ)
    const scheduleData = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      // Tìm bảng chứa dữ liệu lịch học
      const table = tables.find(
        (t) =>
          t.innerText.includes("Lớp học phần") &&
          t.innerText.includes("Giảng viên") &&
          t.querySelectorAll("tr").length > 2
      );

      if (!table) return [];

      const rows = Array.from(table.querySelectorAll("tr"));
      const data = [];

      function parseDateStr(str) {
        if (!str) return null;
        const parts = str.split("/");
        if (parts.length === 3)
          return new Date(parts[2], parts[1] - 1, parts[0]);
        return null;
      }

      function formatDate(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 5) return;
        const rowText = row.innerText.trim();
        if (rowText.startsWith("STT") || rowText.includes("Tổng")) return;

        const name = cells[1]?.innerText.trim();
        const timeCell = cells[3]?.innerText.trim();
        const room = cells[4]?.innerText.trim();
        const teacher = cells[5]?.innerText.trim();

        if (!timeCell) return;

        const lines = timeCell.split("\n");
        let currentStartDate = null;
        let currentEndDate = null;

        lines.forEach((line) => {
          line = line.trim();
          const dateRangeMatch = line.match(
            /Từ (\d{1,2}\/\d{1,2}\/\d{4}) đến (\d{1,2}\/\d{1,2}\/\d{4})/
          );
          if (dateRangeMatch) {
            currentStartDate = parseDateStr(dateRangeMatch[1]);
            currentEndDate = parseDateStr(dateRangeMatch[2]);
          }

          const sessionMatch = line.match(/Thứ (\d+|CN) tiết ([\d,]+)/);

          if (currentStartDate && currentEndDate && sessionMatch) {
            const thuStr = sessionMatch[1];
            const tietHoc = sessionMatch[2];

            let targetDay = -1;
            if (thuStr === "CN") targetDay = 0;
            else targetDay = parseInt(thuStr) - 1;

            let iterDate = new Date(currentStartDate);
            while (iterDate <= currentEndDate) {
              if (iterDate.getDay() === targetDay) {
                data.push({
                  ngayHoc: formatDate(iterDate),
                  caHoc: tietHoc,
                  tenMonHoc: name,
                  phongHoc: room,
                  giangVien: teacher,
                });
              }
              iterDate.setDate(iterDate.getDate() + 1);
            }
          }
        });
      });
      return data;
    });

    await page.close();
    return scheduleData;
  } catch (error) {
    await page.close();
    throw error; // Ném lỗi để server.js xử lý
  }
}

module.exports = { fetchSchedule, fetchStudentName };
