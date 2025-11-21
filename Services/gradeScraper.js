const puppeteer = require("puppeteer");

// URL cấu hình
const LOGIN_URL = "https://ktdbcl.actvn.edu.vn/dang-nhap.html";
const GRADES_URL =
  "https://ktdbcl.actvn.edu.vn/khao-thi/hvsv/xem-diem-thi.html";

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

/**
 * Hàm chính: Scrape điểm thi
 */
async function fetchStudentGrades(browser, username, password) {
  const page = await browser.newPage();

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

    // --- CHỈ TỰ ĐIỀN NẾU CÓ USERNAME GỬI LÊN ---
    if (username) {
      try {
        console.log("Đang thử nhập Email tự động...");
        await page.waitForSelector('input[type="email"]', { timeout: 5000 });
        await page.type('input[type="email"]', username, { delay: 50 });
        await page.click('input[type="submit"]');
      } catch (e) {
        console.log("Không tìm thấy ô nhập Email hoặc bỏ qua bước này.");
      }
    } else {
      console.log("Không có thông tin tài khoản, chờ người dùng nhập tay...");
    }

    // --- CHỜ NGƯỜI DÙNG NHẬP PASS / 2FA ---
    console.log(
      "-------------------------------------------------------------"
    );
    console.log("⚠️  VUI LÒNG ĐĂNG NHẬP TÀI KHOẢN KHÁC TRÊN TRÌNH DUYỆT!");
    console.log("👉  Hệ thống đang chờ bạn...");
    console.log(
      "-------------------------------------------------------------"
    );

    // Chờ đến khi URL đổi (Login thành công)
    await page.waitForFunction(
      () =>
        !window.location.href.includes("login") &&
        !window.location.href.includes("dang-nhap"),
      { timeout: 0 } // Chờ vô hạn đến khi bạn nhập xong
    );

    console.log("[SCRAPER] Đăng nhập thành công! Đang vào trang điểm...");

    // 2. Vào trang xem điểm
    await page.goto(GRADES_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("table", { timeout: 30000 });

    // 3. Bóc tách dữ liệu
    const gradesData = await page.evaluate(() => {
      const data = [];
      const tables = document.querySelectorAll("table");
      const table = tables[0];
      if (!table) return [];

      const rows = Array.from(table.querySelectorAll("tr"));

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells.length < 8) continue;

        const getText = (index) => cells[index]?.innerText.trim() || "";
        const getNum = (index) => {
          const txt = getText(index);
          return txt ? parseFloat(txt.replace(",", ".")) : 0;
        };

        const subjectName = getText(3);
        if (!subjectName) continue;

        // Nếu bảng không có cột TC, mặc định là 3
        let credits = 3;

        data.push({
          subjectName: subjectName,
          credits: credits,
          midtermScore: getNum(5),
          attendanceScore: getNum(6),
          finalScore: getNum(8),
          totalScore: getNum(9),
          gradeLetter: getText(10),
        });
      }
      return data;
    });

    console.log(`[SCRAPER] Lấy được ${gradesData.length} môn.`);
    await page.close();
    return gradesData;
  } catch (error) {
    console.error("[SCRAPER ERROR]", error);
    await page.close();
    throw new Error("Lỗi khi lấy điểm: " + error.message);
  }
}

module.exports = { fetchStudentGrades };
