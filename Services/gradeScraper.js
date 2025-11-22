const puppeteer = require("puppeteer");

// URL cấu hình
const LOGIN_URL = "https://ktdbcl.actvn.edu.vn/dang-nhap.html";
const ACCOUNT_URL =
  "https://ktdbcl.actvn.edu.vn/khao-thi/hvsv/thong-tin-tai-khoan.html";
const GRADES_URL =
  "https://ktdbcl.actvn.edu.vn/khao-thi/hvsv/xem-diem-thi.html";

async function fetchStudentGrades(browser, username, password) {
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // --- FORCE FOCUS WINDOW ---
  try {
    const session = await page.target().createCDPSession();
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await new Promise((r) => setTimeout(r, 500));
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  } catch (err) {
    console.log("Lỗi focus window:", err.message);
  }

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  console.log("[SCRAPER] Đang mở trang đăng nhập...");

  try {
    // 1. Vào trang đăng nhập
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

    try {
      const btnMicrosoft = await page.$("a[href*='login.microsoftonline.com']");
      if (btnMicrosoft) await btnMicrosoft.click();
    } catch (e) {}

    if (username) {
      try {
        await page.waitForSelector('input[type="email"]', { timeout: 5000 });
        await page.type('input[type="email"]', username, { delay: 50 });
        await page.click('input[type="submit"]');
      } catch (e) {}
    }

    console.log(
      "-------------------------------------------------------------"
    );
    console.log("⚠️  VUI LÒNG ĐĂNG NHẬP TRÊN CỬA SỔ CHROME...");
    console.log(
      "-------------------------------------------------------------"
    );

    // Chờ đăng nhập thành công (có nút Đăng xuất)
    await page.waitForFunction(
      () => document.body.innerText.includes("Đăng xuất"),
      { timeout: 0 }
    );
    console.log("[SCRAPER] Login thành công!");

    // ============================================================
    // 2. VÀO TRANG LẤY THÔNG TIN CÁ NHÂN (HỌ TÊN + MSSV)
    // ============================================================
    console.log("[SCRAPER] Đang lấy thông tin sinh viên...");
    await page.goto(ACCOUNT_URL, { waitUntil: "networkidle2", timeout: 60000 });

    const studentInfo = await page.evaluate(() => {
      let name = "Không xác định";
      let mssv = "CT......";

      // Tìm trong các bảng (table)
      const tds = Array.from(document.querySelectorAll("td"));

      for (let i = 0; i < tds.length; i++) {
        const text = tds[i].innerText.trim().toLowerCase();
        const nextTd = tds[i + 1]; // Ô bên cạnh thường chứa giá trị

        if (!nextTd) continue;

        // Tìm Họ tên
        if (text.includes("họ và tên") || text.includes("họ tên")) {
          name = nextTd.innerText.trim();
        }

        // Tìm Email để tách MSSV
        if (text.includes("email") || text.includes("thư điện tử")) {
          const email = nextTd.innerText.trim(); // VD: CT090235@actvn.edu.vn
          if (email.includes("@")) {
            mssv = email.split("@")[0].toUpperCase(); // Lấy phần trước @
          }
        }
      }
      return { name, mssv };
    });

    console.log(
      `[SCRAPER] Tìm thấy: ${studentInfo.name} - ${studentInfo.mssv}`
    );

    // ============================================================
    // 3. VÀO TRANG XEM ĐIỂM
    // ============================================================
    console.log("[SCRAPER] Đang chuyển sang trang điểm...");
    await page.goto(GRADES_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("table", { timeout: 30000 });

    // Bóc tách điểm (Giữ nguyên logic lọc trùng)
    const gradesData = await page.evaluate(() => {
      const uniqueSubjects = {};
      const tables = document.querySelectorAll("table");
      const table = tables[0];
      if (!table) return [];

      const rows = Array.from(table.querySelectorAll("tr"));

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells.length < 11) continue;

        const getText = (index) => cells[index]?.innerText.trim() || "";
        const getNum = (index) => {
          const txt = getText(index);
          return txt ? parseFloat(txt.replace(",", ".")) : 0;
        };

        const subjectName = getText(4);
        const attempt = parseInt(getText(5)) || 1;

        if (!subjectName) continue;

        const record = {
          subjectName: subjectName,
          credits: 3,
          attendanceScore: getNum(6),
          midtermScore: getNum(7),
          finalScore: getNum(9),
          totalScore: getNum(10),
          gradeLetter: getText(11),
          attempt: attempt,
        };

        if (!uniqueSubjects[subjectName]) {
          uniqueSubjects[subjectName] = record;
        } else {
          if (record.attempt > uniqueSubjects[subjectName].attempt) {
            uniqueSubjects[subjectName] = record;
          }
        }
      }
      return Object.values(uniqueSubjects);
    });

    await page.close();

    // TRẢ VỀ CẢ ĐIỂM VÀ THÔNG TIN SINH VIÊN
    return {
      grades: gradesData,
      info: studentInfo,
    };
  } catch (error) {
    console.error("[SCRAPER ERROR]", error);
    if (page) await page.close();
    throw new Error("Lỗi: " + error.message);
  }
}

module.exports = { fetchStudentGrades };
