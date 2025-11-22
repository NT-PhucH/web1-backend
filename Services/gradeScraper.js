const puppeteer = require("puppeteer");

// URL cấu hình
const LOGIN_URL = "https://ktdbcl.actvn.edu.vn/dang-nhap.html";
const GRADES_URL =
  "https://ktdbcl.actvn.edu.vn/khao-thi/hvsv/xem-diem-thi.html";

async function fetchStudentGrades(browser, username, password) {
  // Lấy page đầu tiên
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // ============================================================
  // 🔴 ĐOẠN CODE "HACK" ĐỂ ĐẨY CỬA SỔ RA MÀN HÌNH CHÍNH (WINDOWS)
  // ============================================================
  try {
    const session = await page.target().createCDPSession();
    const { windowId } = await session.send("Browser.getWindowForTarget");

    // Bước 1: Thu nhỏ cửa sổ
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });

    // Chờ 0.5 giây để Windows kịp xử lý
    await new Promise((r) => setTimeout(r, 500));

    // Bước 2: Phóng to và bắt buộc Focus (Normal hoặc Maximized)
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  } catch (err) {
    console.log("Không thể set focus window (có thể do mode headless)", err);
  }
  // ============================================================

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  console.log("[SCRAPER] Đang mở trang đăng nhập...");

  try {
    // 1. Vào trang đăng nhập
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Click nút đăng nhập Microsoft (nếu có)
    try {
      const btnMicrosoft = await page.$("a[href*='login.microsoftonline.com']");
      if (btnMicrosoft) await btnMicrosoft.click();
    } catch (e) {}

    // Điền Email nếu có
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
    console.log("⚠️  CỬA SỔ ĐÃ BẬT LÊN -> VUI LÒNG NHẬP MẬT KHẨU...");
    console.log(
      "-------------------------------------------------------------"
    );

    // --- CHECK LOGOUT ĐỂ BIẾT ĐÃ LOGIN THÀNH CÔNG ---
    await page.waitForFunction(
      () => document.body.innerText.includes("Đăng xuất"),
      { timeout: 0 }
    );

    console.log("[SCRAPER] Login thành công! Chuyển trang...");

    // 2. Vào trang xem điểm
    await page.goto(GRADES_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("table", { timeout: 30000 });

    // 3. Bóc tách và Lọc trùng
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

        const subjectName = getText(4); // Cột 4
        const attempt = parseInt(getText(5)) || 1; // Cột 5

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

    console.log(`[SCRAPER] Xong! Lấy được ${gradesData.length} môn.`);
    await page.close();
    return gradesData;
  } catch (error) {
    console.error("[SCRAPER ERROR]", error);
    if (page) await page.close();
    throw new Error("Lỗi: " + error.message);
  }
}

module.exports = { fetchStudentGrades };
